/**
 * Phase 4 — IP block / trust list.
 */
import { db } from "@/lib/supabase";
import { logSecurityEvent } from "@/lib/securityCore";

export type IpRule = {
  id: number;
  ip_address: string;
  status: "blocked" | "trusted";
  reason: string | null;
  created_by: string | null;
  expires_at: string | null;
  created_at: string;
};

function normalizeIp(ip: string): string {
  return ip.trim().slice(0, 64);
}

export async function isIpBlocked(ip: string | null): Promise<boolean> {
  if (!ip) return false;
  try {
    const { data } = await db()
      .from("econ_ip_rules")
      .select("status, expires_at")
      .eq("ip_address", normalizeIp(ip))
      .eq("status", "blocked")
      .maybeSingle();
    if (!data) return false;
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return false;
    return true;
  } catch {
    return false; // fail open if table missing
  }
}

export async function isIpTrusted(ip: string | null): Promise<boolean> {
  if (!ip) return false;
  try {
    const { data } = await db()
      .from("econ_ip_rules")
      .select("id")
      .eq("ip_address", normalizeIp(ip))
      .eq("status", "trusted")
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

export async function listIpRules(): Promise<IpRule[]> {
  const { data } = await db()
    .from("econ_ip_rules")
    .select("id, ip_address, status, reason, created_by, expires_at, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []) as IpRule[];
}

export async function upsertIpRule(opts: {
  ip: string;
  status: "blocked" | "trusted";
  reason?: string;
  createdBy?: string;
  expiresAt?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ip = normalizeIp(opts.ip);
  if (!ip || ip.length < 3) return { ok: false, error: "Invalid IP" };
  const { error } = await db().from("econ_ip_rules").upsert(
    {
      ip_address: ip,
      status: opts.status,
      reason: (opts.reason || "").slice(0, 200) || null,
      created_by: opts.createdBy ?? null,
      expires_at: opts.expiresAt || null,
      created_at: new Date().toISOString(),
    },
    { onConflict: "ip_address" }
  );
  if (error) return { ok: false, error: error.message };
  void logSecurityEvent({
    kind: "admin_action",
    detail: { action: "ip_rule", ip, status: opts.status, reason: opts.reason },
  });
  return { ok: true };
}

export async function removeIpRule(ip: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await db().from("econ_ip_rules").delete().eq("ip_address", normalizeIp(ip));
  if (error) return { ok: false, error: error.message };
  void logSecurityEvent({
    kind: "admin_action",
    detail: { action: "ip_rule_remove", ip },
  });
  return { ok: true };
}

/** Zero negative balance rows via offsetting ledger entries (staff recovery). */
export async function zeroNegativeBalances(staffDiscordId: string): Promise<{
  fixed: number;
  rows: { member_id: string; resource: string; was: number }[];
}> {
  const { data: neg } = await db()
    .from("econ_balances")
    .select("member_id, resource, balance")
    .lt("balance", -0.01)
    .limit(200);

  const rows: { member_id: string; resource: string; was: number }[] = [];
  for (const n of neg ?? []) {
    const was = Number(n.balance);
    const member_id = String(n.member_id);
    const resource = String(n.resource);
    // Credit enough to bring to 0
    const amount = Math.abs(was);
    const { error } = await db().from("econ_ledger").insert({
      member_id,
      resource,
      amount,
      kind: "security_recovery",
      note: "Phase 4: zero negative balance",
      actor_discord_id: staffDiscordId,
    });
    if (error) {
      console.error("zero neg:", error.message);
      continue;
    }
    rows.push({ member_id, resource, was });
  }
  void logSecurityEvent({
    kind: "admin_action",
    discordId: staffDiscordId,
    detail: { action: "zero_negative_balances", fixed: rows.length },
  });
  return { fixed: rows.length, rows };
}
