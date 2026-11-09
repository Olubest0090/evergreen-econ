/**
 * Phase 1 security helpers: events, login rate limits, emergency lockdown, session epoch.
 */
import { db } from "@/lib/supabase";

export type SecurityEventKind =
  | "login_ok"
  | "login_fail"
  | "logout"
  | "logout_all"
  | "cron_denied"
  | "perm_denied"
  | "lockdown_block"
  | "suspicious"
  | "admin_action";

export type LockdownFlags = {
  withdrawals: boolean;
  balance_adjust: boolean;
  grants: boolean;
  staff_manage: boolean;
  gov_send: boolean;
  disburse: boolean;
};

const DEFAULT_LOCKDOWN: LockdownFlags = {
  withdrawals: false,
  balance_adjust: false,
  grants: false,
  staff_manage: false,
  gov_send: false,
  disburse: false,
};

export function clientIp(req: Request): string | null {
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

/** Best-effort security event log — never throws to caller. */
export async function logSecurityEvent(opts: {
  kind: SecurityEventKind;
  ip?: string | null;
  discordId?: string | null;
  path?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db().from("econ_security_events").insert({
      kind: opts.kind,
      ip_address: opts.ip?.slice(0, 64) ?? null,
      discord_id: opts.discordId?.slice(0, 32) ?? null,
      path: opts.path?.slice(0, 300) ?? null,
      detail: opts.detail ?? {},
    });
  } catch (e) {
    console.error("logSecurityEvent:", e instanceof Error ? e.message : e);
  }
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;

/** Returns true if this IP (or discord) is currently locked out for login. */
export async function isLoginRateLimited(ip: string | null, discordId?: string | null): Promise<boolean> {
  try {
    const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
    const supa = db();
    if (ip) {
      const { count } = await supa
        .from("econ_login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("success", false)
        .eq("ip_address", ip)
        .gte("created_at", since);
      if ((count ?? 0) >= LOGIN_MAX_FAILS) return true;
    }
    if (discordId) {
      const { count } = await supa
        .from("econ_login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("success", false)
        .eq("discord_id", discordId)
        .gte("created_at", since);
      if ((count ?? 0) >= LOGIN_MAX_FAILS) return true;
    }
  } catch (e) {
    console.error("isLoginRateLimited:", e instanceof Error ? e.message : e);
  }
  return false;
}

export async function recordLoginAttempt(opts: {
  ip: string | null;
  discordId?: string | null;
  success: boolean;
  reason?: string;
}): Promise<void> {
  try {
    await db().from("econ_login_attempts").insert({
      ip_address: opts.ip?.slice(0, 64) ?? null,
      discord_id: opts.discordId?.slice(0, 32) ?? null,
      success: opts.success,
      reason: (opts.reason || "").slice(0, 80) || null,
    });
  } catch (e) {
    console.error("recordLoginAttempt:", e instanceof Error ? e.message : e);
  }
}

export async function getLockdown(): Promise<LockdownFlags> {
  try {
    const { data } = await db()
      .from("econ_settings")
      .select("value")
      .eq("key", "emergency_lockdown")
      .maybeSingle();
    const v = (data?.value || {}) as Partial<LockdownFlags>;
    return { ...DEFAULT_LOCKDOWN, ...v };
  } catch {
    return { ...DEFAULT_LOCKDOWN };
  }
}

/** If the named operation is locked, return an error message; else null. */
export async function lockdownBlocks(
  op: keyof LockdownFlags
): Promise<string | null> {
  const flags = await getLockdown();
  if (!flags[op]) return null;
  return "Emergency lockdown is active for this operation. Contact the owner.";
}

/** Bump session epoch so all existing cookies for this Discord user die. */
export async function bumpSessionEpoch(discordId: string): Promise<void> {
  const supa = db();
  const { data } = await supa
    .from("econ_members")
    .select("session_epoch")
    .eq("discord_id", discordId)
    .maybeSingle();
  const next = Number(data?.session_epoch ?? 0) + 1;
  await supa
    .from("econ_members")
    .update({ session_epoch: next })
    .eq("discord_id", discordId);
}

export async function getSessionEpoch(discordId: string): Promise<number> {
  try {
    const { data } = await db()
      .from("econ_members")
      .select("session_epoch")
      .eq("discord_id", discordId)
      .maybeSingle();
    return Number(data?.session_epoch ?? 0);
  } catch {
    return 0;
  }
}
