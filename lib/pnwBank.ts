/**
 * Politics & War bank access.
 *
 * Reading uses a plain API key. Mutations (bankWithdraw) need the verified bot key as well.
 * Two accounts can be involved:
 *   - the "acting" nation: the account whose alliance bank the money comes from (its API key goes in the URL), and
 *   - the account that owns the verified bot key (BOT_KEY_API_KEY). If that is the same account, leave it unset.
 *
 * Environment variables:
 *   VERIFIED_BOT_KEY    the verified bot key (can also be set from the site's Keys screen)
 *   BOT_KEY_API_KEY     (optional) API key of the account that owns the bot key
 *   BANK_API_KEY        (optional) acting nation in the SOURCE alliance (falls back to PNW_API_KEY)
 *   OFFSHORE_API_KEY    (optional) acting nation in the OFFSHORE alliance (falls back to BANK_API_KEY, then PNW_API_KEY)
 */

import {
  getPnwApiKey,
  getVerifiedBotKey,
  getBotKeyApiKey,
  getBankApiKey,
  getOffshoreApiKey,
} from "@/lib/secrets";

const RES = [
  "money", "coal", "oil", "uranium", "iron", "bauxite", "lead",
  "gasoline", "munitions", "steel", "aluminum", "food",
] as const;

export type BankAmounts = Partial<Record<(typeof RES)[number], number>>;
export type Actor = "source" | "offshore";

const URL_BASE = "https://api.politicsandwar.com/graphql";

/** Site Keys (/gov/keys) override Vercel for every bank path. */
async function actingKey(actor: Actor): Promise<{ key: string; name: string }> {
  if (actor === "offshore") {
    const off = await getOffshoreApiKey();
    if (off) return { key: off, name: "OFFSHORE_API_KEY" };
    // Never fall back to another bank's key: that would pay from the wrong bank.
    throw new Error("The offshore API key is not set. Add OFFSHORE_API_KEY on /gov/keys (or Vercel).");
  } else {
    const bank = await getBankApiKey();
    if (bank) return { key: bank, name: "BANK_API_KEY" };
  }
  const shared = await getPnwApiKey();
  if (shared) return { key: shared, name: "PNW_API_KEY" };
  throw new Error(
    `No API key is set for the ${actor} bank (set OFFSHORE_API_KEY / BANK_API_KEY on /gov/keys or Vercel)`
  );
}

export async function keyStatus() {
  return {
    botKey: !!(await getVerifiedBotKey()),
    botKeyApiKey: !!(await getBotKeyApiKey()),
    bankKey: !!(await getBankApiKey()),
    offshoreKey: !!(await getOffshoreApiKey()),
  };
}

type GqlResult<T> = { status: number; json: { data?: T; errors?: { message: string }[] }; text: string };

async function send<T>(actor: Actor, query: string, variables: Record<string, unknown>, withBot: boolean): Promise<GqlResult<T>> {
  const { key } = await actingKey(actor);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url = `${URL_BASE}?api_key=${encodeURIComponent(key)}`;
  if (withBot) {
    const botKey = await getVerifiedBotKey();
    if (!botKey) throw new Error("The verified bot key is not set (Vercel VERIFIED_BOT_KEY, or the Keys screen)");
    headers["X-Bot-Key"] = botKey;
    const owner = await getBotKeyApiKey();
    if (owner) headers["X-Api-Key"] = owner;
    else {
      // Same account owns the bot key and acts on the bank: send its key in the header only.
      headers["X-Api-Key"] = key;
      url = URL_BASE;
    }
  }
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query, variables }), cache: "no-store" });
  const text = await res.text();
  let json: GqlResult<T>["json"] = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

const UNAUTH =
  "P&W returned 401 (unauthorized). The bot key and the API key(s) don't belong together. " +
  "Set BOT_KEY_API_KEY to the API key of the account that owns the verified bot key, and make sure the acting nation " +
  "(BANK_API_KEY / OFFSHORE_API_KEY) has bank access in its alliance and has allowed the bot.";

async function run<T>(actor: Actor, query: string, variables: Record<string, unknown>, withBot: boolean): Promise<T> {
  const r = await send<T>(actor, query, variables, withBot);
  if (r.status === 401) throw new Error(UNAUTH);
  if (r.status < 200 || r.status >= 300) throw new Error(`P&W API HTTP ${r.status}: ${r.text.slice(0, 180)}`);
  if (r.json.errors?.length) throw new Error(r.json.errors[0].message);
  if (!r.json.data) throw new Error("P&W API returned no data");
  return r.json.data;
}

/* ---------- reading ---------- */

export async function fetchAllianceBank(allianceId: number, actor: Actor = "source"): Promise<BankAmounts> {
  const data = await run<{ alliances: { data: Record<string, number | null>[] } }>(
    actor,
    `query($id:[Int]){ alliances(id:$id){ data { money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food } } }`,
    { id: [allianceId] },
    false
  );
  const row = data.alliances?.data?.[0];
  if (!row) throw new Error("Alliance bank not found or this API key cannot see that bank");
  const out: BankAmounts = {};
  for (const k of RES) {
    const v = Number(row[k] ?? 0);
    if (v > 0.0001) out[k] = Math.floor(v * 100) / 100;
  }
  return out;
}

/** First member nation in an alliance (fallback banker). */
export async function firstNationInAlliance(allianceId: number, actor: Actor = "source"): Promise<number | null> {
  const data = await run<{ nations: { data: { id: string; alliance_position: string | null }[] } }>(
    actor,
    `query($a:[Int]){ nations(alliance_id:$a, first:50){ data { id alliance_position } } }`,
    { a: [allianceId] },
    false
  );
  const rows = data.nations?.data ?? [];
  const nonApp = rows.find((n) => (n.alliance_position || "").toUpperCase() !== "APPLICANT");
  const id = Number((nonApp || rows[0])?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/* ---------- what the API really accepts ---------- */

type TypeRef = { kind: string; name: string | null; ofType: TypeRef | null };
const typeName = (t: TypeRef | null): string =>
  !t ? "?" : t.kind === "NON_NULL" ? `${typeName(t.ofType)}!` : t.kind === "LIST" ? `[${typeName(t.ofType)}]` : t.name ?? "?";

let argCache: { name: string; type: string }[] | null = null;

/** The arguments bankWithdraw accepts, read from the live schema. */
export async function bankWithdrawArgs(actor: Actor = "source"): Promise<{ name: string; type: string }[]> {
  if (argCache) return argCache;
  const data = await run<{ __type: { fields: { name: string; args: { name: string; type: TypeRef }[] }[] } | null }>(
    actor,
    `{ __type(name:"Mutation"){ fields { name args { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } }`,
    {},
    false
  );
  const f = data.__type?.fields?.find((x) => x.name === "bankWithdraw");
  if (!f) throw new Error("This API doesn't offer bankWithdraw to this key");
  argCache = f.args.map((a) => ({ name: a.name, type: typeName(a.type) }));
  return argCache;
}

export async function diagnose(actor: Actor) {
  const out: Record<string, unknown> = { actor, keys: await keyStatus() };
  try {
    out.actingKeyFrom = (await actingKey(actor)).name;
  } catch (e) {
    out.actingKeyFrom = e instanceof Error ? e.message : "none";
    return out;
  }
  try {
    const who = await run<{ me: { nation: { id: string; nation_name: string; alliance_id: string | null } } }>(
      actor, `{ me { nation { id nation_name alliance_id } } }`, {}, false
    );
    out.actingNation = who.me?.nation ?? null;
  } catch (e) {
    out.actingNation = `could not read: ${e instanceof Error ? e.message : "error"}`;
  }
  try {
    await run(actor, `{ me { nation { id } } }`, {}, true);
    out.botHeaders = "accepted";
  } catch (e) {
    out.botHeaders = e instanceof Error ? e.message : "rejected";
  }
  try {
    argCache = null;
    out.bankWithdrawArgs = (await bankWithdrawArgs(actor)).map((a) => `${a.name}: ${a.type}`);
  } catch (e) {
    out.bankWithdrawArgs = e instanceof Error ? e.message : "could not read";
  }
  return out;
}

/* ---------- sending ---------- */

export async function bankWithdraw(opts: {
  actor: Actor;
  receiver: number;
  receiverType: "nation" | "alliance";
  amounts: BankAmounts;
  note: string;
}): Promise<{ ok: true; id: string | null; raw: unknown } | { ok: false; error: string }> {
  try {
    const args = await bankWithdrawArgs(opts.actor);
    const has = (n: string) => args.find((a) => a.name === n);
    // Schema expects receiver: ID! (string), not Int! — hardcoding Int! causes the GraphQL error.
    const recvArg = has("receiver");
    const recvType = recvArg?.type?.includes("ID") ? "ID!" : recvArg?.type?.includes("Int") ? "Int!" : "ID!";
    const vars: Record<string, unknown> = {
      receiver: recvType.startsWith("ID") ? String(opts.receiver) : opts.receiver,
      note: (opts.note || "Evergreen Econ").slice(0, 50),
    };
    const decl: string[] = [`$receiver: ${recvType}`, "$note: String"];
    const call: string[] = ["receiver: $receiver", "note: $note"];

    const rt = has("receiver_type");
    if (rt) {
      vars.receiver_type = opts.receiverType === "alliance" ? 2 : 1;
      decl.push(`$receiver_type: ${rt.type.endsWith("!") ? "Int!" : "Int"}`);
      call.push("receiver_type: $receiver_type");
    } else if (opts.receiverType === "alliance") {
      return { ok: false, error: "This API only pays nations. Set a banker nation in the offshore alliance." };
    }

    let any = false;
    for (const k of RES) {
      const v = opts.amounts[k];
      if (v == null || v <= 0) continue;
      if (!has(k)) return { ok: false, error: `The API doesn't accept ${k} in bankWithdraw` };
      decl.push(`$${k}: Float`);
      call.push(`${k}: $${k}`);
      vars[k] = v;
      any = true;
    }
    if (!any) return { ok: false, error: "Nothing to send" };

    const mutation = `mutation(${decl.join(", ")}) { bankWithdraw(${call.join(", ")}) { id date } }`;
    const data = await run<{ bankWithdraw: { id?: string | number } | null }>(opts.actor, mutation, vars, true);
    return { ok: true, id: data.bankWithdraw?.id != null ? String(data.bankWithdraw.id) : null, raw: data.bankWithdraw };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bank withdraw failed" };
  }
}

export { RES as BANK_RESOURCES };

/** Kept so older code keeps working: pays a nation from the main (source) bank. */
export async function bankWithdrawToNation(
  receiverNationId: number,
  amounts: BankAmounts,
  note: string
): Promise<{ ok: true; raw: unknown } | { ok: false; error: string }> {
  const r = await bankWithdraw({ actor: "source", receiver: receiverNationId, receiverType: "nation", amounts, note });
  return r.ok ? { ok: true, raw: r.raw } : r;
}
