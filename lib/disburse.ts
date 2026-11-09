/**
 * Tax-bracket disburse (Locutus-style raws):
 * For each nation on the tax ID, estimate daily CONSUMPTION needed to keep
 * production + military + population running, then × days.
 * Optionally top-up only: max(0, need − in-game stockpile) when holdings visible.
 *
 * Includes:
 *  - Food (population age model + soldiers)
 *  - Power fuel (coal / oil / nuclear plants) — Locutus rates
 *  - Manufacturing inputs so factories keep running (oil→gas, lead→munis, iron+coal→steel, bauxite→alum)
 *  - Military upkeep (gasoline / munitions for tanks, aircraft, ships)
 *
 * Bank: offshore only. Note: always "Grant".
 */
import { db } from "@/lib/supabase";
import { getSetting } from "@/lib/settings";
import { getPnwApiKey } from "@/lib/secrets";
import { bankWithdraw, type BankAmounts } from "@/lib/pnwBank";
import { RESOURCES } from "@/lib/resources";

export type DisburseRow = {
  nationId: number;
  nationName: string;
  leaderName: string;
  cities: number;
  taxId: number | null;
  daily: Record<string, number>;
  need: Record<string, number>;
  holdings: Record<string, number> | null;
  production?: Record<string, number>;
  skipped?: string;
};

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = await getPnwApiKey();
  if (!key) throw new Error("PNW_API_KEY is not set");
  const res = await fetch(
    `https://api.politicsandwar.com/graphql?api_key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`P&W API ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

/** Full city improvement set used for consumption + production estimates. */
type City = {
  infrastructure?: number | null;
  land?: number | null;
  date?: string | null;
  // power
  coalpower?: number | null;
  oilpower?: number | null;
  nuclearpower?: number | null;
  windpower?: number | null;
  // raws
  coalmine?: number | null;
  oilwell?: number | null;
  uramine?: number | null;
  leadmine?: number | null;
  ironmine?: number | null;
  bauxitemine?: number | null;
  farm?: number | null;
  // manufacturing
  gasrefinery?: number | null;
  steelmill?: number | null;
  aluminumrefinery?: number | null;
  munitionsfactory?: number | null;
};

type NationRow = {
  id: string;
  nation_name: string;
  leader_name: string;
  num_cities: number;
  alliance_position: string | null;
  tax_id?: number | string | null;
  population?: number | null;
  soldiers?: number | null;
  tanks?: number | null;
  aircraft?: number | null;
  ships?: number | null;
  cities?: City[] | null;
} & Partial<Record<(typeof RESOURCES)[number], number | null>>;

const RES_FIELDS = RESOURCES.join(" ");

const CITY_FIELDS = `
  infrastructure land date
  coalpower oilpower nuclearpower windpower
  coalmine oilwell uramine leadmine ironmine bauxitemine farm
  gasrefinery steelmill aluminumrefinery munitionsfactory
`;

export async function fetchAllianceNationsForTax(
  allianceId: number,
  taxId: number
): Promise<NationRow[]> {
  const data = await gql<{ nations: { data: NationRow[] } }>(
    `query($a:[Int],$first:Int){
      nations(alliance_id:$a, first:$first){
        data {
          id nation_name leader_name num_cities alliance_position tax_id
          population soldiers tanks aircraft ships
          ${RES_FIELDS}
          cities { ${CITY_FIELDS} }
        }
      }
    }`,
    { a: [allianceId], first: 500 }
  );
  return (data.nations.data || []).filter((n) => {
    const tid = n.tax_id != null ? Number(n.tax_id) : null;
    return tid === taxId;
  });
}

function holdingsOf(n: NationRow): Record<string, number> | null {
  const out: Record<string, number> = {};
  let known = false;
  for (const k of RESOURCES) {
    const v = n[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v;
      known = true;
    }
  }
  return known ? out : null;
}

function add(daily: Record<string, number>, key: string, amt: number) {
  if (!Number.isFinite(amt) || amt <= 0.0001) return;
  daily[key] = Math.round(((daily[key] ?? 0) + amt) * 100) / 100;
}

/**
 * Locutus / wiki aligned rates (per building / day at full operation):
 * Power: coal/oil 1.2 resource per plant; nuclear 3.125 uranium (Locutus NUCLEAR_POWER).
 * Manufacturing base output per building (simplified baseInput≈3–6) and inputs:
 *   GASOLINE: output 3 / mult 3 → 1 oil each
 *   STEEL:    output 3 / mult 3 → 1 iron + 1 coal each
 *   ALUMINUM: output 3 / mult 3 → 1 bauxite each
 *   MUNITIONS: output 6 / mult 6 → 1 lead each
 * (Matches Locutus ResourceType manufacturingMultiplier + typical base throughput.)
 */
function dailyConsumption(n: NationRow): {
  daily: Record<string, number>;
  production: Record<string, number>;
} {
  const daily: Record<string, number> = {};
  const production: Record<string, number> = {};
  const cities = n.cities || [];
  const soldiers = Number(n.soldiers ?? 0);
  const tanks = Number(n.tanks ?? 0);
  const aircraft = Number(n.aircraft ?? 0);
  const ships = Number(n.ships ?? 0);

  // --- Food (population model + soldiers) ---
  let food = 0;
  if (cities.length) {
    const now = Date.now();
    for (const c of cities) {
      const infra = Number(c.infrastructure ?? 0);
      const basePop = infra * 100;
      const ageDays = c.date
        ? Math.max(1, (now - new Date(c.date).getTime()) / 86_400_000)
        : 30;
      const ageMod = 1 + Math.max(Math.log(ageDays) / 15, 0);
      food += (basePop * basePop) / 125_000_000 + (basePop * ageMod - basePop) / 850;
    }
  } else {
    const pop = Number(n.population ?? 0);
    if (pop > 0) food += (pop * pop) / 125_000_000 + pop / 850;
    else food += Number(n.num_cities ?? 0) * 80;
  }
  food += soldiers / 750;
  add(daily, "food", food);

  // Farm production (offset food need later if desired — tracked separately)
  let farmFood = 0;

  if (cities.length) {
    for (const c of cities) {
      const coalP = Number(c.coalpower ?? 0);
      const oilP = Number(c.oilpower ?? 0);
      const nucP = Number(c.nuclearpower ?? 0);
      // Power fuel (Locutus)
      add(daily, "coal", coalP * 1.2);
      add(daily, "oil", oilP * 1.2);
      add(daily, "uranium", nucP * 3.125);

      // Raws production (for info / optional netting)
      const coalM = Number(c.coalmine ?? 0);
      const oilW = Number(c.oilwell ?? 0);
      const uraM = Number(c.uramine ?? 0);
      const leadM = Number(c.leadmine ?? 0);
      const ironM = Number(c.ironmine ?? 0);
      const bauxM = Number(c.bauxitemine ?? 0);
      const farms = Number(c.farm ?? 0);
      // Base mine throughput ~3/day per mine (Locutus-ish baseInput); farms scale with land — use 3 as baseline
      add(production, "coal", coalM * 3);
      add(production, "oil", oilW * 3);
      add(production, "uranium", uraM * 3);
      add(production, "lead", leadM * 3);
      add(production, "iron", ironM * 3);
      add(production, "bauxite", bauxM * 3);
      farmFood += farms * 3;

      // Manufacturing — keep factories fed
      const gasR = Number(c.gasrefinery ?? 0);
      const steelM = Number(c.steelmill ?? 0);
      const alumR = Number(c.aluminumrefinery ?? 0);
      const muniF = Number(c.munitionsfactory ?? 0);

      // Output (for production summary)
      add(production, "gasoline", gasR * 3);
      add(production, "steel", steelM * 3);
      add(production, "aluminum", alumR * 3);
      add(production, "munitions", muniF * 6);

      // Inputs (consumption)
      add(daily, "oil", gasR * 1); // 3 gas / mult 3 → 1 oil per refinery
      add(daily, "iron", steelM * 1);
      add(daily, "coal", steelM * 1);
      add(daily, "bauxite", alumR * 1);
      add(daily, "lead", muniF * 1);
    }
  } else if (Number(n.num_cities ?? 0) > 0) {
    // No city breakdown — conservative AA default so we don't only ship food
    const c = Number(n.num_cities);
    add(daily, "coal", c * 1.2); // assume some coal power
    add(daily, "uranium", c * 0.5);
    add(daily, "oil", c * 0.5);
    add(daily, "iron", c * 0.3);
    add(daily, "lead", c * 0.3);
    add(daily, "bauxite", c * 0.3);
  }

  add(production, "food", farmFood);

  // Military upkeep (gasoline + munitions)
  const gas = tanks * 0.001 + aircraft * 0.002 + ships * 0.01;
  const munis = tanks * 0.001 + aircraft * 0.002 + ships * 0.01;
  add(daily, "gasoline", gas);
  add(daily, "munitions", munis);

  return { daily, production };
}

function needForDays(
  daily: Record<string, number>,
  days: number,
  holdings: Record<string, number> | null,
  /** If true, subtract estimated production of the same resource (net only). Default false = gross consumption. */
  netOfProduction = false,
  production?: Record<string, number>
): Record<string, number> {
  const need: Record<string, number> = {};
  for (const [k, d] of Object.entries(daily)) {
    let perDay = d;
    if (netOfProduction && production && production[k]) {
      perDay = Math.max(0, perDay - Number(production[k]));
    }
    let total = perDay * days;
    if (holdings && typeof holdings[k] === "number") {
      total = Math.max(0, total - holdings[k]);
    }
    if (total > 0.01) need[k] = Math.round(total * 100) / 100;
  }
  return need;
}

export async function previewDisburse(opts: {
  taxId: number;
  days?: number;
}): Promise<{
  rows: DisburseRow[];
  taxId: number;
  days: number;
  allianceId: number;
}> {
  const days = Math.max(1, Math.min(60, Math.floor(Number(opts.days ?? 7))));
  const alliance = await getSetting<{ alliance_id?: number }>("alliance", {});
  const allianceId = Number(alliance.alliance_id || 0);
  if (!allianceId) throw new Error("Main alliance ID is not set");

  const nations = await fetchAllianceNationsForTax(allianceId, opts.taxId);
  const rows: DisburseRow[] = [];

  for (const n of nations) {
    if ((n.alliance_position || "").toUpperCase() === "APPLICANT") continue;
    const nationId = Number(n.id);
    const holdings = holdingsOf(n);
    const { daily, production } = dailyConsumption(n);
    // Gross consumption for the period, minus stockpile when known
    const need = needForDays(daily, days, holdings, false, production);
    const row: DisburseRow = {
      nationId,
      nationName: n.nation_name,
      leaderName: n.leader_name,
      cities: Number(n.num_cities ?? 0),
      taxId: n.tax_id != null ? Number(n.tax_id) : opts.taxId,
      daily,
      holdings,
      production,
      need,
    };
    if (!Object.keys(daily).length) {
      row.skipped = "Could not estimate daily consumption";
    } else if (!Object.keys(need).length) {
      row.skipped = `Already has ≥ ${days}d of estimated consumption`;
    }
    rows.push(row);
  }

  rows.sort((a, b) => a.leaderName.localeCompare(b.leaderName));
  return { rows, taxId: opts.taxId, days, allianceId };
}

export async function runDisburse(opts: {
  taxId: number;
  days?: number;
  nationIds?: number[];
  staffDiscordId: string;
}): Promise<{
  ok: true;
  sent: { nationId: number; record: string | null; amounts: BankAmounts }[];
  failed: { nationId: number; error: string }[];
  skipped: number;
}> {
  const preview = await previewDisburse({ taxId: opts.taxId, days: opts.days });
  const allow = opts.nationIds?.length
    ? new Set(opts.nationIds.map(Number))
    : null;

  const sent: { nationId: number; record: string | null; amounts: BankAmounts }[] = [];
  const failed: { nationId: number; error: string }[] = [];
  let skipped = 0;

  for (const row of preview.rows) {
    if (allow && !allow.has(row.nationId)) continue;
    if (row.skipped || !Object.keys(row.need).length) {
      skipped += 1;
      continue;
    }
    const amounts = row.need as BankAmounts;
    const result = await bankWithdraw({
      actor: "offshore",
      receiver: row.nationId,
      receiverType: "nation",
      amounts,
      note: "Grant",
    });
    if (!result.ok) {
      failed.push({ nationId: row.nationId, error: result.error });
      continue;
    }
    sent.push({ nationId: row.nationId, record: result.id, amounts });
    await db().from("econ_audit_log").insert({
      actor_discord_id: opts.staffDiscordId,
      action: "disburse_grant",
      details: {
        taxId: opts.taxId,
        days: opts.days ?? 7,
        nationId: row.nationId,
        daily: row.daily,
        production: row.production,
        amounts,
        record: result.id,
        note: "Grant",
      },
    });
  }

  return { ok: true, sent, failed, skipped };
}
