import { NextResponse } from "next/server";
import { isOwnerSession } from "@/lib/ownerSecurity";
import { db } from "@/lib/supabase";
import {
  getLockdown,
  logSecurityEvent,
  bumpSessionEpoch,
  type LockdownFlags,
} from "@/lib/securityCore";
import {
  getFinancialThresholds,
  listFinancialAlerts,
  runIntegrityScan,
} from "@/lib/financialSecurity";
import {
  listIpRules,
  upsertIpRule,
  removeIpRule,
  zeroNegativeBalances,
} from "@/lib/ipRules";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

export async function GET() {
  if (!(await isOwnerSession())) return err("Forbidden", 403);

  const supa = db();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.toISOString();
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  const dayAgo = new Date(Date.now() - 864e5).toISOString();

  const [
    lockdown,
    thresholds,
    integrity,
    financialAlerts,
    ipRules,
    { count: reqToday },
    { count: failLoginsToday },
    { count: okLoginsToday },
    { count: cronDeniedWeek },
    { count: lockdownBlocksWeek },
    { count: permDeniedWeek },
    { data: recentEvents },
    { data: recentFails },
    { data: recentLogs },
    { data: adminActions },
  ] = await Promise.all([
    getLockdown(),
    getFinancialThresholds(),
    runIntegrityScan(),
    listFinancialAlerts(40),
    listIpRules(),
    supa.from("econ_security_logs").select("id", { count: "exact", head: true }).gte("created_at", since),
    supa.from("econ_login_attempts").select("id", { count: "exact", head: true }).eq("success", false).gte("created_at", since),
    supa.from("econ_login_attempts").select("id", { count: "exact", head: true }).eq("success", true).gte("created_at", since),
    supa.from("econ_security_events").select("id", { count: "exact", head: true }).eq("kind", "cron_denied").gte("created_at", week),
    supa.from("econ_security_events").select("id", { count: "exact", head: true }).eq("kind", "lockdown_block").gte("created_at", week),
    supa.from("econ_security_events").select("id", { count: "exact", head: true }).eq("kind", "perm_denied").gte("created_at", week),
    supa.from("econ_security_events").select("id, kind, ip_address, discord_id, path, detail, created_at").order("created_at", { ascending: false }).limit(40),
    supa.from("econ_login_attempts").select("id, ip_address, discord_id, success, reason, created_at").eq("success", false).order("created_at", { ascending: false }).limit(40),
    supa.from("econ_security_logs").select("id, ip_address, method, path, user_agent, created_at").order("created_at", { ascending: false }).limit(80),
    supa.from("econ_audit_log").select("id, actor_discord_id, action, details, created_at").order("created_at", { ascending: false }).limit(40),
  ]);

  const { data: failRows } = await supa
    .from("econ_login_attempts")
    .select("ip_address")
    .eq("success", false)
    .gte("created_at", dayAgo)
    .not("ip_address", "is", null)
    .limit(500);

  const ipCounts = new Map<string, number>();
  for (const r of failRows ?? []) {
    const ip = String(r.ip_address || "");
    if (!ip) continue;
    ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
  }
  const suspiciousIps = [...ipCounts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([ip, fails]) => ({ ip, fails }));

  const cronSecretSet = !!(process.env.CRON_SECRET && process.env.CRON_SECRET.trim().length >= 16);
  const authSecretSet = !!(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32);
  const ownerSet = !!(process.env.OWNER_DISCORD_ID && /^\d+$/.test(process.env.OWNER_DISCORD_ID.trim()));
  const lockdownOn = Object.values(lockdown).some(Boolean);

  const alerts: { level: "critical" | "warning" | "info"; text: string }[] = [];
  if (!cronSecretSet) alerts.push({ level: "critical", text: "CRON_SECRET missing or too short." });
  if (!authSecretSet) alerts.push({ level: "critical", text: "AUTH_SECRET missing or too short." });
  if (!ownerSet) alerts.push({ level: "critical", text: "OWNER_DISCORD_ID not set." });
  if (lockdownOn) alerts.push({ level: "warning", text: "Emergency lockdown is active." });
  if (integrity.negativeBalances.length)
    alerts.push({
      level: "critical",
      text: `${integrity.negativeBalances.length} negative balance row(s) detected.`,
    });
  if (ipRules.filter((r) => r.status === "blocked").length)
    alerts.push({
      level: "info",
      text: `${ipRules.filter((r) => r.status === "blocked").length} IP(s) currently blocked.`,
    });
  if ((failLoginsToday ?? 0) >= 20)
    alerts.push({ level: "warning", text: `${failLoginsToday} failed logins today (UTC).` });
  if ((cronDeniedWeek ?? 0) > 0)
    alerts.push({ level: "warning", text: `${cronDeniedWeek} denied cron hits this week.` });
  if (alerts.length === 0) alerts.push({ level: "info", text: "No active security alerts." });

  let status: "Healthy" | "Warning" | "Critical" = "Healthy";
  if (alerts.some((a) => a.level === "critical")) status = "Critical";
  else if (alerts.some((a) => a.level === "warning")) status = "Warning";

  return NextResponse.json({
    status,
    alerts,
    lockdown,
    checks: { cronSecretSet, authSecretSet, ownerSet },
    today: {
      requests: reqToday ?? 0,
      failedLogins: failLoginsToday ?? 0,
      okLogins: okLoginsToday ?? 0,
    },
    week: {
      cronDenied: cronDeniedWeek ?? 0,
      lockdownBlocks: lockdownBlocksWeek ?? 0,
      permDenied: permDeniedWeek ?? 0,
    },
    suspiciousIps,
    recentEvents: recentEvents ?? [],
    recentFails: recentFails ?? [],
    recentLogs: recentLogs ?? [],
    adminActions: adminActions ?? [],
    financial: {
      thresholds,
      integrity,
      alerts: financialAlerts,
    },
    ipRules,
  });
}

export async function POST(req: Request) {
  if (!(await isOwnerSession())) return err("Forbidden", 403);
  const session = await readSession();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON");
  }

  const action = String(body.action || "");
  const supa = db();

  if (action === "set_lockdown") {
    const flags = (body.flags || {}) as Partial<LockdownFlags>;
    const current = await getLockdown();
    const merged: LockdownFlags = { ...current };
    for (const k of Object.keys(merged) as (keyof LockdownFlags)[]) {
      if (k in flags) merged[k] = !!flags[k];
    }
    await supa.from("econ_settings").upsert({
      key: "emergency_lockdown",
      value: merged,
      updated_at: new Date().toISOString(),
    });
    await logSecurityEvent({
      kind: "admin_action",
      detail: { action: "set_lockdown", flags: merged },
    });
    return NextResponse.json({ ok: true, lockdown: merged });
  }

  if (action === "clear_lockdown") {
    const cleared: LockdownFlags = {
      withdrawals: false,
      balance_adjust: false,
      grants: false,
      staff_manage: false,
      gov_send: false,
      disburse: false,
    };
    await supa.from("econ_settings").upsert({
      key: "emergency_lockdown",
      value: cleared,
      updated_at: new Date().toISOString(),
    });
    await logSecurityEvent({
      kind: "admin_action",
      detail: { action: "clear_lockdown" },
    });
    return NextResponse.json({ ok: true, lockdown: cleared });
  }

  if (action === "run_integrity_scan") {
    const integrity = await runIntegrityScan();
    return NextResponse.json({ ok: true, integrity });
  }

  if (action === "ip_block" || action === "ip_trust") {
    const ip = String(body.ip || "").trim();
    const reason = String(body.reason || "");
    const r = await upsertIpRule({
      ip,
      status: action === "ip_block" ? "blocked" : "trusted",
      reason,
      createdBy: session?.discordId,
    });
    if (!r.ok) return err(r.error);
    return NextResponse.json({ ok: true });
  }

  if (action === "ip_remove") {
    const ip = String(body.ip || "").trim();
    const r = await removeIpRule(ip);
    if (!r.ok) return err(r.error);
    return NextResponse.json({ ok: true });
  }

  if (action === "zero_negatives") {
    if (!session?.discordId) return err("No session", 401);
    if (!windowConfirmSafe(body)) {
      /* require confirm: true */
    }
    if (body.confirm !== true && body.confirm !== "true") {
      return err("Pass confirm: true to zero all negative balances");
    }
    const result = await zeroNegativeBalances(session.discordId);
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "revoke_sessions") {
    const discordId = String(body.discordId || "").trim();
    if (!/^\d+$/.test(discordId)) return err("discordId must be a snowflake");
    await bumpSessionEpoch(discordId);
    await logSecurityEvent({
      kind: "admin_action",
      discordId: session?.discordId,
      detail: { action: "revoke_sessions", target: discordId },
    });
    return NextResponse.json({ ok: true });
  }

  return err("Unknown action");
}

function windowConfirmSafe(_body: Record<string, unknown>) {
  return true;
}
