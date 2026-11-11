import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { bankWithdraw, type BankAmounts, type Actor } from "@/lib/pnwBank";
import { RESOURCES, isResource } from "@/lib/resources";
import { lockdownBlocks, logSecurityEvent } from "@/lib/securityCore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

function cleanAmounts(raw: unknown): BankAmounts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: BankAmounts = {};
  let any = false;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isResource(k)) continue;
    const n = Math.round(Number(v) * 100) / 100;
    if (!Number.isFinite(n) || n <= 0) continue;
    out[k as keyof BankAmounts] = n;
    any = true;
  }
  return any ? out : null;
}

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return err("Forbidden", 403);
  if (!staff.isHead && !staff.can("withdrawals") && staff.perms !== null) {
    return err("No permission", 403);
  }
  const supa = db();
  const [{ data: members }, { data: history }] = await Promise.all([
    supa
      .from("econ_members")
      .select("id, nation_id, leader_name, discord_username, status")
      .eq("status", "active")
      .order("leader_name")
      .limit(500),
    supa
      .from("econ_audit_log")
      .select("id, actor_discord_id, action, details, created_at")
      .in("action", ["gov_send", "gov_send_failed", "gov_send_ledger_failed"])
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const rows = history ?? [];
  const actorIds = Array.from(
    new Set(rows.map((h) => String(h.actor_discord_id || "")).filter(Boolean))
  );

  // Resolve Discord IDs → leader / username (any status — staff may be inactive later)
  const nameByDiscord = new Map<string, string>();
  if (actorIds.length) {
    const { data: people } = await supa
      .from("econ_members")
      .select("discord_id, leader_name, discord_username")
      .in("discord_id", actorIds);
    for (const p of people ?? []) {
      const id = String(p.discord_id);
      const label =
        (p.leader_name && String(p.leader_name).trim()) ||
        (p.discord_username && String(p.discord_username).trim()) ||
        id;
      nameByDiscord.set(id, label);
    }
  }

  const historyWithWho = rows.map((h) => {
    const did = h.actor_discord_id ? String(h.actor_discord_id) : "";
    return {
      ...h,
      actor_name: did ? nameByDiscord.get(did) || did : "Unknown",
      actor_discord_id: did || null,
    };
  });

  return NextResponse.json({
    members: members ?? [],
    resources: RESOURCES,
    history: historyWithWho,
  });
}

/**
 * Gov send funds to a nation or alliance from main or offshore bank.
 * Optional memberId: if set, deduct those amounts from that member's site deposit after a successful send.
 * If empty: alliance bank only — no deposit is touched.
 */
export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return err("Forbidden", 403);
  if (!staff.isHead && !staff.can("withdrawals") && staff.perms !== null) {
    return err("You don't have permission to send funds.", 403);
  }

  const locked = await lockdownBlocks("gov_send");
  if (locked) {
    void logSecurityEvent({ kind: "lockdown_block", discordId: staff.discordId, path: "/api/gov/send" });
    return err(locked, 423);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err("Invalid request");
  }

  const from = String(body.from || "offshore") === "main" ? "source" : "offshore";
  const actor: Actor = from as Actor;
  const receiverType = String(body.receiverType || "nation") === "alliance" ? "alliance" : "nation";
  const receiver = Number(body.receiverId);
  if (!Number.isInteger(receiver) || receiver <= 0) {
    return err("Enter a valid nation or alliance ID to receive the funds");
  }

  const amounts = cleanAmounts(body.amounts);
  if (!amounts) return err("Enter at least one resource amount greater than 0");

  const note = String(body.note || "Gov send").trim().slice(0, 50) || "Gov send";
  const memberIdRaw = String(body.memberId || "").trim();
  const memberId = memberIdRaw || null;

  const supa = db();
  let debitMember: { id: string; nation_id: number; leader_name: string | null } | null = null;

  if (memberId) {
    const { data: mem } = await supa
      .from("econ_members")
      .select("id, nation_id, leader_name, status")
      .eq("id", memberId)
      .maybeSingle();
    if (!mem) return err("Member not found for deposit deduction");
    if (mem.status !== "active") return err("That member is not active");
    // Optional: check balances cover amounts
    const { data: bals } = await supa
      .from("econ_balances")
      .select("resource, balance")
      .eq("member_id", mem.id);
    const map = new Map((bals ?? []).map((b) => [b.resource, Number(b.balance)]));
    for (const [k, v] of Object.entries(amounts)) {
      const have = map.get(k) ?? 0;
      if (have + 1e-6 < (v ?? 0)) {
        return err(
          `Not enough ${k} on ${mem.leader_name || mem.nation_id}'s deposit (have ${have}, need ${v})`
        );
      }
    }
    debitMember = { id: mem.id, nation_id: Number(mem.nation_id), leader_name: mem.leader_name };
  }

  if (body.confirm !== "SEND") {
    return err('Type SEND to confirm');
  }

  const result = await bankWithdraw({
    actor,
    receiver,
    receiverType,
    amounts,
    note,
  });

  if (!result.ok) {
    await supa.from("econ_audit_log").insert({
      actor_discord_id: staff.discordId,
      action: "gov_send_failed",
      details: {
        from: actor,
        receiver,
        receiverType,
        amounts,
        note,
        memberId,
        error: result.error,
      },
    });
    return err(result.error, 502);
  }

  // Debit site deposit only if a member was chosen
  if (debitMember) {
    const bankrecId = typeof result.id === "number" ? result.id : Number(result.id) || null;
    const rows = Object.entries(amounts).map(([resource, amount]) => ({
      member_id: debitMember!.id,
      resource,
      amount: -Math.abs(Number(amount)),
      kind: "gov_send",
      note: `Gov send → ${receiverType} #${receiver} (${note}) bank#${result.id ?? "?"}`,
      // econ_ledger's column is `created_by`, NOT `actor_discord_id` — that was
      // the bug: PostgREST rejected the whole insert over the unknown column,
      // so the in-game send went through but the member's deposit was never
      // actually reduced.
      created_by: staff.discordId,
      bankrec_id: bankrecId,
    }));
    const { error: ledErr } = await supa.from("econ_ledger").insert(rows);
    if (ledErr) {
      console.error("gov_send ledger debit failed after bank send:", ledErr.message);
      await supa.from("econ_audit_log").insert({
        actor_discord_id: staff.discordId,
        action: "gov_send_ledger_failed",
        details: {
          from: actor,
          receiver,
          receiverType,
          amounts,
          memberId: debitMember.id,
          memberNation: debitMember.nation_id,
          bankRecord: result.id,
          depositDebited: false,
          ledgerError: ledErr.message,
        },
      });
      return NextResponse.json({
        ok: true,
        warning:
          "Funds were sent in-game, but the site could not deduct the member deposit. Fix the ledger by hand.",
        record: result.id,
        debited: false,
      });
    }
  }

  await supa.from("econ_audit_log").insert({
    actor_discord_id: staff.discordId,
    action: "gov_send",
    details: {
      from: actor,
      receiver,
      receiverType,
      amounts,
      note,
      memberId: debitMember?.id ?? null,
      memberNation: debitMember?.nation_id ?? null,
      bankRecord: result.id,
      depositDebited: !!debitMember,
      actorName: staff.leaderName || staff.username || staff.discordId,
    },
  });

  return NextResponse.json({
    ok: true,
    record: result.id,
    debited: !!debitMember,
    from: actor,
    receiver,
    receiverType,
    amounts,
  });
}
