/**
 * Grant repayment: members on the configured tax ID auto-pay via tax bankrecs.
 * If they are NOT on that tax ID, the progress bar does not move.
 */
import { db } from "@/lib/supabase";
import { getSetting, setSetting } from "@/lib/settings";
import { getPnwApiKey, getBankApiKey } from "@/lib/secrets";
import { RESOURCES } from "@/lib/resources";

export type GrantRepaySettings = {
  /** In-game tax bracket ID for grant repayment (e.g. 50/50). */
  tax_id: number;
  alliance_id?: number;
};

const RES = RESOURCES as readonly string[];

function cleanAmounts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!RES.includes(k) && k !== "money") continue;
    const n = Math.round(Number(v) * 100) / 100;
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

/** Rough $ value for progress only (not market-perfect). */
export function amountsValue(a: Record<string, number>): number {
  // Prefer money; other resources count at coarse placeholders so the bar still moves
  const weights: Record<string, number> = {
    money: 1,
    food: 100,
    coal: 3000,
    oil: 3000,
    uranium: 2500,
    lead: 2500,
    iron: 2500,
    bauxite: 2500,
    gasoline: 3000,
    munitions: 2000,
    steel: 3500,
    aluminum: 2500,
  };
  let v = 0;
  for (const [k, n] of Object.entries(a)) {
    v += Math.abs(Number(n) || 0) * (weights[k] ?? 1000);
  }
  return v;
}

export function remainingAmounts(
  original: Record<string, number>,
  repaid: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(original), ...Object.keys(repaid)])) {
    const left = Math.round(((Number(original[k]) || 0) - (Number(repaid[k]) || 0)) * 100) / 100;
    if (left > 0.01) out[k] = left;
  }
  return out;
}

export function progressPct(
  original: Record<string, number>,
  repaid: Record<string, number>
): number {
  const o = amountsValue(original);
  if (o <= 0) return 100;
  const r = amountsValue(repaid);
  return Math.max(0, Math.min(100, Math.round((r / o) * 1000) / 10));
}

export async function getGrantRepaySettings(): Promise<GrantRepaySettings | null> {
  const s = await getSetting<GrantRepaySettings | null>("grant_repay", null);
  if (!s || !Number(s.tax_id)) return null;
  return { tax_id: Number(s.tax_id), alliance_id: s.alliance_id ? Number(s.alliance_id) : undefined };
}

export async function saveGrantRepaySettings(s: GrantRepaySettings) {
  return setSetting("grant_repay", {
    tax_id: Number(s.tax_id),
    alliance_id: s.alliance_id ? Number(s.alliance_id) : undefined,
  });
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = (await getBankApiKey()) || (await getPnwApiKey());
  if (!key) throw new Error("PNW/Bank API key not set");
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

/** Nation IDs currently on the repayment tax bracket. */
export async function fetchNationIdsOnTax(
  allianceId: number,
  taxId: number
): Promise<Set<number>> {
  const data = await gql<{ nations: { data: { id: string; tax_id?: number | string | null }[] } }>(
    `query($a:[Int],$first:Int){
      nations(alliance_id:$a, first:$first){
        data { id tax_id }
      }
    }`,
    { a: [allianceId], first: 500 }
  );
  const set = new Set<number>();
  for (const n of data.nations.data || []) {
    if (Number(n.tax_id) === taxId) set.add(Number(n.id));
  }
  return set;
}

type BankRec = {
  id: number;
  date: string;
  sid: number;
  stype: number;
  rid: number;
  rtype: number;
  note: string;
  amounts: Record<string, number>;
};

async function fetchTaxishBankrecs(
  allianceId: number,
  afterId: number
): Promise<BankRec[]> {
  const fields = RES.join(" ");
  // Paginate a window of recent bankrecs to alliance
  const data = await gql<{
    bankrecs: {
      id: string;
      date: string;
      sender_id: number;
      sender_type: number;
      receiver_id: number;
      receiver_type: number;
      note: string | null;
    }[] &
      Record<string, number | null>[];
  }>(
    `query($rid:[Int],$min:ID){
      bankrecs(rtype:2, rid:$rid, min_id:$min, orderBy:{column:ID,order:ASC}, first:100){
        id date sender_id sender_type receiver_id receiver_type note
        ${fields}
      }
    }`,
    { rid: [allianceId], min: String(Math.max(1, afterId + 1)) }
  ).catch(async () => {
    // Fallback without min_id
    return gql<{
      bankrecs: Record<string, unknown>[];
    }>(
      `query($rid:[Int]){
        bankrecs(rtype:2, rid:$rid, orderBy:{column:ID,order:DESC}, first:100){
          id date sender_id sender_type receiver_id receiver_type note
          ${fields}
        }
      }`,
      { rid: [allianceId] }
    );
  });

  const rows = (data as { bankrecs: Record<string, unknown>[] }).bankrecs || [];
  const out: BankRec[] = [];
  for (const r of rows) {
    const id = Number(r.id);
    if (!Number.isFinite(id) || id <= afterId) continue;
    const sid = Number(r.sender_id);
    const stype = Number(r.sender_type);
    if (stype !== 1) continue; // nations only
    const amounts = cleanAmounts(r);
    if (!Object.keys(amounts).length) continue;
    out.push({
      id,
      date: String(r.date || ""),
      sid,
      stype,
      rid: Number(r.receiver_id),
      rtype: Number(r.receiver_type),
      note: String(r.note || ""),
      amounts,
    });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

function applyRepay(
  remaining: Record<string, number>,
  payment: Record<string, number>
): { nextRepaidDelta: Record<string, number>; still: Record<string, number> } {
  const still = { ...remaining };
  const nextRepaidDelta: Record<string, number> = {};
  // Apply matching resources first, then money against any leftover value is NOT done —
  // only matching resources + money against money remaining.
  for (const k of Object.keys(payment)) {
    const pay = Number(payment[k]) || 0;
    if (pay <= 0) continue;
    const owe = Number(still[k]) || 0;
    if (owe <= 0) continue;
    const used = Math.min(pay, owe);
    nextRepaidDelta[k] = Math.round(used * 100) / 100;
    still[k] = Math.round((owe - used) * 100) / 100;
    if (still[k] <= 0.01) delete still[k];
  }
  return { nextRepaidDelta, still };
}

export type MemberGrantRepayView = {
  grantId: string;
  grantType: string;
  original: Record<string, number>;
  repaid: Record<string, number>;
  remaining: Record<string, number>;
  pct: number;
  status: string;
  onRepayTax: boolean | null; // null = tax id not configured / unknown
  issuedAt: string;
  note: string | null;
};

/** Member-facing: only their open grants + progress. */
export async function getMemberGrantRepayView(
  memberId: string,
  nationId: number
): Promise<{
  settings: GrantRepaySettings | null;
  onRepayTax: boolean | null;
  grants: MemberGrantRepayView[];
  totalPct: number;
  totalOriginal: number;
  totalRepaid: number;
}> {
  const settings = await getGrantRepaySettings();
  const supa = db();
  const { data: grants } = await supa
    .from("econ_grants")
    .select(
      "id, grant_type, amounts, original_amounts, repaid_amounts, repay_status, status, issued_at, note"
    )
    .eq("status", "active")
    .or(`member_id.eq.${memberId},nation_id.eq.${nationId}`)
    .order("issued_at", { ascending: true });

  let onRepayTax: boolean | null = null;
  if (settings?.tax_id) {
    try {
      const alliance =
        settings.alliance_id ||
        Number(
          (
            await getSetting<{ alliance_id?: number }>("alliance", {})
          ).alliance_id || 0
        );
      if (alliance) {
        const onTax = await fetchNationIdsOnTax(alliance, settings.tax_id);
        onRepayTax = onTax.has(nationId);
      }
    } catch {
      onRepayTax = null;
    }
  }

  const views: MemberGrantRepayView[] = [];
  let totalO = 0;
  let totalR = 0;
  for (const g of grants ?? []) {
    const original = cleanAmounts(g.original_amounts || g.amounts);
    const repaid = cleanAmounts(g.repaid_amounts);
    const remaining = remainingAmounts(original, repaid);
    if (Object.keys(remaining).length === 0 && g.repay_status === "paid") {
      // still show paid? skip fully paid from member card or show 100%
    }
    const pct = progressPct(original, repaid);
    totalO += amountsValue(original);
    totalR += amountsValue(repaid);
    views.push({
      grantId: g.id,
      grantType: String(g.grant_type),
      original,
      repaid,
      remaining,
      pct,
      status: String(g.repay_status || "open"),
      onRepayTax,
      issuedAt: g.issued_at,
      note: g.note,
    });
  }

  const open = views.filter((v) => Object.keys(v.remaining).length > 0);
  const totalPct =
    totalO <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((totalR / totalO) * 1000) / 10));

  return {
    settings,
    onRepayTax,
    grants: open.length ? open : views.filter((v) => v.pct < 100).slice(0, 10),
    totalPct: open.length ? totalPct : views.length ? 100 : 0,
    totalOriginal: totalO,
    totalRepaid: totalR,
  };
}

/**
 * Cron: apply tax bankrecs to grants for nations currently on repay tax_id only.
 */
export async function runGrantRepaySync(): Promise<{
  ok: boolean;
  skipped?: string;
  onTax: number;
  applied: number;
  grantsTouched: number;
  errors: string[];
}> {
  const settings = await getGrantRepaySettings();
  if (!settings?.tax_id) {
    return { ok: true, skipped: "grant_repay.tax_id not set", onTax: 0, applied: 0, grantsTouched: 0, errors: [] };
  }

  const allianceCfg = await getSetting<{ alliance_id?: number }>("alliance", {});
  const allianceId = Number(settings.alliance_id || allianceCfg.alliance_id || 0);
  if (!allianceId) {
    return { ok: false, skipped: "alliance_id missing", onTax: 0, applied: 0, grantsTouched: 0, errors: ["no alliance"] };
  }

  const errors: string[] = [];
  let onTax = 0;
  let applied = 0;
  const touched = new Set<string>();

  let onTaxNations: Set<number>;
  try {
    onTaxNations = await fetchNationIdsOnTax(allianceId, settings.tax_id);
    onTax = onTaxNations.size;
  } catch (e) {
    return {
      ok: false,
      onTax: 0,
      applied: 0,
      grantsTouched: 0,
      errors: [e instanceof Error ? e.message : "tax roster failed"],
    };
  }

  if (onTaxNations.size === 0) {
    return { ok: true, onTax: 0, applied: 0, grantsTouched: 0, errors: [] };
  }

  const cursor = await getSetting<{ last_bankrec_id?: number }>("grant_repay_cursor", {});
  const afterId = Number(cursor.last_bankrec_id || 0);

  let recs: BankRec[] = [];
  try {
    recs = await fetchTaxishBankrecs(allianceId, afterId);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "bankrecs failed");
    return { ok: false, onTax, applied: 0, grantsTouched: 0, errors };
  }

  const supa = db();
  let maxId = afterId;

  for (const rec of recs) {
    maxId = Math.max(maxId, rec.id);
    if (!onTaxNations.has(rec.sid)) continue; // not on repay tax → bar does not move

    // Active grants for this nation
    const { data: grants } = await supa
      .from("econ_grants")
      .select("id, amounts, original_amounts, repaid_amounts, repay_status")
      .eq("nation_id", rec.sid)
      .eq("status", "active");

    if (!grants?.length) continue;

    for (const g of grants) {
      const original = cleanAmounts(g.original_amounts || g.amounts);
      const repaid = cleanAmounts(g.repaid_amounts);
      const remaining = remainingAmounts(original, repaid);
      if (!Object.keys(remaining).length) continue;

      // Idempotent credit
      const { error: insErr } = await supa.from("econ_grant_tax_credits").insert({
        bankrec_id: rec.id,
        grant_id: g.id,
        amounts: rec.amounts,
      });
      if (insErr) {
        // duplicate → skip
        if (/duplicate|unique/i.test(insErr.message)) continue;
        errors.push(insErr.message);
        continue;
      }

      const { nextRepaidDelta } = applyRepay(remaining, rec.amounts);
      if (!Object.keys(nextRepaidDelta).length) continue;

      const newRepaid = { ...repaid };
      for (const [k, v] of Object.entries(nextRepaidDelta)) {
        newRepaid[k] = Math.round(((newRepaid[k] || 0) + v) * 100) / 100;
      }
      const still = remainingAmounts(original, newRepaid);
      const repay_status = Object.keys(still).length ? "paying" : "paid";

      await supa
        .from("econ_grants")
        .update({ repaid_amounts: newRepaid, repay_status })
        .eq("id", g.id);

      applied += 1;
      touched.add(g.id);
    }
  }

  if (maxId > afterId) {
    await setSetting("grant_repay_cursor", { last_bankrec_id: maxId });
  }

  return {
    ok: true,
    onTax,
    applied,
    grantsTouched: touched.size,
    errors,
  };
}

/** One-time: ensure original_amounts set for all active grants (migration). */
export async function migrateGrantsForRepay(): Promise<{ updated: number }> {
  const supa = db();
  const { data } = await supa
    .from("econ_grants")
    .select("id, amounts, original_amounts, repaid_amounts")
    .eq("status", "active");
  let updated = 0;
  for (const g of data ?? []) {
    if (g.original_amounts && Object.keys(g.original_amounts as object).length) continue;
    await supa
      .from("econ_grants")
      .update({
        original_amounts: g.amounts,
        repaid_amounts: g.repaid_amounts || {},
        repay_status: "open",
      })
      .eq("id", g.id);
    updated += 1;
  }
  return { updated };
}
