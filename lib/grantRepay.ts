/**
 * Grant repayment: members on the configured tax ID auto-pay via tax bankrecs.
 * Progress is VALUE-based (estimated $), not resource-matched.
 * Steel grant + money/food tax still pays the bar down.
 * If they are NOT on that tax ID, the progress bar does not move.
 */
import { db } from "@/lib/supabase";
import { getSetting, setSetting } from "@/lib/settings";
import { getPnwApiKey, getBankApiKey } from "@/lib/secrets";
import { RESOURCES } from "@/lib/resources";

export type GrantRepaySettings = {
  tax_id: number;
  alliance_id?: number;
  /** Move here when grant bar is 100% (default / normal AA tax). */
  default_tax_id?: number;
  /** Attempt in-game tax bracket change when fully repaid. */
  auto_remove?: boolean;
};

const RES = ["money", "food", "coal", "oil", "uranium", "lead", "iron", "bauxite", "gasoline", "munitions", "steel", "aluminum"] as const;

/** Coarse $ estimates (progress only). Money is 1:1. */
export const VALUE_WEIGHTS: Record<string, number> = {
  money: 1,
  food: 100,
  coal: 3500,
  oil: 3500,
  uranium: 3000,
  lead: 3000,
  iron: 3000,
  bauxite: 3000,
  gasoline: 3500,
  munitions: 2500,
  steel: 4000,
  aluminum: 3000,
};

function cleanAmounts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(RES as readonly string[]).includes(k)) continue;
    const n = Math.round(Number(v) * 100) / 100;
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

export function amountsValue(a: Record<string, number>): number {
  let v = 0;
  for (const [k, n] of Object.entries(a)) {
    v += Math.abs(Number(n) || 0) * (VALUE_WEIGHTS[k] ?? 1000);
  }
  return Math.round(v * 100) / 100;
}

export function progressPctFromValues(originalValue: number, repaidValue: number): number {
  if (originalValue <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((repaidValue / originalValue) * 1000) / 10));
}

export function remainingAmounts(
  original: Record<string, number>,
  repaid: Record<string, number>
): Record<string, number> {
  // Kept for display of original composition; value-based remaining is separate
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(original), ...Object.keys(repaid)])) {
    if (k === "_value") continue;
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
  const r = Number(repaid._value) > 0 ? Number(repaid._value) : amountsValue(repaid);
  return progressPctFromValues(o, r);
}

export async function getGrantRepaySettings(): Promise<GrantRepaySettings | null> {
  const s = await getSetting<GrantRepaySettings | null>("grant_repay", null);
  if (!s || !Number(s.tax_id)) return null;
  return {
    tax_id: Number(s.tax_id),
    alliance_id: s.alliance_id ? Number(s.alliance_id) : undefined,
    default_tax_id: s.default_tax_id ? Number(s.default_tax_id) : undefined,
    auto_remove: s.auto_remove === true,
  };
}

export async function saveGrantRepaySettings(s: GrantRepaySettings) {
  return setSetting("grant_repay", {
    tax_id: Number(s.tax_id),
    alliance_id: s.alliance_id ? Number(s.alliance_id) : undefined,
    default_tax_id: s.default_tax_id ? Number(s.default_tax_id) : undefined,
    auto_remove: s.auto_remove === true,
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
  const out: BankRec[] = [];
  let page = 1;
  while (page <= 20) {
    const data = await gql<{
      bankrecs?: {
        data?: Record<string, unknown>[];
        paginatorInfo?: { hasMorePages?: boolean };
      };
    }>(
      `query($page: Int, $rid: [Int], $rtype: [Int], $stype: [Int]) {
        bankrecs(
          first: 100
          page: $page
          rid: $rid
          rtype: $rtype
          stype: $stype
          orderBy: [{ column: ID, order: DESC }]
        ) {
          data {
            id date note
            sid stype rid rtype
            money food coal oil uranium lead iron bauxite gasoline munitions steel aluminum
          }
          paginatorInfo { hasMorePages }
        }
      }`,
      { page, rid: [allianceId], rtype: [2], stype: [1] }
    );

    const rows = data.bankrecs?.data ?? [];
    for (const r of rows) {
      const id = Number(r.id);
      if (!Number.isFinite(id) || id <= afterId) continue;
      const sid = Number(r.sid);
      const stype = Number(r.stype);
      if (stype !== 1) continue;
      const amounts = cleanAmounts(r);
      if (!Object.keys(amounts).length) continue;
      out.push({
        id,
        date: String(r.date || ""),
        sid,
        stype,
        rid: Number(r.rid),
        rtype: Number(r.rtype),
        note: String(r.note || ""),
        amounts,
      });
    }
    if (!data.bankrecs?.paginatorInfo?.hasMorePages || rows.length === 0) break;
    const minOnPage = Math.min(...rows.map((r) => Number(r.id)).filter(Number.isFinite));
    if (Number.isFinite(minOnPage) && minOnPage <= afterId) break;
    page += 1;
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

function repaidValueOf(repaid: Record<string, number>): number {
  if (Number(repaid._value) > 0) return Number(repaid._value);
  return amountsValue(repaid);
}

export type MemberGrantRepayView = {
  grantId: string;
  grantType: string;
  original: Record<string, number>;
  repaid: Record<string, number>;
  remaining: Record<string, number>;
  originalValue: number;
  repaidValue: number;
  remainingValue: number;
  pct: number;
  status: string;
  onRepayTax: boolean | null;
  issuedAt: string;
  note: string | null;
};

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
        Number((await getSetting<{ alliance_id?: number }>("alliance", {})).alliance_id || 0);
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
    const oVal = amountsValue(original);
    // _value may be stripped by cleanAmounts — read raw
    const rawRepaid =
      g.repaid_amounts && typeof g.repaid_amounts === "object"
        ? (g.repaid_amounts as Record<string, number>)
        : {};
    const repaidValue =
      Number(rawRepaid._value) > 0
        ? Number(rawRepaid._value)
        : amountsValue(cleanAmounts(rawRepaid));
    const remainingValue = Math.max(0, Math.round((oVal - repaidValue) * 100) / 100);
    const pct = progressPctFromValues(oVal, repaidValue);
    totalO += oVal;
    totalR += repaidValue;
    if (remainingValue <= 0.01 && pct >= 100) continue;
    views.push({
      grantId: g.id,
      grantType: String(g.grant_type),
      original,
      repaid: rawRepaid,
      remaining: remainingAmounts(original, cleanAmounts(rawRepaid)),
      originalValue: oVal,
      repaidValue,
      remainingValue,
      pct,
      status: String(g.repay_status || "open"),
      onRepayTax,
      issuedAt: g.issued_at,
      note: g.note,
    });
  }

  const totalPct =
    totalO <= 0 ? (views.length ? 100 : 0) : progressPctFromValues(totalO, totalR);

  return {
    settings,
    onRepayTax,
    grants: views,
    totalPct,
    totalOriginal: totalO,
    totalRepaid: totalR,
  };
}

/**
 * Cron: apply tax bankrecs by ESTIMATED VALUE (not resource match).
 * Oldest open grant first (FIFO). One bankrec value is not double-counted across grants.
 */
export async function runGrantRepaySync(opts?: {
  resetCursor?: boolean;
}): Promise<{
  ok: boolean;
  skipped?: string;
  onTax: number;
  applied: number;
  valueApplied: number;
  grantsTouched: number;
  bankrecsSeen: number;
  errors: string[];
}> {
  const settings = await getGrantRepaySettings();
  if (!settings?.tax_id) {
    return {
      ok: true,
      skipped: "grant_repay.tax_id not set",
      onTax: 0,
      applied: 0,
      valueApplied: 0,
      grantsTouched: 0,
      bankrecsSeen: 0,
      errors: [],
    };
  }

  const allianceCfg = await getSetting<{ alliance_id?: number }>("alliance", {});
  const allianceId = Number(settings.alliance_id || allianceCfg.alliance_id || 0);
  if (!allianceId) {
    return {
      ok: false,
      skipped: "alliance_id missing",
      onTax: 0,
      applied: 0,
      valueApplied: 0,
      grantsTouched: 0,
      bankrecsSeen: 0,
      errors: ["no alliance"],
    };
  }

  const errors: string[] = [];
  let applied = 0;
  let valueApplied = 0;
  const touched = new Set<string>();

  let onTaxNations: Set<number>;
  try {
    onTaxNations = await fetchNationIdsOnTax(allianceId, settings.tax_id);
  } catch (e) {
    return {
      ok: false,
      onTax: 0,
      applied: 0,
      valueApplied: 0,
      grantsTouched: 0,
      bankrecsSeen: 0,
      errors: [e instanceof Error ? e.message : "tax roster failed"],
    };
  }

  if (onTaxNations.size === 0) {
    return {
      ok: true,
      onTax: 0,
      applied: 0,
      valueApplied: 0,
      grantsTouched: 0,
      bankrecsSeen: 0,
      errors: [],
    };
  }

  if (opts?.resetCursor) {
    await setSetting("grant_repay_cursor", { last_bankrec_id: 0 });
  }
  const cursor = await getSetting<{ last_bankrec_id?: number }>("grant_repay_cursor", {});
  const afterId = Number(cursor.last_bankrec_id || 0);

  let recs: BankRec[] = [];
  try {
    recs = await fetchTaxishBankrecs(allianceId, afterId);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "bankrecs failed");
    return {
      ok: false,
      onTax: onTaxNations.size,
      applied: 0,
      valueApplied: 0,
      grantsTouched: 0,
      bankrecsSeen: 0,
      errors,
    };
  }

  const supa = db();
  let maxId = afterId;

  for (const rec of recs) {
    maxId = Math.max(maxId, rec.id);
    if (!onTaxNations.has(rec.sid)) continue;

    let valueLeft = amountsValue(rec.amounts);
    if (valueLeft <= 0) continue;

    const { data: grants } = await supa
      .from("econ_grants")
      .select("id, amounts, original_amounts, repaid_amounts, repay_status, issued_at")
      .eq("nation_id", rec.sid)
      .eq("status", "active")
      .order("issued_at", { ascending: true });

    if (!grants?.length) continue;

    for (const g of grants) {
      if (valueLeft <= 0.01) break;

      const original = cleanAmounts(g.original_amounts || g.amounts);
      const oVal = amountsValue(original);
      if (oVal <= 0) continue;

      const rawRepaid = { ...((g.repaid_amounts || {}) as Record<string, number>) };
      const already = Number(rawRepaid._value) > 0 ? Number(rawRepaid._value) : amountsValue(cleanAmounts(rawRepaid));
      const need = Math.max(0, oVal - already);
      if (need <= 0.01) continue;

      // Idempotent per grant+bankrec
      const { error: insErr } = await supa.from("econ_grant_tax_credits").insert({
        bankrec_id: rec.id,
        grant_id: g.id,
        amounts: { ...rec.amounts, _value: Math.min(valueLeft, need) },
      });
      if (insErr) {
        if (/duplicate|unique/i.test(insErr.message)) continue;
        errors.push(insErr.message);
        continue;
      }

      const take = Math.min(valueLeft, need);
      const newVal = Math.round((already + take) * 100) / 100;
      const repay_status = newVal >= oVal - 0.01 ? "paid" : "paying";

      await supa
        .from("econ_grants")
        .update({
          repaid_amounts: { ...rawRepaid, _value: newVal },
          repay_status,
        })
        .eq("id", g.id);

      valueLeft = Math.round((valueLeft - take) * 100) / 100;
      valueApplied += take;
      applied += 1;
      touched.add(g.id);
    }
  }

  if (maxId > afterId) {
    await setSetting("grant_repay_cursor", { last_bankrec_id: maxId });
  }

  let completion = { completedNations: 0, notified: 0, taxMoved: 0 };
  try {
    completion = await processFullyRepaidNations(settings);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "completion check failed");
  }

  return {
    ok: true,
    onTax: onTaxNations.size,
    applied,
    valueApplied: Math.round(valueApplied * 100) / 100,
    grantsTouched: touched.size,
    bankrecsSeen: recs.length,
    completedNations: completion.completedNations,
    notified: completion.notified,
    taxMoved: completion.taxMoved,
    errors,
  };
}


/** Notify Discord that a member finished grant repayment. */
async function notifyGrantFullyRepaid(opts: {
  nationId: number;
  leaderName?: string | null;
  nationName?: string | null;
  totalValue: number;
  taxMoved: boolean | null;
  taxMoveError?: string | null;
  defaultTaxId?: number | null;
}) {
  try {
    const { getDiscordBotToken } = await import("@/lib/secrets");
    const token = await getDiscordBotToken();
    if (!token) return;
    const cfg = await getSetting<{
      grant_channel_id?: string;
      deposit_channel_id?: string;
      econ_role_id?: string;
    }>("discord_channels", {});
    const ch =
      cfg.grant_channel_id?.trim() ||
      process.env.DISCORD_GRANT_CHANNEL_ID?.trim() ||
      cfg.deposit_channel_id?.trim() ||
      process.env.DISCORD_DEPOSIT_CHANNEL_ID?.trim() ||
      "";
    if (!ch) return;
    const role = cfg.econ_role_id?.trim() || process.env.DISCORD_ECON_ROLE_ID?.trim() || "";
    const who =
      opts.leaderName || opts.nationName || `Nation #${opts.nationId}`;
    let body =
      (role ? `<@&${role}> ` : "") +
      `**Grant repayment complete** — **${who}** (#${opts.nationId})\n` +
      `Estimated grant value fully paid down (~$${Math.round(opts.totalValue).toLocaleString()}).\n`;
    if (opts.taxMoved === true) {
      body += `✅ Auto-moved off grant tax → tax #${opts.defaultTaxId}.`;
    } else if (opts.taxMoved === false) {
      body += `⚠️ Could not auto-change tax bracket${
        opts.taxMoveError ? `: ${opts.taxMoveError}` : ""
      }. **Remove them from the grant tax ID in-game.**`;
    } else {
      body += `**Action:** remove them from the grant repayment tax bracket in-game.`;
    }
    await fetch(`https://discord.com/api/v10/channels/${ch}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: body }),
    });
  } catch (e) {
    console.error("notifyGrantFullyRepaid:", e);
  }
}

/**
 * Try to move nation to default tax bracket via GraphQL mutation.
 * Requires verified bot key + bank access. Returns null if not configured.
 */
async function tryAssignTaxBracket(
  nationId: number,
  taxBracketId: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { getVerifiedBotKey, getBotKeyApiKey, getBankApiKey, getPnwApiKey } =
      await import("@/lib/secrets");
    const botKey = await getVerifiedBotKey();
    if (!botKey) return { ok: false, error: "VERIFIED_BOT_KEY not set" };
    const key = (await getBankApiKey()) || (await getPnwApiKey());
    if (!key) return { ok: false, error: "BANK/PNW API key not set" };
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Bot-Key": botKey,
      "X-Api-Key": (await getBotKeyApiKey()) || key,
    };
    // Documented community mutation name used by several bots
    const query = `mutation($id:ID!,$target:ID!){
      assignTaxBracket(id:$id, target_id:$target) { id }
    }`;
    const res = await fetch("https://api.politicsandwar.com/graphql", {
      method: "POST",
      headers,
      body: JSON.stringify({
        query,
        variables: { id: String(taxBracketId), target: String(nationId) },
      }),
      cache: "no-store",
    });
    const text = await res.text();
    let json: { data?: unknown; errors?: { message: string }[] } = {};
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    if (json.errors?.length) return { ok: false, error: json.errors[0].message };
    if (!json.data) return { ok: false, error: "No data from assignTaxBracket" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "tax assign failed" };
  }
}

/**
 * After tax apply: any nation whose active grants are all paid → notify + optional auto tax move.
 */
export async function processFullyRepaidNations(settings: GrantRepaySettings): Promise<{
  completedNations: number;
  notified: number;
  taxMoved: number;
}> {
  const supa = db();
  const { data: grants } = await supa
    .from("econ_grants")
    .select(
      "id, nation_id, leader_name, nation_name, amounts, original_amounts, repaid_amounts, repay_status, status, meta"
    )
    .eq("status", "active");

  // Group by nation
  const byNation = new Map<
    number,
    {
      grants: typeof grants;
      leader?: string | null;
      nationName?: string | null;
    }
  >();
  for (const g of grants ?? []) {
    const nid = Number(g.nation_id);
    if (!nid) continue;
    const row = byNation.get(nid) || { grants: [] as NonNullable<typeof grants>, leader: g.leader_name, nationName: g.nation_name };
    row.grants = [...(row.grants || []), g];
    if (g.leader_name) row.leader = g.leader_name;
    if (g.nation_name) row.nationName = g.nation_name;
    byNation.set(nid, row);
  }

  let completedNations = 0;
  let notified = 0;
  let taxMoved = 0;

  for (const [nationId, pack] of byNation) {
    let totalO = 0;
    let totalR = 0;
    let allPaid = true;
    for (const g of pack.grants || []) {
      const original = cleanAmounts(g.original_amounts || g.amounts);
      const raw = (g.repaid_amounts || {}) as Record<string, number>;
      const oVal = amountsValue(original);
      const rVal =
        Number(raw._value) > 0 ? Number(raw._value) : amountsValue(cleanAmounts(raw));
      totalO += oVal;
      totalR += rVal;
      if (rVal < oVal - 0.01 && String(g.repay_status) !== "paid") allPaid = false;
    }
    if (!allPaid || totalO <= 0) continue;
    if (totalR < totalO - 0.01) continue;

    // Already notified?
    const already = pack.grants?.some(
      (g) => (g.meta as { fully_repaid_notified?: boolean } | null)?.fully_repaid_notified
    );
    if (already) continue;

    completedNations += 1;

    // Mark grants completed
    for (const g of pack.grants || []) {
      const meta = { ...((g.meta as object) || {}), fully_repaid_notified: true, fully_repaid_at: new Date().toISOString() };
      await supa
        .from("econ_grants")
        .update({
          repay_status: "paid",
          status: "completed",
          meta,
        })
        .eq("id", g.id);
    }

    let moved: boolean | null = null;
    let moveErr: string | null = null;
    if (settings.auto_remove && settings.default_tax_id) {
      const r = await tryAssignTaxBracket(nationId, settings.default_tax_id);
      if (r.ok) {
        moved = true;
        taxMoved += 1;
      } else {
        moved = false;
        moveErr = r.error;
      }
    }

    await notifyGrantFullyRepaid({
      nationId,
      leaderName: pack.leader,
      nationName: pack.nationName,
      totalValue: totalO,
      taxMoved: moved,
      taxMoveError: moveErr,
      defaultTaxId: settings.default_tax_id ?? null,
    });
    notified += 1;
  }

  return { completedNations, notified, taxMoved };
}

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

/**
 * One-time / gov: create econ_grants rows from paid GRANT requests that were never tracked.
 */
export async function backfillGrantsFromPaidRequests(): Promise<{
  created: number;
  skipped: number;
  errors: string[];
}> {
  const supa = db();
  const errors: string[] = [];
  let created = 0;
  let skipped = 0;

  const { data: paid, error } = await supa
    .from("econ_requests")
    .select(
      "id, amounts, purpose, member_id, decided_by, econ_members(nation_id, leader_name, discord_id, nation_name)"
    )
    .eq("kind", "grant")
    .eq("status", "paid")
    .limit(2000);
  if (error) return { created: 0, skipped: 0, errors: [error.message] };

  for (const req of paid ?? []) {
    const { count } = await supa
      .from("econ_grants")
      .select("id", { count: "exact", head: true })
      .contains("meta", { request_id: req.id });
    if ((count ?? 0) > 0) {
      skipped += 1;
      continue;
    }
    const mem = Array.isArray(req.econ_members) ? req.econ_members[0] : req.econ_members;
    const nationId = Number((mem as { nation_id?: number } | null)?.nation_id || 0);
    if (!nationId) {
      skipped += 1;
      continue;
    }
    const amounts = (req.amounts || {}) as Record<string, number>;
    const clean = cleanAmounts(amounts);
    if (!Object.keys(clean).length) {
      skipped += 1;
      continue;
    }
    const { error: insErr } = await supa.from("econ_grants").insert({
      member_id: req.member_id,
      nation_id: nationId,
      leader_name: (mem as { leader_name?: string } | null)?.leader_name ?? null,
      nation_name: (mem as { nation_name?: string } | null)?.nation_name ?? null,
      discord_id: (mem as { discord_id?: string } | null)?.discord_id
        ? String((mem as { discord_id?: string }).discord_id)
        : null,
      grant_type: "request",
      amounts: clean,
      original_amounts: clean,
      repaid_amounts: { _value: 0 },
      repay_status: "open",
      meta: { source: "grant_request_backfill", request_id: req.id },
      status: "active",
      note: req.purpose ? String(req.purpose) : `Backfill grant ${String(req.id).slice(0, 8)}`,
      issued_by: req.decided_by || "backfill",
      approved_by: req.decided_by || "backfill",
    });
    if (insErr) errors.push(`${req.id}: ${insErr.message}`);
    else created += 1;
  }
  return { created, skipped, errors };
}
