/**
 * In-game bank deposits → site ledger (+ Evergreen offshore net books when appropriate).
 *
 * Main AA: any active member nation → alliance bank → credit that member's site deposit.
 * Offshore AA: banker (Yema) or configured nation ids → offshore bank →
 *   credit that member's site deposit AND credit Evergreen net-at-offshore books.
 *
 * Idempotent via seen bankrec ids in econ_settings.
 */
import { db } from "@/lib/supabase";
import { getSetting, setSetting, type OffshoreConfig } from "@/lib/settings";
import { getBankApiKey, getOffshoreApiKey, getPnwApiKey } from "@/lib/secrets";

const RES = [
  "money", "coal", "oil", "uranium", "iron", "bauxite", "lead",
  "gasoline", "munitions", "steel", "aluminum", "food",
] as const;

export type Rss = Partial<Record<(typeof RES)[number], number>>;

type BankRec = {
  id: string;
  date: string;
  sid: string | number;
  rid: string | number;
  stype: number | string;
  rtype: number | string;
  note?: string | null;
} & Partial<Record<(typeof RES)[number], number | null>>;

async function gqlBankrecs(apiKey: string, allianceId: number): Promise<BankRec[]> {
  const fields = `id date sid rid stype rtype note money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food`;
  const queries = [
    `query($a:[Int]){ bankrecs(alliance_id:$a, first:100, orderBy:{column:ID, order:DESC}){ data { ${fields} } } }`,
    `query($a:[Int]){ bankrecs(alliance_id:$a, first:100){ data { ${fields} } } }`,
  ];
  let lastErr = "bankrecs failed";
  for (const q of queries) {
    const res = await fetch(
      `https://api.politicsandwar.com/graphql?api_key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, variables: { a: [allianceId] } }),
        cache: "no-store",
      }
    );
    if (!res.ok) {
      lastErr = `P&W bankrecs HTTP ${res.status}`;
      continue;
    }
    const json = await res.json();
    if (json.errors?.length) {
      lastErr = json.errors[0].message;
      continue;
    }
    return (json?.data?.bankrecs?.data ?? []) as BankRec[];
  }
  throw new Error(lastErr);
}

function isNationToAlliance(r: BankRec): boolean {
  return Number(r.stype) === 1 && Number(r.rtype) === 2;
}

function amountsFrom(r: BankRec): Rss {
  const out: Rss = {};
  for (const k of RES) {
    const v = Number(r[k] ?? 0);
    if (v > 0.0001) out[k] = Math.round(v * 100) / 100;
  }
  return out;
}

async function creditMember(
  memberId: string,
  amounts: Rss,
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

async function creditOffshoreBooks(amounts: Rss, bankrecId: string, nationId: number) {
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

export type SyncResult = {
  main: { scanned: number; credited: number; skipped: number; errors: string[] };
  offshore: { scanned: number; credited: number; skipped: number; errors: string[] };
};

/**
 * bankerNationIds: nations whose deposits into OFFSHORE count as Evergreen tops-ups
 * (default: offshore config banker_nation_id, e.g. Yema 633226).
 */
export async function syncBankDeposits(): Promise<SyncResult> {
  const cfg = await getSetting<OffshoreConfig | null>("offshore", null);
  const mainId = Number(cfg?.source_alliance_id || process.env.ALLIANCE_ID || 0);
  const offshoreId = Number(cfg?.offshore_alliance_id || 0);
  const bankerId = Number(cfg?.banker_nation_id || 0);

  const extra = await getSetting<number[]>("offshore_deposit_nation_ids", []);
  const offshoreDepositors = new Set<number>([
    ...(bankerId > 0 ? [bankerId] : []),
    ...extra.map(Number).filter((n) => n > 0),
  ]);

  const result: SyncResult = {
    main: { scanned: 0, credited: 0, skipped: 0, errors: [] },
    offshore: { scanned: 0, credited: 0, skipped: 0, errors: [] },
  };

  const mainKey = (await getBankApiKey()) || (await getPnwApiKey());
  const offKey = (await getOffshoreApiKey()) || mainKey;

  if (mainId > 0 && mainKey) {
    await processAlliance({
      allianceId: mainId,
      apiKey: mainKey,
      mode: "main",
      offshoreDepositors,
      bucket: result.main,
    });
  } else if (mainId > 0) {
    result.main.errors.push("No BANK_API_KEY / PNW_API_KEY for main bankrecs");
  }

  if (offshoreId > 0 && offKey) {
    await processAlliance({
      allianceId: offshoreId,
      apiKey: offKey,
      mode: "offshore",
      offshoreDepositors,
      bucket: result.offshore,
    });
  } else if (offshoreId > 0) {
    result.offshore.errors.push("No OFFSHORE_API_KEY for offshore bankrecs");
  }

  await db().from("econ_audit_log").insert({
    actor_discord_id: "system",
    action: "bankrec_sync",
    details: result,
  });

  return result;
}

async function processAlliance(opts: {
  allianceId: number;
  apiKey: string;
  mode: "main" | "offshore";
  offshoreDepositors: Set<number>;
  bucket: SyncResult["main"];
}) {
  const stateKey = `bankrec_seen_${opts.allianceId}`;
  const seen = await getSetting<{ ids: string[] }>(stateKey, { ids: [] });
  const seenSet = new Set(seen.ids || []);

  let recs: BankRec[] = [];
  try {
    recs = await gqlBankrecs(opts.apiKey, opts.allianceId);
  } catch (e) {
    opts.bucket.errors.push(e instanceof Error ? e.message : "bankrecs failed");
    return;
  }
  opts.bucket.scanned = recs.length;

  // First run: mark current history as seen WITHOUT crediting (no backfill surprise)
  if (seenSet.size === 0 && recs.length > 0) {
    const ids = recs.map((r) => String(r.id));
    await setSetting(stateKey, { ids: ids.slice(0, 800), bootstrapped_at: new Date().toISOString() });
    opts.bucket.skipped = recs.length;
    opts.bucket.errors.push(
      "First sync: existing bankrecs marked seen (no backfill). New deposits from now on will credit the site."
    );
    return;
  }

  const ordered = [...recs].reverse();
  const newSeen = [...seenSet];

  for (const r of ordered) {
    const rid = String(r.id);
    if (seenSet.has(rid)) {
      opts.bucket.skipped++;
      continue;
    }
    if (!isNationToAlliance(r)) {
      seenSet.add(rid);
      newSeen.push(rid);
      opts.bucket.skipped++;
      continue;
    }

    const nationId = Number(r.sid);
    const amounts = amountsFrom(r);
    if (!nationId || !Object.keys(amounts).length) {
      seenSet.add(rid);
      newSeen.push(rid);
      opts.bucket.skipped++;
      continue;
    }

    // Offshore: only Yema / configured depositors count for site + Evergreen books
    if (opts.mode === "offshore" && !opts.offshoreDepositors.has(nationId)) {
      seenSet.add(rid);
      newSeen.push(rid);
      opts.bucket.skipped++;
      continue;
    }

    const { data: mem } = await db()
      .from("econ_members")
      .select("id, discord_id, leader_name, nation_id, status")
      .eq("nation_id", nationId)
      .eq("status", "active")
      .maybeSingle();

    if (!mem) {
      // Still credit Evergreen offshore books for banker deposit even if not on site?
      if (opts.mode === "offshore" && opts.offshoreDepositors.has(nationId)) {
        await creditOffshoreBooks(amounts, rid, nationId);
        opts.bucket.credited++;
      } else {
        opts.bucket.skipped++;
      }
      seenSet.add(rid);
      newSeen.push(rid);
      continue;
    }

    const note =
      opts.mode === "offshore"
        ? `In-game deposit to offshore bank #${rid}`
        : `In-game deposit to main bank #${rid}`;

    const cred = await creditMember(mem.id, amounts, note);
    if (!cred.ok) {
      opts.bucket.errors.push(`bankrec ${rid}: ${cred.error}`);
      // do not mark seen — retry
      continue;
    }

    if (opts.mode === "offshore") {
      await creditOffshoreBooks(amounts, rid, nationId);
    }

    seenSet.add(rid);
    newSeen.push(rid);
    opts.bucket.credited++;

    // Optional DM — best effort
    try {
      const { sendDepositConfirmation, makeDepositCode } = await import("@/lib/depositNotify");
      const code = makeDepositCode(nationId, mem.id);
      void sendDepositConfirmation({
        discordId: String(mem.discord_id),
        accountId: mem.id,
        nationId,
        leaderName: mem.leader_name,
        amounts: amounts as Record<string, number>,
        depositCode: code,
        date: r.date,
      });
    } catch {
      /* depositNotify optional */
    }
  }

  await setSetting(stateKey, { ids: [...new Set(newSeen)].slice(-800) });
}
