import { db } from "@/lib/supabase";
import { bankWithdraw, type BankAmounts } from "@/lib/pnwBank";

/** Requests page: approve grant + send from offshore + mark paid */
export async function approveAndSendGrantRequest(
  requestId: string,
  actorDiscordId: string
): Promise<{ ok: true; record?: string | null } | { ok: false; error: string }> {
  const supa = db();
  const { data: req } = await supa
    .from("econ_requests")
    .select(
      "id, kind, status, amounts, purpose, member_id, econ_members(nation_id, leader_name)"
    )
    .eq("id", requestId)
    .maybeSingle();

  if (!req) return { ok: false, error: "Request not found" };
  if (req.kind !== "grant") return { ok: false, error: "Not a grant request" };
  if (req.status !== "pending" && req.status !== "approved") {
    return { ok: false, error: `Status is ${req.status}` };
  }

  if (req.status === "pending") {
    const { error } = await supa.rpc("econ_decide_request", {
      p_staff: actorDiscordId,
      p_request: requestId,
      p_decision: "approve",
      p_note: "Approved via Discord",
      p_terms: null,
    });
    if (error) return { ok: false, error: error.message };
  }

  const mem = Array.isArray(req.econ_members) ? req.econ_members[0] : req.econ_members;
  const nationId = Number((mem as { nation_id?: number } | null)?.nation_id);
  if (!nationId) return { ok: false, error: "Member nation missing" };

  const amounts = req.amounts as BankAmounts;
  const result = await bankWithdraw({
    actor: "offshore",
    receiver: nationId,
    receiverType: "nation",
    amounts,
    note: `Evergreen GRANT request ${requestId.slice(0, 8)}`,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const { error: paidErr } = await supa.rpc("econ_mark_request_paid", {
    p_staff: actorDiscordId,
    p_request: requestId,
    p_ref: result.id ? `bank #${result.id}` : "Discord GRANT",
  });
  if (paidErr) {
    return {
      ok: false,
      error: `Sent in-game but mark paid failed: ${paidErr.message}`,
    };
  }

  await supa.from("econ_audit_log").insert({
    actor_discord_id: actorDiscordId,
    action: "grant_request_discord_sent",
    details: { request: requestId, nationId, record: result.id, amounts },
  });

  return { ok: true, record: result.id };
}

export async function denyGrantRequest(
  requestId: string,
  actorDiscordId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await db().rpc("econ_decide_request", {
    p_staff: actorDiscordId,
    p_request: requestId,
    p_decision: "deny",
    p_note: "Denied via Discord",
    p_terms: null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Bank withdrawal GRANT (existing) */
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
    return { ok: false, error: "Not a GRANT withdrawal" };
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
  const receiver = Number(
    w.recipient_nation_id || (member as { nation_id?: number })?.nation_id
  );
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
