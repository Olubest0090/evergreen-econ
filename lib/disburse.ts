/**
 * Tax-bracket disburse (Locutus /transfer raws style):
 * For each nation on the tax ID:
 *   daily_consumption(nation) × days
 * Optionally top-up only: max(0, need − stockpile) when holdings are visible.
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

type City = {
  infrastructure?: number | null;
  land?: number | null;
  date?: string | null;
  coal_power?: number | null;
  oil_power?: number | null;
  nuclear_power?: number | null;
  wind_power?: number | null;
  farms?: number | null;
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
          cities {
            infrastructure land date
            coal_power oil_power nuclear_power wind_power farms
          }
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

function dailyConsumption(n: NationRow): Record<string, number> {
  const daily: Record<string, number> = {};
  const cities = n.cities || [];
  const soldiers = Number(n.soldiers ?? 0);
  const tanks = Number(n.tanks ?? 0);
  const aircraft = Number(n.aircraft ?? 0);
  const ships = Number(n.ships ?? 0);

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
      food +=
        (basePop * basePop) / 125_000_000 +
        (basePop * ageMod - basePop) / 850;
    }
  } else {
    const pop = Number(n.population ?? 0);
    if (pop > 0) {
      food += (pop * pop) / 125_000_000 + pop / 850;
    } else {
      food += Number(n.num_cities ?? 0) * 80;
    }
  }
  food += soldiers / 750;
  if (food > 0.01) daily.food = Math.round(food * 100) / 100;

  let coal = 0;
  let oil = 0;
  let uranium = 0;
  for (const c of cities) {
    const infra = Math.max(Number(c.infrastructure ?? 0), 1);
    const coalP = Number(c.coal_power ?? 0);
    const oilP = Number(c.oil_power ?? 0);
    const nucP = Number(c.nuclear_power ?? 0);
    coal += coalP * (infra / 1000) * 1.5 * 12;
    oil += oilP * (infra / 1000) * 1.5 * 12;
    uranium += nucP * (infra / 1000) * 1.2 * 12;
  }
  if (coal > 0.01) daily.coal = Math.round(coal * 100) / 100;
  if (oil > 0.01) daily.oil = Math.round(oil * 100) / 100;
  if (uranium > 0.01) daily.uranium = Math.round(uranium * 100) / 100;

  if (!cities.length && Number(n.num_cities ?? 0) > 0) {
    const c = Number(n.num_cities);
    daily.coal = Math.round(c * 2 * 100) / 100;
    daily.uranium = Math.round(c * 0.5 * 100) / 100;
  }

  const gas = tanks * 0.001 + aircraft * 0.002 + ships * 0.01;
  const munis = tanks * 0.001 + aircraft * 0.002 + ships * 0.01;
  if (gas > 0.01) daily.gasoline = Math.round(gas * 100) / 100;
  if (munis > 0.01) daily.munitions = Math.round(munis * 100) / 100;

  return daily;
}

function needForDays(
  daily: Record<string, number>,
  days: number,
  holdings: Record<string, number> | null
): Record<string, number> {
  const need: Record<string, number> = {};
  for (const [k, d] of Object.entries(daily)) {
    const total = Math.round(d * days * 100) / 100;
    if (total < 0.005) continue;
    if (holdings) {
      const gap = Math.max(0, total - Number(holdings[k] ?? 0));
      if (gap >= 0.005) need[k] = Math.round(gap * 100) / 100;
    } else {
      need[k] = total;
    }
  }
  return need;
}

export async function previewDisburse(opts: {
  taxId: number;
  days?: number;
}): Promise<{ rows: DisburseRow[]; taxId: number; days: number; allianceId: number }> {
  const days = opts.days && opts.days > 0 ? opts.days : 7;
  const alliance = await getSetting<{ alliance_id?: number }>("alliance", {});
  const allianceId = Number(alliance.alliance_id);
  if (!allianceId) throw new Error("Main alliance ID is not set");

  const nations = await fetchAllianceNationsForTax(allianceId, opts.taxId);
  const rows: DisburseRow[] = [];

  for (const n of nations) {
    if ((n.alliance_position || "").toUpperCase() === "APPLICANT") continue;
    const nationId = Number(n.id);
    const holdings = holdingsOf(n);
    const daily = dailyConsumption(n);
    const need = needForDays(daily, days, holdings);
    const row: DisburseRow = {
      nationId,
      nationName: n.nation_name,
      leaderName: n.leader_name,
      cities: Number(n.num_cities ?? 0),
      taxId: n.tax_id != null ? Number(n.tax_id) : opts.taxId,
      daily,
      holdings,
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
        amounts,
        record: result.id,
        note: "Grant",
      },
    });
  }

  return { ok: true, sent, failed, skipped };
}
