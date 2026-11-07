/**
 * In-game deposits → site balances (reliable path).
 *
 * Uses top-level `bankrecs` GraphQL (paginated) — same source as the game bank page.
 * Cursor only advances after a row is successfully credited, pending, or intentionally ignored.
 * No GraphQL introspection (avoids P&W "Internal server error").
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

type Cursor = { start?: string; main?: number; offshore?: number };
type BooksCfg = { baseline?: Record<string, number>; trusted_depositors?: number[] };
type Member = {
  id: string;
  discord_id: string;
  leader_name: string | null;
  status: string;
  nation_id: number;
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

async function readKey(which: Which): Promise<string> {
  const key =
    which === "offshore"
      ? await getOffshoreApiKey()
      : (await getBankApiKey()) || (await getPnwApiKey());
  if (!key) {
    throw new Error(
      which === "offshore"
        ? "Offshore API key not set (Gov → Keys)."
        : "Main bank / PNW API key not set (Gov → Keys)."
    );
  }
  return key;
}

async function gql<T>(apiKey: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${URL_BASE}?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (res.status === 401) {
    throw new Error("P&W 401 — API key refused. Check Gov → Keys.");
  }
  const text = await res.text();
  let json: { data?: T; errors?: { message: string }[] } = {};
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`P&W returned non-JSON (HTTP ${res.status}): ${text.slice(0, 160)}`);
  }
  if (!res.ok) {
    throw new Error(`P&W HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) throw new Error("P&W returned no data");
  return json.data;
}

/** Paginated top-level bankrecs into this alliance (nation → AA only). */
async function fetchAllianceBankrecs(which: Which, allianceId: number): Promise<Rec[]> {
  const apiKey = await readKey(which);
  const all: Rec[] = [];
  let page = 1;
  while (page <= 25) {
    const data = await gql<{
      bankrecs?: {
        data?: Record<string, unknown>[];
        paginatorInfo?: { hasMorePages?: boolean };
      };
    }>(
      apiKey,
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

    const block = data.bankrecs;
    const rows = block?.data ?? [];
    for (const r of rows) {
      const amounts: Record<string, number> = {};
      for (const k of RES) {
        const v = Number(r[k] ?? 0);
        if (v > 0.0001) amounts[k] = Math.round(v * 100) / 100;
      }
      const id = Number(r.id);
      if (!Number.isFinite(id)) continue;
      all.push({
        id,
        date: String(r.date ?? ""),
        senderId: Number(r.sid),
        senderType: Number(r.stype),
        receiverId: Number(r.rid),
        receiverType: Number(r.rtype),
        note: String(r.note ?? ""),
        amounts,
      });
    }
    if (!block?.paginatorInfo?.hasMorePages || rows.length === 0) break;
    page += 1;
  }
  // oldest → newest so cursor is safe
  all.sort((a, b) => a.id - b.id);
  return all;
}

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
      out.problem =
        which === "offshore" ? "Offshore alliance ID not set" : "Main alliance ID not set";
      return out;
    }
    const rows = await fetchAllianceBankrecs(which, aa);
    out.ok = true;
    out.allianceId = aa;
    out.recordCount = rows.length;
    out.sample = rows.slice(-5).map((r) => ({
      id: r.id,
      date: r.date,
      sid: r.senderId,
      stype: r.senderType,
      rid: r.receiverId,
      rtype: r.receiverType,
      note: r.note.slice(0, 48),
      amounts: r.amounts,
    }));
  } catch (e) {
    out.ok = false;
    out.problem = e instanceof Error ? e.message : "could not read bank records";
  }
  return out;
}

/** Credit one resource; RPC first, ledger fallback. Idempotent on bankrec id. */
async function creditOne(
  supa: ReturnType<typeof db>,
  memberId: string,
  resource: string,
  amount: number,
  bankrecId: number
): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  const note = `In-game deposit (bank record #${bankrecId})`;

  // Prefer RPC (idempotent if defined that way)
  const { data, error } = await supa.rpc("econ_credit_deposit", {
    p_member: memberId,
    p_resource: resource,
    p_amount: amount,
    p_bankrec: bankrecId,
    p_note: note,
  });

  if (!error) {
    // RPC may return false/null when already credited
    if (data === false) return { ok: true, already: true };
    return { ok: true };
  }

  // Fallback: skip if this bankrec already in ledger
  const { data: existing } = await supa
    .from("econ_ledger")
    .select("id")
    .eq("member_id", memberId)
    .eq("resource", resource)
    .eq("kind", "deposit")
    .ilike("note", `%#${bankrecId}%`)
    .limit(1);

  if (existing?.length) return { ok: true, already: true };

  const { error: ledErr } = await supa.from("econ_ledger").insert({
    member_id: memberId,
    resource,
    amount,
    kind: "deposit",
    note,
    created_by: "system:bankrec",
  });
  if (ledErr) return { ok: false, error: `${error.message} | fallback: ${ledErr.message}` };
  return { ok: true };
}

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

    const cursor = await getSetting<Cursor>("bankrec_cursor", {});
    // Default start: 14 days ago (P&W bankrec window), not "now" (which skips everything)
    if (!cursor.start) {
      cursor.start = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    }
    const startMs = Date.parse(cursor.start);

    const targets: { which: Which; allianceId: number }[] = [];
    if (alliance.alliance_id) targets.push({ which: "main", allianceId: Number(alliance.alliance_id) });
    if (offshore?.offshore_alliance_id) {
      targets.push({ which: "offshore", allianceId: Number(offshore.offshore_alliance_id) });
    }
    if (targets.length === 0) {
      result.errors.push("No alliance is set up yet (Gov settings).");
    }

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
      // Track highest successfully processed id only
      let advancedTo = last;

      for (const rec of rows) {
        if (rec.id <= last) continue;
        if (Date.parse(rec.date) < startMs) {
          // old row — mark seen so we don't re-scan forever
          advancedTo = Math.max(advancedTo, rec.id);
          continue;
        }
        if (rec.senderType !== 1 || rec.receiverType !== 2 || rec.receiverId !== t.allianceId) {
          advancedTo = Math.max(advancedTo, rec.id);
          continue;
        }
        if (/#ignore/i.test(rec.note)) {
          result.ignored++;
          advancedTo = Math.max(advancedTo, rec.id);
          continue;
        }
        if (Object.keys(rec.amounts).length === 0) {
          advancedTo = Math.max(advancedTo, rec.id);
          continue;
        }

        const isOffshore = t.which === "offshore";
        if (isOffshore && trusted.size > 0 && !trusted.has(rec.senderId)) {
          result.ignored++;
          advancedTo = Math.max(advancedTo, rec.id);
          continue;
        }

        const member = await lookup(rec.senderId);
        if (member && member.status === "active") {
          let allOk = true;
          for (const [res, amt] of Object.entries(rec.amounts)) {
            const r = await creditOne(supa, member.id, res, amt, rec.id);
            if (!r.ok) {
              allOk = false;
              result.errors.push(`credit #${rec.id} ${res}: ${r.error}`);
            }
          }
          if (!allOk) {
            // do NOT advance past this id — retry next run
            break;
          }
          result.credited++;
          const prev = credited.get(member.id);
          if (prev) {
            for (const [k, v] of Object.entries(rec.amounts)) {
              prev.amounts[k] = Math.round(((prev.amounts[k] ?? 0) + v) * 100) / 100;
            }
          } else {
            credited.set(member.id, { member, amounts: { ...rec.amounts } });
          }
          advancedTo = Math.max(advancedTo, rec.id);
        } else {
          // unregistered → pending
          const rowsP = Object.entries(rec.amounts).map(([resource, amount]) => ({
            bankrec_id: rec.id,
            nation_id: rec.senderId,
            resource,
            amount,
            note: `Pending in-game deposit #${rec.id}`,
          }));
          const { error } = await supa
            .from("econ_pending_deposits")
            .upsert(rowsP, { onConflict: "bankrec_id,resource", ignoreDuplicates: true });
          if (error) {
            result.errors.push(`pending #${rec.id}: ${error.message}`);
            break;
          }
          result.pending += rowsP.length;
          advancedTo = Math.max(advancedTo, rec.id);
        }

        if (isOffshore && trusted.has(rec.senderId)) {
          const { data: seen } = await supa
            .from("econ_audit_log")
            .select("id")
            .eq("action", "offshore_deposit_credit")
            .contains("details", { bankrec_id: rec.id })
            .limit(1);
          if (!seen?.length) {
            await supa.from("econ_audit_log").insert({
              action: "offshore_deposit_credit",
              details: {
                bankrec_id: rec.id,
                sender_nation: rec.senderId,
                amounts: rec.amounts,
              },
            });
            result.booksCredits++;
          }
        }
      }
      cursor[t.which] = advancedTo;
    }

    await setSetting("bankrec_cursor", cursor);

    // Claim any pending for people who registered since
    try {
      const claimed = await supa.rpc("econ_claim_pending");
      if (claimed.error) result.errors.push(`claim: ${claimed.error.message}`);
    } catch (e) {
      result.errors.push(`claim: ${e instanceof Error ? e.message : "failed"}`);
    }

    for (const { member, amounts } of Array.from(credited.values()).slice(0, 25)) {
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
        console.error("deposit DM:", e instanceof Error ? e.message : e);
      }
    }

    if (result.credited || result.pending || result.booksCredits || result.errors.length) {
      await supa.from("econ_audit_log").insert({
        action: "bankrec_sync",
        details: { ...result },
      });
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

export async function bankrecSchema(_which: Which = "main", _fresh = false) {
  return {
    args: [
      { name: "rid", type: "[Int]" },
      { name: "rtype", type: "[Int]" },
      { name: "min_id", type: "Int" },
      { name: "first", type: "Int" },
    ],
    fields: ["id", "date", "note", "sid", "stype", "rid", "rtype", ...RES],
  };
}
