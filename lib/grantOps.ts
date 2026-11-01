import { db } from "@/lib/supabase";
import { bankWithdraw, type BankAmounts } from "@/lib/pnwBank";

/** Approve GRANT withdrawal and auto-send from offshore. */
export async function approveAndSendGrant(
  withdrawalId: string,
  actorDiscordId: string
): Promise<{ ok: true; record?: string | null } | { ok: false; error: string }> {
  const supa = db();
  const { data: w } = await supa
    .from("econ_withdrawals")
    .select("id, amounts, status, tag, recipient_nation_id, econ_members(nation_id)")
    .eq("id", withdrawalId)
    .maybeSingle();

  if (!w) return { ok: false, error: "Withdrawal not found" };
  if (String(w.tag || "").toUpperCase() !== "GRANT") {
    return { ok: false, error: "Not a GRANT request" };
  }
  if (w.status !== "pending_approval" && w.status !== "approved") {
    return { ok: false, error: `Status is ${w.status}` };
  }

  if (w.status === "pending_approval") {
    const { error } = await supa.rpc("econ_resolve_withdrawal", {
      p_id: withdrawalId,
      p_action: "approve",
      p_actor: actorDiscordId,
      p_ref: null,
      p_note: "Approved via Discord",
    });
    if (error) return { ok: false, error: error.message };
  }

  const member = Array.isArray(w.econ_members) ? w.econ_members[0] : w.econ_members;
  const receiver = Number(w.recipient_nation_id || (member as { nation_id?: number })?.nation_id);
  if (!receiver) return { ok: false, error: "No recipient nation" };

  const claim = await supa.rpc("econ_resolve_withdrawal", {
    p_id: withdrawalId,
    p_action: "claim",
    p_actor: actorDiscordId,
    p_ref: null,
    p_note: null,
  });
  if (claim.error) return { ok: false, error: claim.error.message };

  const result = await bankWithdraw({
    actor: "offshore",
    receiver,
    receiverType: "nation",
    amounts: w.amounts as BankAmounts,
    note: "Evergreen Econ GRANT",
  });

  if (!result.ok) {
    await supa.rpc("econ_resolve_withdrawal", {
      p_id: withdrawalId,
      p_action: "release",
      p_actor: actorDiscordId,
      p_ref: null,
      p_note: result.error.slice(0, 250),
    });
    return { ok: false, error: result.error };
  }

  await supa.rpc("econ_resolve_withdrawal", {
    p_id: withdrawalId,
    p_action: "sent",
    p_actor: actorDiscordId,
    p_ref: result.id ? `bank record #${result.id}` : "GRANT from offshore",
    p_note: null,
  });
  await supa.from("econ_audit_log").insert({
    actor_discord_id: actorDiscordId,
    action: "withdrawal_grant_auto_sent",
    details: { withdrawal: withdrawalId, receiver, record: result.id, via: "discord" },
  });
  return { ok: true, record: result.id };
}

export async function denyGrant(
  withdrawalId: string,
  actorDiscordId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await db().rpc("econ_resolve_withdrawal", {
    p_id: withdrawalId,
    p_action: "deny",
    p_actor: actorDiscordId,
    p_ref: null,
    p_note: "Denied via Discord",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
