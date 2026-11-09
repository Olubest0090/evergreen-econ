import { NextResponse } from "next/server";
import { isOwnerSession } from "@/lib/ownerSecurity";
import { db } from "@/lib/supabase";
import { getLockdown, logSecurityEvent, type LockdownFlags } from "@/lib/securityCore";

export const dynamic = "force-dynamic";

const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

export async function GET() {
  if (!(await isOwnerSession())) return err("Forbidden", 403);

  const supa = db();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.toISOString();
  const week = new Date(Date.now() - 7 * 864e5).toISOString();

  const [
    lockdown,
    { count: reqToday },
    { count: failLogins },
    { count: cronDenied },
    { data: recentEvents },
  ] = await Promise.all([
    getLockdown(),
    supa
      .from("econ_security_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
    supa
      .from("econ_login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("success", false)
      .gte("created_at", since),
    supa
      .from("econ_security_events")
      .select("id", { count: "exact", head: true })
      .eq("kind", "cron_denied")
      .gte("created_at", week),
    supa
      .from("econ_security_events")
      .select("id, kind, ip_address, discord_id, path, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const cronSecretSet = !!(process.env.CRON_SECRET && process.env.CRON_SECRET.trim().length >= 16);
  const authSecretSet = !!(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32);

  let status: "Healthy" | "Warning" | "Critical" = "Healthy";
  if (!cronSecretSet || !authSecretSet) status = "Critical";
  else if ((failLogins ?? 0) > 20 || (cronDenied ?? 0) > 0) status = "Warning";

  return NextResponse.json({
    status,
    lockdown,
    checks: { cronSecretSet, authSecretSet },
    today: {
      requests: reqToday ?? 0,
      failedLogins: failLogins ?? 0,
    },
    week: { cronDenied: cronDenied ?? 0 },
    recentEvents: recentEvents ?? [],
  });
}

export async function POST(req: Request) {
  if (!(await isOwnerSession())) return err("Forbidden", 403);

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
    const next: LockdownFlags = {
      withdrawals: !!flags.withdrawals,
      balance_adjust: !!flags.balance_adjust,
      grants: !!flags.grants,
      staff_manage: !!flags.staff_manage,
      gov_send: !!flags.gov_send,
      disburse: !!flags.disburse,
    };
    // allow partial merge if provided
    const merged = { ...current, ...flags, ...next };
    // normalize booleans
    for (const k of Object.keys(merged) as (keyof LockdownFlags)[]) {
      merged[k] = !!merged[k];
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

  return err("Unknown action");
}
