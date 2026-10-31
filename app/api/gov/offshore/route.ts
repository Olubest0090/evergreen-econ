import { NextResponse } from "next/server";
import { requireStaff, type Staff } from "@/lib/auth";
import { getSetting, setSetting, type OffshoreConfig } from "@/lib/settings";
import { db } from "@/lib/supabase";
import {
  bankWithdraw,
  bankWithdrawArgs,
  diagnose,
  fetchAllianceBank,
  firstNationInAlliance,
  keyStatus,
  type BankAmounts,
} from "@/lib/pnwBank";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

/** Moving the whole bank or changing the offshore is limited to heads (or any staff until a head exists). */
const canConfigure = (s: Staff) => s.isHead || s.canManageRoles;

async function plan(cfg: OffshoreConfig | null) {
  if (!cfg?.offshore_alliance_id) return { ok: false as const, error: "Save the offshore alliance ID first" };
  const sourceId = cfg.source_alliance_id || Number((await getSetting<{ alliance_id?: number }>("alliance", {})).alliance_id);
  if (!sourceId) return { ok: false as const, error: "Set the main alliance ID (the bank to empty)" };

  let amounts: BankAmounts;
  try {
    amounts = await fetchAllianceBank(sourceId, "source");
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Could not read the main alliance bank" };
  }

  // Send straight to the offshore alliance if the API allows it, otherwise to a banker nation in it.
  let toAlliance = false;
  try {
    toAlliance = (await bankWithdrawArgs("source")).some((a) => a.name === "receiver_type");
  } catch {
    toAlliance = false;
  }
  let receiver = toAlliance ? cfg.offshore_alliance_id : cfg.banker_nation_id;
  if (!receiver) {
    try {
      receiver = (await firstNationInAlliance(cfg.offshore_alliance_id, "source")) ?? undefined;
    } catch {
      receiver = undefined;
    }
  }
  if (!receiver) return { ok: false as const, error: "Set a banker nation ID in the offshore alliance" };
  return {
    ok: true as const,
    sourceId,
    amounts,
    receiver,
    receiverType: (toAlliance ? "alliance" : "nation") as "alliance" | "nation",
  };
}

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return err("Forbidden", 403);
  const cfg = await getSetting<OffshoreConfig | null>("offshore", null);
  return NextResponse.json({ offshore: cfg, canConfigure: canConfigure(staff), keys: await keyStatus() });
}

export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return err("Forbidden", 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err("Invalid request");
  }
  const action = String(body.action || "");
  const supa = db();

  /* ----- send one approved member withdrawal from the offshore ----- */
  if (action === "send_withdrawal") {
    if (!staff.can("withdrawals")) return err("You don't have permission for that. Ask the econ head.");
    const id = String(body.id || "");
    if (!UUID.test(id)) return err("Invalid request");

    const { data: w } = await supa
      .from("econ_withdrawals")
      .select("id, amounts, status, recipient_nation_id, econ_members(nation_id)")
      .eq("id", id)
      .maybeSingle();
    if (!w) return err("Withdrawal not found", 404);
    if (w.status !== "approved") return err("Only approved withdrawals can be sent");

    const member = Array.isArray(w.econ_members) ? w.econ_members[0] : w.econ_members;
    const receiver = Number(w.recipient_nation_id || member?.nation_id);
    if (!Number.isFinite(receiver) || receiver <= 0) return err("This withdrawal has no recipient nation");

    // Lock it so it can never be sent twice.
    const claim = await supa.rpc("econ_resolve_withdrawal", { p_id: id, p_action: "claim", p_actor: staff.discordId, p_ref: null, p_note: null });
    if (claim.error) return err("Someone else is already sending this one", 409);

    const result = await bankWithdraw({
      actor: "offshore",
      receiver,
      receiverType: "nation",
      amounts: w.amounts as BankAmounts,
      note: "Evergreen Econ withdrawal",
    });

    if (result.ok) {
      const done = await supa.rpc("econ_resolve_withdrawal", {
        p_id: id, p_action: "sent", p_actor: staff.discordId, p_ref: result.id ? `bank record #${result.id}` : "sent from offshore", p_note: null,
      });
      if (done.error) {
        console.error("marked-sent failed after a real send:", done.error.message, "withdrawal", id);
        return err("It WAS sent, but the site couldn't record it. Mark it as sent by hand.", 500);
      }
      await supa.from("econ_audit_log").insert({ actor_discord_id: staff.discordId, action: "withdrawal_sent_offshore", details: { withdrawal: id, receiver, amounts: w.amounts, record: result.id } });
      return NextResponse.json({ ok: true, record: result.id });
    }

    await supa.rpc("econ_resolve_withdrawal", { p_id: id, p_action: "release", p_actor: staff.discordId, p_ref: null, p_note: result.error.slice(0, 250) });
    return err(result.error, 502);
  }

  /* ----- everything below changes the offshore setup: heads only ----- */
  if (!canConfigure(staff)) return err("Only the econ head can do that.");

  if (action === "diagnose") {
    const actor = body.actor === "offshore" ? "offshore" : "source";
    return NextResponse.json({ ok: true, report: await diagnose(actor) });
  }

  if (action === "save") {
    const num = (v: unknown) => (v != null && String(v).trim() !== "" ? Number(v) : undefined);
    const offshoreAllianceId = Number(body.offshore_alliance_id);
    const sourceAllianceId = num(body.source_alliance_id);
    const bankerNationId = num(body.banker_nation_id);
    const label = String(body.label || "").trim().slice(0, 80);
    if (!Number.isInteger(offshoreAllianceId) || offshoreAllianceId <= 0) return err("Enter a valid offshore alliance ID");
    if (sourceAllianceId !== undefined && (!Number.isInteger(sourceAllianceId) || sourceAllianceId <= 0)) return err("Invalid main alliance ID");
    if (bankerNationId !== undefined && (!Number.isInteger(bankerNationId) || bankerNationId <= 0)) return err("Invalid banker nation ID");

    const value: OffshoreConfig = {
      offshore_alliance_id: offshoreAllianceId,
      source_alliance_id: sourceAllianceId,
      banker_nation_id: bankerNationId,
      label: label || undefined,
      updated_at: new Date().toISOString(),
    };
    const { error } = await setSetting("offshore", value);
    if (error) return err(error, 500);
    await supa.from("econ_audit_log").insert({ actor_discord_id: staff.discordId, action: "offshore_config_saved", details: value });
    return NextResponse.json({ ok: true, offshore: value });
  }

  if (action === "preview_send_all" || action === "send_all") {
    const cfg = await getSetting<OffshoreConfig | null>("offshore", null);
    const p = await plan(cfg);
    if (!p.ok) return err(p.error, p.error.startsWith("P&W") ? 502 : 400);

    if (action === "preview_send_all") {
      return NextResponse.json({ ok: true, sourceId: p.sourceId, receiver: p.receiver, receiverType: p.receiverType, amounts: p.amounts });
    }
    if (body.confirm !== "SEND") return err("Type SEND to confirm");
    if (Object.keys(p.amounts).length === 0) return err("The main bank is empty");

    const result = await bankWithdraw({ actor: "source", receiver: p.receiver, receiverType: p.receiverType, amounts: p.amounts, note: "Econ to offshore" });
    await supa.from("econ_audit_log").insert({
      actor_discord_id: staff.discordId,
      action: result.ok ? "offshore_send_all" : "offshore_send_all_failed",
      details: { sourceId: p.sourceId, offshoreAlliance: cfg?.offshore_alliance_id, receiver: p.receiver, receiverType: p.receiverType, amounts: p.amounts, result: result.ok ? result.id : result.error },
    });
    if (!result.ok) return err(result.error, 502);
    return NextResponse.json({ ok: true, amounts: p.amounts, receiver: p.receiver, record: result.id });
  }

  return err("Unknown action");
}
