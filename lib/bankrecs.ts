/**
 * In-game deposits -> site balances.
 *
 * Polls P&W bank records for the main alliance and the offshore alliance, and credits each deposit
 * (nation -> alliance) exactly once. The bank-record ID is the idempotency key everywhere.
 *
 *  - Main alliance deposit: credits that member's site balance. If the nation has not joined the site yet,
 *    the deposit waits in econ_pending_deposits and is credited as soon as they log in.
 *  - Offshore alliance deposit from a "trusted depositor" (e.g. the offshore owner): credits that person's site
 *    balance if they are a member, AND adds the amount to the "Evergreen net at offshore" books.
 *  - Notes containing #ignore are skipped.
 *
 * The exact names of the fields and filters are read from the live schema, so a rename on the game's side
 * produces a clear message ("Check bank records") instead of silently crediting nothing.
 */
import { db } from "@/lib/supabase";
import { getSetting, setSetting } from "@/lib/settings";
import { getBankApiKey, getOffshoreApiKey, getPnwApiKey } from "@/lib/secrets";
import { sendDepositConfirmation } from "@/lib/depositNotify";

const RES = ["money", "food", "coal", "oil", "uranium", "lead", "iron", "bauxite", "gasoline", "munitions", "steel", "aluminum"] as const;
const URL_BASE = "https://api.politicsandwar.com/graphql";
const PAGE = 200;
const MAX_PAGES = 15;

export type Which = "main" | "offshore";

async function readKey(which: Which): Promise<string> {
  const key = which === "offshore" ? await getOffshoreApiKey() : (await getBankApiKey()) || (await getPnwApiKey());
  if (!key) {
    throw new Error(
      which === "offshore"
        ? "The offshore API key isn't set (Gov > Keys)."
        : "The main bank API key isn't set (Gov > Keys)."
    );
  }
  return key;
}

async function gql<T>(which: Which, query: string, variables: Record<string, unknown>): Promise<T> {
  const key = await readKey(which);
  const res = await fetch(`${URL_BASE}?api_key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (res.status === 401) throw new Error(`P&W refused the ${which} API key (401). Check it on Gov > Keys.`);
  const text = await res.text();
  let json: { data?: T; errors?: { message: string }[] } = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`P&W API HTTP ${res.status}: ${text.slice(0, 160)}`);
  if (json.errors?.length) throw new Error(json.errors[0].message);
  if (!json.data) throw new Error("P&W API returned no data");
  return json.data;
}

/* ---------- schema ---------- */

type TypeRef = { kind: string; name: string | null; ofType: TypeRef | null };
const typeName = (t: TypeRef | null): string =>
  !t ? "?" : t.kind === "NON_NULL" ? `${typeName(t.ofType)}!` : t.kind === "LIST" ? `[${typeName(t.ofType)}]` : t.name ?? "?";

type Schema = { args: { name: string; type: string }[]; fields: string[] };
let schemaCache: Schema | null = null;

export async function bankrecSchema(which: Which = "main", fresh = false): Promise<Schema> {
  if (schemaCache && !fresh) return schemaCache;
  const data = await gql<{
    q: { fields: { name: string; args: { name: string; type: TypeRef }[] }[] } | null;
    r: { fields: { name: string }[] } | null;
  }>(
    which,
    `{ q: __type(name:"Query"){ fields { name args { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } r: __type(name:"BankRecord"){ fields { name } } }`,
    {}
  );
  const f = data.q?.fields?.find((x) => x.name === "bankrecs");
  if (!f) throw new Error("This API doesn't offer bankrecs to this key.");
  schemaCache = { args: f.args.map((a) => ({ name: a.name, type: typeName(a.type) })), fields: (data.r?.fields ?? []).map((x) => x.name) };
  return schemaCache;
}

type Shape = {
  argRid: string; argRtype: string | null; argMin: string; argFirst: string | null;
  typeOf: Record<string, string>;
  fId: string; fDate: string; fNote: string | null;
  fSid: string; fStype: string; fRid: string; fRtype: string;
  fRes: string[];
};

function shapeOf(s: Schema): Shape {
  const an = s.args.map((a) => a.name);
  const pickArg = (...c: string[]) => c.find((n) => an.includes(n)) ?? null;
  const pickField = (...c: string[]) => c.find((n) => s.fields.includes(n)) ?? null;
  const argRid = pickArg("rid", "receiver_id");
  const argMin = pickArg("min_id");
  const fId = pickField("id");
  const fDate = pickField("date");
  const fSid = pickField("sender_id", "sid");
  const fStype = pickField("sender_type", "stype");
  const fRid = pickField("receiver_id", "rid");
  const fRtype = pickField("receiver_type", "rtype");
  const missing: string[] = [];
  if (!argRid) missing.push("receiver filter (rid)");
  if (!argMin) missing.push("min_id");
  if (!fId) missing.push("id");
  if (!fDate) missing.push("date");
  if (!fSid) missing.push("sender id");
  if (!fStype) missing.push("sender type");
  if (!fRid) missing.push("receiver id");
  if (!fRtype) missing.push("receiver type");
  if (missing.length) {
    throw new Error(
      `The game's bank-record API looks different than expected (missing: ${missing.join(", ")}). ` +
        `Arguments: ${an.join(", ")}. Fields: ${s.fields.join(", ")}.`
    );
  }
  const typeOf: Record<string, string> = {};
  for (const a of s.args) typeOf[a.name] = a.type;
  return {
    argRid: argRid!, argRtype: pickArg("rtype", "receiver_type"), argMin: argMin!, argFirst: pickArg("first"),
    typeOf, fId: fId!, fDate: fDate!, fNote: pickField("note"),
    fSid: fSid!, fStype: fStype!, fRid: fRid!, fRtype: fRtype!,
    fRes: RES.filter((r) => s.fields.includes(r)),
  };
}

/* ---------- reading records ---------- */

export type Rec = {
  id: number; date: string; senderId: number; senderType: number;
  receiverId: number; receiverType: number; note: string; amounts: Record<string, number>;
};

async function fetchPage(which: Which, allianceId: number, afterId: number, shape: Shape): Promise<Rec[]> {
  const decl: string[] = [];
  const call: string[] = [];
  const vars: Record<string, unknown> = {};
  const add = (arg: string, value: unknown, asList: boolean) => {
    const t = shape.typeOf[arg];
    decl.push(`$${arg}: ${t}`);
    call.push(`${arg}: $${arg}`);
    vars[arg] = t.startsWith("[") || asList ? (Array.isArray(value) ? value : [value]) : value;
  };
  add(shape.argRid, allianceId, false);
  if (shape.argRtype && /Int|ID|Float/.test(shape.typeOf[shape.argRtype])) add(shape.argRtype, 2, false);
  add(shape.argMin, afterId + 1, false);
  if (shape.argFirst) add(shape.argFirst, PAGE, false);

  const sel = [shape.fId, shape.fDate, shape.fNote, shape.fSid, shape.fStype, shape.fRid, shape.fRtype, ...shape.fRes].filter(Boolean).join(" ");
  const data = await gql<{ bankrecs: { data: Record<string, unknown>[] } }>(
    which, `query(${decl.join(", ")}) { bankrecs(${call.join(", ")}) { data { ${sel} } } }`, vars
  );
  return (data.bankrecs?.data ?? []).map((r) => {
    const amounts: Record<string, number> = {};
    for (const k of shape.fRes) {
      const v = Number(r[k] ?? 0);
      if (v > 0.0001) amounts[k] = Math.round(v * 100) / 100;
    }
    return {
      id: Number(r[shape.fId]), date: String(r[shape.fDate] ?? ""),
      senderId: Number(r[shape.fSid]), senderType: Number(r[shape.fStype]),
      receiverId: Number(r[shape.fRid]), receiverType: Number(r[shape.fRtype]),
      note: shape.fNote ? String(r[shape.fNote] ?? "") : "", amounts,
    };
  }).filter((r) => Number.isFinite(r.id)).sort((a, b) => a.id - b.id);
}

/** Read-only check shown on the Gov screen. */
export async function diagnoseBankrecs(which: Which = "main") {
  const out: Record<string, unknown> = {};
  try {
    const s = await bankrecSchema(which, true);
    out.arguments = s.args.map((a) => `${a.name}: ${a.type}`);
    out.fields = s.fields;
    try { shapeOf(s); out.ok = true; } catch (e) { out.ok = false; out.problem = e instanceof Error ? e.message : "unexpected shape"; }
  } catch (e) {
    out.ok = false;
    out.problem = e instanceof Error ? e.message : "could not read the schema";
  }
  return out;
}

/* ---------- sync ---------- */

type Cursor = { start?: string; main?: number; offshore?: number };
type BooksCfg = { baseline?: Record<string, number>; trusted_depositors?: number[] };
type Member = { id: string; discord_id: string; leader_name: string | null; status: string; nation_id: number };

export type SyncResult = {
  skipped?: boolean; reason?: string;
  fetched: number; credited: number; pending: number; ignored: number; booksCredits: number; dms: number;
  errors: string[];
};

const empty = (): SyncResult => ({ fetched: 0, credited: 0, pending: 0, ignored: 0, booksCredits: 0, dms: 0, errors: [] });

export async function syncBankrecs(opts: { minIntervalMs?: number; force?: boolean } = {}): Promise<SyncResult> {
  const supa = db();
  const state = await getSetting<{ locked_at?: string; last_run?: string; last_result?: SyncResult }>("bankrec_sync", {});
  const now = Date.now();
  if (state.locked_at && now - Date.parse(state.locked_at) < 150_000) {
    return { ...empty(), skipped: true, reason: "A sync is already running" };
  }
  if (!opts.force && opts.minIntervalMs && state.last_run && now - Date.parse(state.last_run) < opts.minIntervalMs) {
    return { ...empty(), skipped: true, reason: "Synced recently" };
  }
  await setSetting("bankrec_sync", { ...state, locked_at: new Date(now).toISOString() });

  const result = empty();
  try {
    const alliance = await getSetting<{ alliance_id?: number | null }>("alliance", {});
    const offshore = await getSetting<{ offshore_alliance_id?: number } | null>("offshore", null);
    const books = await getSetting<BooksCfg>("offshore_books", {});
    const trusted = new Set((books.trusted_depositors ?? []).map(Number));
    const cursor = await getSetting<Cursor>("bankrec_cursor", {});
    if (!cursor.start) cursor.start = new Date().toISOString(); // never credit history from before tracking began
    const startMs = Date.parse(cursor.start);

    const targets: { which: Which; allianceId: number }[] = [];
    if (alliance.alliance_id) targets.push({ which: "main", allianceId: Number(alliance.alliance_id) });
    if (offshore?.offshore_alliance_id) targets.push({ which: "offshore", allianceId: Number(offshore.offshore_alliance_id) });
    if (targets.length === 0) result.errors.push("No alliance is set up yet.");

    const memberCache = new Map<number, Member | null>();
    const lookup = async (nationId: number): Promise<Member | null> => {
      if (memberCache.has(nationId)) return memberCache.get(nationId) ?? null;
      const { data } = await supa.from("econ_members").select("id, discord_id, leader_name, status, nation_id").eq("nation_id", nationId).maybeSingle();
      const m = (data as Member | null) ?? null;
      memberCache.set(nationId, m);
      return m;
    };
    const credited = new Map<string, { member: Member; amounts: Record<string, number> }>();

    for (const t of targets) {
      let shape: Shape;
      try {
        shape = shapeOf(await bankrecSchema(t.which));
      } catch (e) {
        result.errors.push(`${t.which}: ${e instanceof Error ? e.message : "schema problem"}`);
        continue;
      }
      let last = Number(cursor[t.which] ?? 0);
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          const rows = await fetchPage(t.which, t.allianceId, last, shape);
          if (rows.length === 0) break;
          result.fetched += rows.length;

          for (const rec of rows) {
            last = Math.max(last, rec.id);
            if (Date.parse(rec.date) < startMs) continue;
            if (rec.senderType !== 1 || rec.receiverType !== 2 || rec.receiverId !== t.allianceId) continue;
            if (/#ignore/i.test(rec.note)) { result.ignored++; continue; }
            if (Object.keys(rec.amounts).length === 0) continue;

            const isOffshore = t.which === "offshore";
            if (isOffshore && !trusted.has(rec.senderId)) { result.ignored++; continue; }

            // 1) the depositor's own site balance
            const member = await lookup(rec.senderId);
            if (member && member.status === "active") {
              for (const [res, amt] of Object.entries(rec.amounts)) {
                const { data: inserted, error } = await supa.rpc("econ_credit_deposit", {
                  p_member: member.id, p_resource: res, p_amount: amt, p_bankrec: rec.id,
                  p_note: `In-game deposit (bank record #${rec.id})`,
                });
                if (error) { result.errors.push(`credit #${rec.id}: ${error.message}`); continue; }
                if (inserted) {
                  result.credited++;
                  const cur = credited.get(member.id) ?? { member, amounts: {} };
                  cur.amounts[res] = Math.round(((cur.amounts[res] ?? 0) + amt) * 100) / 100;
                  credited.set(member.id, cur);
                }
              }
            } else {
              const rowsP = Object.entries(rec.amounts).map(([resource, amount]) => ({
                bankrec_id: rec.id, nation_id: rec.senderId, resource, amount, note: rec.note.slice(0, 200), rec_date: rec.date,
              }));
              const { error } = await supa.from("econ_pending_deposits").upsert(rowsP, { onConflict: "bankrec_id,resource", ignoreDuplicates: true });
              if (error) result.errors.push(`pending #${rec.id}: ${error.message}`);
              else result.pending += rowsP.length;
            }

            // 2) Evergreen's net at the offshore (never from the offshore bank balance itself)
            if (isOffshore) {
              const { data: seen } = await supa.from("econ_audit_log").select("id").eq("action", "offshore_deposit_credit").contains("details", { bankrec_id: rec.id }).limit(1);
              if (!seen?.length) {
                const { error } = await supa.from("econ_audit_log").insert({
                  action: "offshore_deposit_credit",
                  details: { bankrec_id: rec.id, sender_nation: rec.senderId, amounts: rec.amounts },
                });
                if (error) result.errors.push(`books #${rec.id}: ${error.message}`);
                else result.booksCredits++;
              }
            }
          }
          if (rows.length < PAGE) break;
        }
      } catch (e) {
        result.errors.push(`${t.which}: ${e instanceof Error ? e.message : "sync problem"}`);
      }
      cursor[t.which] = last;
    }

    await setSetting("bankrec_cursor", cursor);

    // Deposits waiting for people who have since joined.
    const claimed = await supa.rpc("econ_claim_pending");
    if (claimed.error) result.errors.push(`claim: ${claimed.error.message}`);

    // Confirmation DMs (best effort; a failed DM never undoes a credit).
    for (const { member, amounts } of Array.from(credited.values()).slice(0, 20)) {
      try {
        const dm = await sendDepositConfirmation({
          discordId: String(member.discord_id), accountId: member.id, nationId: Number(member.nation_id),
          leaderName: member.leader_name, amounts,
        });
        if (dm.ok) result.dms++;
        else console.error("deposit DM failed:", dm.error);
      } catch (e) {
        console.error("deposit DM error:", e instanceof Error ? e.message : e);
      }
    }

    if (result.credited || result.pending || result.booksCredits) {
      await supa.from("econ_audit_log").insert({ action: "bankrec_sync", details: { ...result } });
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "sync failed");
  } finally {
    await setSetting("bankrec_sync", { last_run: new Date().toISOString(), locked_at: null, last_result: result });
  }
  return result;
}
