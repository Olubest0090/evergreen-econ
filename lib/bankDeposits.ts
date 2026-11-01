/**
 * Auto in-game bank deposits → site ledger + Discord DM.
 *
 * Main AA: nation → alliance bank → credit that active member.
 * Offshore AA: only banker (Yema) / offshore_deposit_nation_ids → site credit
 *   + Evergreen net-at-offshore books (not other alliances' money).
 *
 * First run per alliance: mark existing bankrecs as seen (no backfill).
 * Idempotent via econ_settings bankrec_seen_* ids.
 */
import { db } from "@/lib/supabase";
import { getSetting, setSetting, type OffshoreConfig } from "@/lib/settings";
import { getBankApiKey, getOffshoreApiKey, getPnwApiKey } from "@/lib/secrets";
import { RESOURCES, type Resource } from "@/lib/resources";
import { makeDepositCode, sendDepositConfirmation } from "@/lib/depositNotify";

type BankRec = {
  id: string | number;
  sid: string | number | null;
  rid: string | number | null;
  date: string;
  stype: number | null;
  rtype: number | null;
  note?: string | null;
} & Partial<Record<Resource, number | null>>;

export type SyncStats = {
  scanned: number;
  credited: number;
  skipped: number;
  unmatched: number;
  errors: string[];
};

const emptyStats = (): SyncStats => ({
  scanned: 0,
  credited: 0,
  skipped: 0,
  unmatched: 0,
  errors: [],
});

async function fetchBankRecs(apiKey: string, allianceId: number): Promise<BankRec[]> {
  const fields = `
    id sid rid date stype rtype note
    money food coal oil uranium iron bauxite lead gasoline munitions steel aluminum
  `;
  const all: BankRec[] = [];
  let page = 1;

  while (page <= 20) {
    const query = `query {
      bankrecs(
        first: 100,
        page: ${page},
        rid: [${allianceId}],
        rtype: [2],
        stype: [1],
        orderBy: [{ column: ID, order: DESC }]
      ) {
        data { ${fields} }
        paginatorInfo { hasMorePages }
      }
    }`;

    const response = await fetch(
      "https://api.politicsandwar.com/graphql?api_key=" + encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        cache: "no-store",
      }
    );
    if (!response.ok) throw new Error(`P&W bankrecs HTTP ${response.status}`);
    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
    }
    const pageData = json?.data?.bankrecs;
    if (!pageData) throw new Error("P&W returned no bankrecs data");
    const rows = (pageData.data ?? []) as BankRec[];
    all.push(...rows);
    if (!pageData.paginatorInfo?.hasMorePages || rows.length === 0) break;
    page += 1;
  }
  return all;
}

function positiveAmounts(rec: BankRec): Partial<Record<Resource, number>> {
  const amounts: Partial<Record<Resource, number>> = {};
  for (const resource of RESOURCES) {
    const amount = Number(rec[resource] ?? 0);
    if (Number.isFinite(amount) && amount > 0) {
      amounts[resource] = Math.round(amount * 100) / 100;
    }
  }
  return amounts;
}

async function creditLedger(
  memberId: string,
  amounts: Partial<Record<Resource, number>>,
  note: string
): Promise<{ ok: boolean; error?: string }> {
  const entries = Object.entries(amounts).map(([resource, amount]) => ({
    member_id: memberId,
    resource,
    amount,
    kind: "deposit",
    note,
    created_by: "system:bankrec",
  }));
  if (!entries.length) return { ok: true };
  const { error } = await db().from("econ_ledger").insert(entries);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function creditOffshoreBooks(
  amounts: Partial<Record<Resource, number>>,
  bankrecId: string,
  nationId: number
) {
  await db().from("econ_audit_log").insert({
    actor_discord_id: "system",
    action: "offshore_evergreen_credit",
    details: {
      amounts,
      source: "bankrec",
      bankrec_id: bankrecId,
      depositor_nation_id: nationId,
      note: "In-game deposit into offshore AA",
    },
  });
}

type Scope = "main" | "offshore";

async function syncAlliance(opts: {
  scope: Scope;
  apiKey: string;
  allianceId: number;
  /** If set, only process this nation's deposits (registration path). */
  onlyNationId?: number;
  /** Offshore: only these nation ids get site credit + books. */
  offshoreDepositors?: Set<number>;
}): Promise<SyncStats> {
  const stats = emptyStats();
  const stateKey = `bankrec_seen_${opts.scope}_${opts.allianceId}`;
  const seenState = await getSetting<{ ids: string[]; bootstrapped_at?: string }>(stateKey, {
    ids: [],
  });
  const seenSet = new Set((seenState.ids || []).map(String));

  let records: BankRec[] = [];
  try {
    records = await fetchBankRecs(opts.apiKey, opts.allianceId);
  } catch (e) {
    stats.errors.push(e instanceof Error ? e.message : "bankrecs failed");
    return stats;
  }
  stats.scanned = records.length;

  // First run: remember history, do not credit old deposits
  if (seenSet.size === 0 && records.length > 0 && !opts.onlyNationId) {
    await setSetting(stateKey, {
      ids: records.map((r) => String(r.id)).slice(0, 1500),
      bootstrapped_at: new Date().toISOString(),
    });
    stats.skipped = records.length;
    stats.errors.push(
      `${opts.scope}: bootstrap — existing bankrecs marked seen (no backfill). New deposits will credit automatically.`
    );
    return stats;
  }

  const incoming = records.filter((r) => {
    if (Number(r.rid) !== opts.allianceId) return false;
    if (Number(r.rtype) !== 2 || Number(r.stype) !== 1) return false;
    if (opts.onlyNationId && Number(r.sid) !== opts.onlyNationId) return false;
    return true;
  });

  const newSeen = [...seenSet];

  for (const record of incoming) {
    const recordId = String(record.id);
    const nationId = Number(record.sid);

    if (seenSet.has(recordId)) {
      stats.skipped += 1;
      continue;
    }

    if (!Number.isSafeInteger(nationId) || nationId <= 0) {
      seenSet.add(recordId);
      newSeen.push(recordId);
      stats.skipped += 1;
      continue;
    }

    // Offshore: only Yema / allowlist
    if (
      opts.scope === "offshore" &&
      opts.offshoreDepositors &&
      opts.offshoreDepositors.size > 0 &&
      !opts.offshoreDepositors.has(nationId)
    ) {
      seenSet.add(recordId);
      newSeen.push(recordId);
      stats.skipped += 1;
      continue;
    }

    const amounts = positiveAmounts(record);
    if (!Object.keys(amounts).length) {
      seenSet.add(recordId);
      newSeen.push(recordId);
      stats.skipped += 1;
      continue;
    }

    const { data: mem } = await db()
      .from("econ_members")
      .select("id, discord_id, leader_name, nation_id, status")
      .eq("nation_id", nationId)
      .eq("status", "active")
      .maybeSingle();

    if (!mem) {
      // Offshore banker deposit before they registered: still books only
      if (
        opts.scope === "offshore" &&
        opts.offshoreDepositors?.has(nationId)
      ) {
        await creditOffshoreBooks(amounts, recordId, nationId);
        stats.credited += 1;
      } else {
        stats.unmatched += 1;
      }
      seenSet.add(recordId);
      newSeen.push(recordId);
      continue;
    }

    const note =
      opts.scope === "offshore"
        ? `In-game deposit to offshore #${recordId}`
        : `In-game deposit to main #${recordId}`;

    // Prefer RPC if present (atomic claim); fall back to ledger + seen list
    let credited = false;
    const { data: rpcOk, error: rpcErr } = await db().rpc("econ_credit_bank_deposit", {
      p_source: opts.scope,
      p_record_id: Number(recordId) || recordId,
      p_member_id: mem.id,
      p_nation_id: nationId,
      p_amounts: amounts,
      p_note: (record.note || note).slice(0, 300),
      p_occurred_at: record.date || new Date().toISOString(),
    });

    if (!rpcErr && rpcOk === true) {
      credited = true;
    } else if (rpcErr) {
      // RPC missing or failed — ledger path
      const leg = await creditLedger(mem.id, amounts, record.note || note);
      if (!leg.ok) {
        stats.errors.push(`#${recordId}: ${leg.error}`);
        continue; // retry later
      }
      credited = true;
    } else {
      // rpc returned false = already claimed
      stats.skipped += 1;
      seenSet.add(recordId);
      newSeen.push(recordId);
      continue;
    }

    if (opts.scope === "offshore") {
      await creditOffshoreBooks(amounts, recordId, nationId);
    }

    seenSet.add(recordId);
    newSeen.push(recordId);
    stats.credited += 1;

    try {
      await sendDepositConfirmation({
        discordId: String(mem.discord_id),
        accountId: mem.id,
        nationId,
        leaderName: mem.leader_name,
        amounts: amounts as Record<string, number>,
        depositCode: makeDepositCode(nationId, mem.id),
        date: record.date,
      });
    } catch (e) {
      console.error("deposit DM failed", e);
    }
  }

  await setSetting(stateKey, {
    ids: [...new Set(newSeen)].slice(-1500),
    bootstrapped_at: seenState.bootstrapped_at || new Date().toISOString(),
  });

  return stats;
}

export async function syncBankDeposits(opts?: {
  onlyNationId?: number;
}): Promise<{ main: SyncStats; offshore: SyncStats }> {
  const [mainKey, offKey, allianceCfg, offshoreCfg, extraDepositors] =
    await Promise.all([
      getBankApiKey(),
      getOffshoreApiKey(),
      getSetting<{ alliance_id?: number }>("alliance", {}),
      getSetting<OffshoreConfig | null>("offshore", null),
      getSetting<number[]>("offshore_deposit_nation_ids", []),
    ]);

  const mainAllianceId = Number(
    offshoreCfg?.source_alliance_id ||
      allianceCfg?.alliance_id ||
      process.env.ALLIANCE_ID ||
      0
  );
  const offshoreAllianceId = Number(offshoreCfg?.offshore_alliance_id || 0);
  const bankerId = Number(offshoreCfg?.banker_nation_id || 0);
  const offshoreDepositors = new Set<number>([
    ...(bankerId > 0 ? [bankerId] : []),
    ...extraDepositors.map(Number).filter((n) => n > 0),
  ]);

  const apiMain = mainKey || (await getPnwApiKey());
  const apiOff = offKey || apiMain;

  const result = { main: emptyStats(), offshore: emptyStats() };

  if (mainAllianceId > 0 && apiMain) {
    try {
      result.main = await syncAlliance({
        scope: "main",
        apiKey: apiMain,
        allianceId: mainAllianceId,
        onlyNationId: opts?.onlyNationId,
      });
    } catch (e) {
      result.main.errors.push(e instanceof Error ? e.message : "main sync failed");
    }
  } else {
    result.main.errors.push("Main alliance id or BANK_API_KEY missing");
  }

  if (offshoreAllianceId > 0 && apiOff) {
    try {
      result.offshore = await syncAlliance({
        scope: "offshore",
        apiKey: apiOff,
        allianceId: offshoreAllianceId,
        onlyNationId: opts?.onlyNationId,
        offshoreDepositors,
      });
    } catch (e) {
      result.offshore.errors.push(e instanceof Error ? e.message : "offshore sync failed");
    }
  } else if (offshoreAllianceId > 0) {
    result.offshore.errors.push("OFFSHORE_API_KEY missing");
  }

  await db().from("econ_audit_log").insert({
    actor_discord_id: "system",
    action: "bankrec_sync",
    details: { ...result, onlyNationId: opts?.onlyNationId ?? null },
  });

  return result;
}

/** After a member registers / logs in: credit their pending in-game deposits + DM. */
export async function syncDepositsForNation(nationId: number) {
  if (!Number.isSafeInteger(nationId) || nationId <= 0) {
    return { main: emptyStats(), offshore: emptyStats() };
  }
  return syncBankDeposits({ onlyNationId: nationId });
}
