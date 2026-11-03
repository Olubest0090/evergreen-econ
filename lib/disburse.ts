/**
 * Tax-bracket disburse (Locutus-style):
 * - Nations on a given in-game tax_id
 * - Need = warchest target − current holdings (what they still need)
 * - Default period 7d (targets already represent operating stock; we use full target gap)
 * - Send from OFFSHORE only, bank note always "Grant"
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
  target: Record<string, number>;
  holdings: Record<string, number> | null;
  need: Record<string, number>;
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

const RES_FIELDS = RESOURCES.join(" ");

type NationRow = {
  id: string;
  nation_name: string;
  leader_name: string;
  num_cities: number;
  alliance_position: string | null;
  tax_id?: number | string | null;
} & Partial<Record<(typeof RESOURCES)[number], number | null>>;

/** Alliance nations, optional tax_id filter (client-side if API ignores tax_id). */
export async function fetchAllianceNationsForTax(
  allianceId: number,
  taxId: number
): Promise<NationRow[]> {
  // Request tax_id + resources; filter to tax bracket
  try {
    const data = await gql<{ nations: { data: NationRow[] } }>(
      `query($a:[Int],$first:Int){
        nations(alliance_id:$a, first:$first){
          data {
            id nation_name leader_name num_cities alliance_position tax_id
            ${RES_FIELDS}
          }
        }
      }`,
      { a: [allianceId], first: 500 }
    );
    return (data.nations.data || []).filter((n) => {
      const tid = n.tax_id != null ? Number(n.tax_id) : null;
      return tid === taxId;
    });
  } catch (e) {
    // tax_id field may not exist on some keys — fall back without it
    const msg = e instanceof Error ? e.message : "";
    if (!/tax_id/i.test(msg)) throw e;
    const data = await gql<{ nations: { data: NationRow[] } }>(
      `query($a:[Int],$first:Int){
        nations(alliance_id:$a, first:$first){
          data {
            id nation_name leader_name num_cities alliance_position
            ${RES_FIELDS}
          }
        }
      }`,
      { a: [allianceId], first: 500 }
    );
    // Without tax_id we cannot filter — return empty with clear error upstream
    throw new Error(
      "P&W API did not return tax_id on nations. Use an alliance key that can see tax brackets, or update the query."
    );
  }
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

function needFrom(
  target: Record<string, number>,
  holdings: Record<string, number> | null
): Record<string, number> {
  const need: Record<string, number> = {};
  for (const [k, t] of Object.entries(target)) {
    const have = holdings ? Number(holdings[k] ?? 0) : 0;
    // If holdings unknown, disburse full target (safe "what they need" for 7d stock)
    const gap = holdings ? Math.max(0, Number(t) - have) : Math.max(0, Number(t));
    if (gap >= 0.005) need[k] = Math.round(gap * 100) / 100;
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
  const supa = db();
  const [{ data: rule }, { data: overrides }] = await Promise.all([
    supa
      .from("econ_warchest_rules")
      .select("base, per_city, active")
      .eq("name", "Default")
      .maybeSingle(),
    supa.from("econ_warchest_overrides").select("nation_id, targets"),
  ]);

  const over = new Map<number, Record<string, number>>();
  for (const o of overrides ?? []) {
    over.set(Number(o.nation_id), (o.targets || {}) as Record<string, number>);
  }
  const base = (rule?.base ?? {}) as Record<string, number>;
  const perCity = (rule?.per_city ?? {}) as Record<string, number>;
  const ruleActive = !!rule?.active;

  // Scale: targets are typically "full warchest"; for N days use days/7 of gap if days !== 7
  const scale = days / 7;

  const rows: DisburseRow[] = [];
  for (const n of nations) {
    if ((n.alliance_position || "").toUpperCase() === "APPLICANT") continue;
    const nationId = Number(n.id);
    const cities = Number(n.num_cities ?? 0);
    let target: Record<string, number> = {};
    if (over.has(nationId)) {
      target = { ...over.get(nationId)! };
    } else if (ruleActive) {
      for (const k of RESOURCES) {
        const v = Number(base[k] ?? 0) + Number(perCity[k] ?? 0) * cities;
        if (v > 0) target[k] = Math.round(v * 100) / 100;
      }
    }
    // apply day scale
    if (scale !== 1) {
      for (const k of Object.keys(target)) {
        target[k] = Math.round(target[k] * scale * 100) / 100;
      }
    }

    const holdings = holdingsOf(n);
    const need = needFrom(target, holdings);
    const row: DisburseRow = {
      nationId,
      nationName: n.nation_name,
      leaderName: n.leader_name,
      cities,
      taxId: n.tax_id != null ? Number(n.tax_id) : opts.taxId,
      target,
      holdings,
      need,
    };
    if (!Object.keys(target).length) {
      row.skipped = "No warchest target for this nation";
    } else if (!Object.keys(need).length) {
      row.skipped = "Already at or above target";
    }
    rows.push(row);
  }

  rows.sort((a, b) => a.leaderName.localeCompare(b.leaderName));
  return { rows, taxId: opts.taxId, days, allianceId };
}

export async function runDisburse(opts: {
  taxId: number;
  days?: number;
  nationIds?: number[]; // optional subset
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
        amounts,
        record: result.id,
        note: "Grant",
      },
    });
  }

  return { ok: true, sent, failed, skipped };
}
