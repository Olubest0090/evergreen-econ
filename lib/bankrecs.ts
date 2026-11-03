/**
 * In-game deposits -> site balances.
 * Uses alliances { bankrecs } (last ~14 days, requires bank access).
 * No GraphQL introspection (P&W returns Internal server error on heavy __type queries).
 */
import { db } from "@/lib/supabase";
import { getSetting, setSetting } from "@/lib/settings";
import { getBankApiKey, getOffshoreApiKey, getPnwApiKey } from "@/lib/secrets";
import { sendDepositConfirmation } from "@/lib/depositNotify";

const RES = [
  "money", "food", "coal", "oil", "uranium", "lead",
  "iron", "bauxite", "gasoline", "munitions", "steel", "aluminum",
] as const;
const URL_BASE = "https://api.politicsandwar.com/graphql";

export type Which = "main" | "offshore";

async function readKey(which: Which): Promise<string> {
  const key =
    which === "offshore"
      ? await getOffshoreApiKey()
      : (await getBankApiKey()) || (await getPnwApiKey());
  if (!key) {
    throw new Error(
      which === "offshore"
        ? "The offshore API key isn't set (Gov > Keys)."
        : "The main bank API key isn't set (Gov > Keys)."
    );
  }
  return key;
}

async function gql<T>(which: Which, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const key = await readKey(which);
  const res = await fetch(`${URL_BASE}?api_key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (res.status === 401) {
    throw new Error(`P&W refused the ${which} API key (401). Check it on Gov > Keys.`);
  }
  const text = await res.text();
  let json: { data?: T; errors?: { message: string }[] } = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new Error(`P&W API HTTP ${res.status}: ${text.slice(0, 200)}`);
  if (json.errors?.length) throw new Error(json.errors[0].message);
  if (!json.data) throw new Error("P&W API returned no data");
  return json.data;
}

export type Rec = {
  id: number;
  date: string;
  senderId: number;
  senderType: number;
  receiverId: number;
  receiverType: number;
  note: string;
  amounts: Record<string, number>;
};

/** Fetch recent bank records for an alliance (game returns ~last 14 days). */
async function fetchAllianceBankrecs(which: Which, allianceId: number): Promise<Rec[]> {
  const data = await gql<{
    alliances: {
      data: {
        id: string | number;
        bankrecs: Record<string, unknown>[] | null;
      }[];
    };
  }>(
    which,
    `query($id: [Int]) {
      alliances(id: $id, first: 1) {
        data {
          id
          bankrecs {
            id date note
            sid stype rid rtype
            money food coal oil uranium lead iron bauxite gasoline munitions steel aluminum
          }
        }
      }
    }`,
    { id: [allianceId] }
  );

  const row = data.alliances?.data?.[0];
  if (!row) throw new Error(`Alliance #${allianceId} not found or key has no access.`);
  const list = row.bankrecs ?? [];
  return list
    .map((r) => {
      const amounts: Record<string, number> = {};
      for (const k of RES) {
        const v = Number(r[k] ?? 0);
        if (v > 0.0001) amounts[k] = Math.round(v * 100) / 100;
      }
      return {
        id: Number(r.id),
        date: String(r.date ?? ""),
        senderId: Number(r.sid),
        senderType: Number(r.stype),
        receiverId: Number(r.rid),
        receiverType: Number(r.rtype),
        note: String(r.note ?? ""),
        amounts,
      };
    })
    .filter((r) => Number.isFinite(r.id))
    .sort((a, b) => a.id - b.id);
}

/** Read-only check shown on the Gov screen. */
export async function diagnoseBankrecs(which: Which = "main") {
  const out: Record<string, unknown> = { which };
  try {
    const alliance =
      which === "offshore"
        ? await getSetting<{ offshore_alliance_id?: number } | null>("offshore", null)
        : await getSetting<{ alliance_id?: number | null }>("alliance", {});
    const aa =
      which === "offshore"
        ? Number((alliance as { offshore_alliance_id?: number } | null)?.offshore_alliance_id || 0)
        : Number((alliance as { alliance_id?: number | null })?.alliance_id || 0);
    if (!aa) {
      out.ok = false;
      out.problem = which === "offshore" ? "Offshore alliance ID not set" : "Main alliance ID not set";
      return out;
    }
    const rows = await fetchAllianceBankrecs(which, aa);
    out.ok = true;
    out.allianceId = aa;
    out.recordCount = rows.length;
    out.sample = rows.slice(-3).map((r) => ({
      id: r.id,
      date: r.date,
      sid: r.senderId,
      stype: r.senderType,
      rid: r.receiverId,
      rtype: r.receiverType,
      note: r.note.slice(0, 40),
      amounts: r.amounts,
    }));
  } catch (e) {
    out.ok = false;
    out.problem = e instanceof Error ? e.message : "could not read bank records";
  }
  return out;
}

type Cursor = { start?: string; main?: number; offshore?: number };
type BooksCfg = { baseline?: Record<string, number>; trusted_depositors?: number[] };
type Member = {
  id: string;
  discord_id: string;
  leader_name: string | null;
  status: string;
  nation_id: number;
};

export type SyncResult = {
  skipped?: boolean;
  reason?: string;
  fetched: number;
  credited: number;
  pending: number;
  ignored: number;
  booksCredits: number;
  dms: number;
  errors: string[];
};

const empty = (): SyncResult => ({
  fetched: 0,
  credited: 0,
  pending: 0,
  ignored: 0,
  booksCredits: 0,
  dms: 0,
  errors: [],
});

export async function syncBankrecs(opts: { minIntervalMs?: number; force?: boolean } = {}): Promise<SyncResult> {
  const supa = db();
  const state = await getSetting<{ locked_at?: string; last_run?: string; last_result?: SyncResult }>(
    "bankrec_sync",
    {}
  );
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
    const offshore = await getSetting<{
      offshore_alliance_id?: number;
      banker_nation_id?: number;
    } | null>("offshore", null);
    const books = await getSetting<BooksCfg>("offshore_books", {});
    const trusted = new Set((books.trusted_depositors ?? []).map(Number).filter((n) => n > 0));
    const bankerId = Number(offshore?.banker_nation_id || 0);
    if (bankerId > 0) trusted.add(bankerId);
    // Always trust 633226 if listed historically — user set top-up nations in UI

    const cursor = await getSetting<Cursor>("bankrec_cursor", {});
    if (!cursor.start) cursor.start = new Date().toISOString();
    const startMs = Date.parse(cursor.start);

    const targets: { which: Which; allianceId: number }[] = [];
    if (alliance.alliance_id) targets.push({ which: "main", allianceId: Number(alliance.alliance_id) });
    if (offshore?.offshore_alliance_id)
      targets.push({ which: "offshore", allianceId: Number(offshore.offshore_alliance_id) });
    if (targets.length === 0) result.errors.push("No alliance is set up yet.");

    const memberCache = new Map<number, Member | null>();
    const lookup = async (nationId: number): Promise<Member | null> => {
      if (memberCache.has(nationId)) return memberCache.get(nationId) ?? null;
      const { data } = await supa
        .from("econ_members")
        .select("id, discord_id, leader_name, status, nation_id")
        .eq("nation_id", nationId)
        .maybeSingle();
      const m = (data as Member | null) ?? null;
      memberCache.set(nationId, m);
      return m;
    };
    const credited = new Map<string, { member: Member; amounts: Record<string, number> }>();

    for (const t of targets) {
      let rows: Rec[] = [];
      try {
        rows = await fetchAllianceBankrecs(t.which, t.allianceId);
      } catch (e) {
        result.errors.push(`${t.which}: ${e instanceof Error ? e.message : "fetch failed"}`);
        continue;
      }
      result.fetched += rows.length;
      let last = Number(cursor[t.which] ?? 0);

      for (const rec of rows) {
        if (rec.id <= last) continue;
        last = Math.max(last, rec.id);
        if (Date.parse(rec.date) < startMs) continue;
        // Nation -> alliance deposit only
        if (rec.senderType !== 1 || rec.receiverType !== 2 || rec.receiverId !== t.allianceId) continue;
        if (/#ignore/i.test(rec.note)) {
          result.ignored++;
          continue;
        }
        if (Object.keys(rec.amounts).length === 0) continue;

        const isOffshore = t.which === "offshore";
        if (isOffshore && trusted.size > 0 && !trusted.has(rec.senderId)) {
          result.ignored++;
          continue;
        }

        const member = await lookup(rec.senderId);
        if (member && member.status === "active") {
          for (const [res, amt] of Object.entries(rec.amounts)) {
            const { data: inserted, error } = await supa.rpc("econ_credit_deposit", {
              p_member: member.id,
              p_resource: res,
              p_amount: amt,
              p_bankrec: rec.id,
              p_note: `In-game deposit (bank record #${rec.id})`,
            });
            if (error) {
              result.errors.push(`credit #${rec.id}: ${error.message}`);
              continue;
            }
            if (inserted) {
              result.credited++;
              const cur = credited.get(member.id) ?? { member, amounts: {} };
              cur.amounts[res] = Math.round(((cur.amounts[res] ?? 0) + amt) * 100) / 100;
              credited.set(member.id, cur);
            }
          }
        } else {
          const rowsP = Object.entries(rec.amounts).map(([resource, amount]) => ({
            bankrec_id: rec.id,
            nation_id: rec.senderId,
            resource,
            amount,
            note: rec.note.slice(0, 200),
            rec_date: rec.date,
          }));
          const { error } = await supa
            .from("econ_pending_deposits")
            .upsert(rowsP, { onConflict: "bankrec_id,resource", ignoreDuplicates: true });
          if (error) result.errors.push(`pending #${rec.id}: ${error.message}`);
          else result.pending += rowsP.length;
        }

        if (isOffshore) {
          const { data: seen } = await supa
            .from("econ_audit_log")
            .select("id")
            .eq("action", "offshore_deposit_credit")
            .contains("details", { bankrec_id: rec.id })
            .limit(1);
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
      cursor[t.which] = last;
    }

    await setSetting("bankrec_cursor", cursor);

    const claimed = await supa.rpc("econ_claim_pending");
    if (claimed.error) result.errors.push(`claim: ${claimed.error.message}`);

    for (const { member, amounts } of Array.from(credited.values()).slice(0, 20)) {
      try {
        const dm = await sendDepositConfirmation({
          discordId: String(member.discord_id),
          accountId: member.id,
          nationId: Number(member.nation_id),
          leaderName: member.leader_name,
          amounts,
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
    await setSetting("bankrec_sync", {
      last_run: new Date().toISOString(),
      locked_at: null,
      last_result: result,
    });
  }
  return result;
}

/** Kept for imports that expect schema helper — fixed shape, no live introspection. */
export async function bankrecSchema(_which: Which = "main", _fresh = false) {
  return {
    args: [
      { name: "rid", type: "[Int]" },
      { name: "rtype", type: "[Int]" },
      { name: "min_id", type: "Int" },
      { name: "first", type: "Int" },
    ],
    fields: [
      "id", "date", "note", "sid", "stype", "rid", "rtype",
      ...RES,
    ],
  };
}
