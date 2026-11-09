/**
 * Phase 3 — Financial integrity helpers.
 * Alerts are advisory + blocking only where concurrent/idempotent risk is clear.
 */
import { db } from "@/lib/supabase";
import { logSecurityEvent } from "@/lib/securityCore";

export type FinancialAlert = {
  id?: number;
  severity: "info" | "warning" | "critical";
  kind: string;
  member_id?: string | null;
  nation_id?: number | null;
  detail: Record<string, unknown>;
  created_at?: string;
};

/** Default thresholds (money units). Override via econ_settings key financial_security. */
export type FinancialThresholds = {
  large_withdrawal_money: number;
  large_adjust_money: number;
  max_pending_withdrawals_per_member: number;
};

const DEFAULTS: FinancialThresholds = {
  large_withdrawal_money: 50_000_000,
  large_adjust_money: 25_000_000,
  max_pending_withdrawals_per_member: 1,
};

export async function getFinancialThresholds(): Promise<FinancialThresholds> {
  try {
    const { data } = await db()
      .from("econ_settings")
      .select("value")
      .eq("key", "financial_security")
      .maybeSingle();
    const v = (data?.value || {}) as Partial<FinancialThresholds>;
    return {
      large_withdrawal_money: Number(v.large_withdrawal_money ?? DEFAULTS.large_withdrawal_money),
      large_adjust_money: Number(v.large_adjust_money ?? DEFAULTS.large_adjust_money),
      max_pending_withdrawals_per_member: Math.max(
        1,
        Number(v.max_pending_withdrawals_per_member ?? DEFAULTS.max_pending_withdrawals_per_member)
      ),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function recordFinancialAlert(alert: Omit<FinancialAlert, "id" | "created_at">) {
  try {
    await db().from("econ_financial_alerts").insert({
      severity: alert.severity,
      kind: alert.kind,
      member_id: alert.member_id ?? null,
      nation_id: alert.nation_id ?? null,
      detail: alert.detail ?? {},
    });
  } catch (e) {
    console.error("recordFinancialAlert:", e instanceof Error ? e.message : e);
  }
  void logSecurityEvent({
    kind: "suspicious",
    detail: { financial: true, ...alert },
  });
}

/** Block if member already has an open DEPOSIT withdrawal (anti double-submit). */
export async function assertNoConcurrentWithdrawal(
  memberId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const th = await getFinancialThresholds();
  const open = ["pending_approval", "approved", "queued", "sending", "pending"];
  const { count, error } = await db()
    .from("econ_withdrawals")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId)
    .in("status", open);

  if (error) {
    console.error("concurrent withdrawal check:", error.message);
    return { ok: true }; // fail open on check error so legit users aren't frozen
  }
  if ((count ?? 0) >= th.max_pending_withdrawals_per_member) {
    await recordFinancialAlert({
      severity: "warning",
      kind: "concurrent_withdrawal_blocked",
      member_id: memberId,
      detail: { open: count },
    });
    return {
      ok: false,
      error:
        "You already have a withdrawal in progress. Wait until it finishes or is cancelled before requesting another.",
    };
  }
  return { ok: true };
}

export function moneyAmount(amounts: Record<string, number>): number {
  return Math.abs(Number(amounts.money ?? 0));
}

export async function flagLargeWithdrawal(opts: {
  memberId: string;
  nationId: number;
  amounts: Record<string, number>;
  tag: string;
  withdrawalId?: string | null;
}) {
  const th = await getFinancialThresholds();
  const money = moneyAmount(opts.amounts);
  if (money < th.large_withdrawal_money) return;
  await recordFinancialAlert({
    severity: money >= th.large_withdrawal_money * 5 ? "critical" : "warning",
    kind: "large_withdrawal",
    member_id: opts.memberId,
    nation_id: opts.nationId,
    detail: {
      amounts: opts.amounts,
      tag: opts.tag,
      withdrawalId: opts.withdrawalId ?? null,
      threshold: th.large_withdrawal_money,
    },
  });
}

export async function flagLargeAdjustment(opts: {
  memberId: string;
  nationId?: number;
  amounts: Record<string, number>;
  staffDiscordId: string;
  note?: string;
}) {
  const th = await getFinancialThresholds();
  const money = moneyAmount(opts.amounts);
  const maxAbs = Math.max(
    money,
    ...Object.values(opts.amounts).map((v) => Math.abs(Number(v) || 0))
  );
  // treat any single resource swing above large_adjust as notable; money uses money threshold
  if (money < th.large_adjust_money && maxAbs < th.large_adjust_money) return;
  await recordFinancialAlert({
    severity: "warning",
    kind: "large_balance_adjust",
    member_id: opts.memberId,
    nation_id: opts.nationId ?? null,
    detail: {
      amounts: opts.amounts,
      staffDiscordId: opts.staffDiscordId,
      note: opts.note ?? null,
      threshold: th.large_adjust_money,
    },
  });
}

/** Scan balances for negatives + optional ledger drift sample. */
export async function runIntegrityScan(): Promise<{
  negativeBalances: { member_id: string; resource: string; balance: number }[];
  openWithdrawals: number;
  recentAlerts: number;
  ledgerOrphans: number;
}> {
  const supa = db();
  const dayAgo = new Date(Date.now() - 864e5).toISOString();

  const [{ data: negatives }, { count: openWd }, { count: recentAlerts }] =
    await Promise.all([
      supa
        .from("econ_balances")
        .select("member_id, resource, balance")
        .lt("balance", -0.01)
        .limit(100),
      supa
        .from("econ_withdrawals")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending_approval", "approved", "queued", "sending", "pending"]),
      supa
        .from("econ_financial_alerts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", dayAgo),
    ]);

  // Ledger rows with member_id not in members (orphan check)
  let ledgerOrphans = 0;
  try {
    const { data: led } = await supa
      .from("econ_ledger")
      .select("member_id")
      .order("created_at", { ascending: false })
      .limit(200);
    const ids = [...new Set((led ?? []).map((r) => String(r.member_id)))];
    if (ids.length) {
      const { data: mems } = await supa.from("econ_members").select("id").in("id", ids);
      const have = new Set((mems ?? []).map((m) => String(m.id)));
      ledgerOrphans = ids.filter((id) => !have.has(id)).length;
    }
  } catch {
    /* ignore */
  }

  const neg = (negatives ?? []).map((r) => ({
    member_id: String(r.member_id),
    resource: String(r.resource),
    balance: Number(r.balance),
  }));

  if (neg.length) {
    await recordFinancialAlert({
      severity: "critical",
      kind: "negative_balances_detected",
      detail: { count: neg.length, sample: neg.slice(0, 10) },
    });
  }

  return {
    negativeBalances: neg,
    openWithdrawals: openWd ?? 0,
    recentAlerts: recentAlerts ?? 0,
    ledgerOrphans,
  };
}

export async function listFinancialAlerts(limit = 40) {
  const { data } = await db()
    .from("econ_financial_alerts")
    .select("id, severity, kind, member_id, nation_id, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
