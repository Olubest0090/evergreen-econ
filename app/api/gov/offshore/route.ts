import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { getSetting, setSetting, type OffshoreConfig } from "@/lib/settings";
import { db } from "@/lib/supabase";
import { bankWithdrawToNation, fetchAllianceBank } from "@/lib/pnwBank";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!staff.can("withdrawals") && !staff.isHead && staff.perms !== null) {
    // heads + full access + withdrawals perm
    const full = staff.perms === null;
    if (!full && !staff.can("withdrawals")) {
      return NextResponse.json({ error: "No permission" }, { status: 403 });
    }
  }

  const cfg = await getSetting<OffshoreConfig | null>("offshore", null);
  const bot = !!process.env.VERIFIED_BOT_KEY;
  const api = !!process.env.PNW_API_KEY;
  return NextResponse.json({
    offshore: cfg,
    botKeyConfigured: bot,
    apiKeyConfigured: api,
  });
}

export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Prefer head or full staff for bank moves
  if (staff.perms !== null && !staff.isHead && !staff.can("withdrawals")) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const action = String(body.action || "");
  const supa = db();

  if (action === "save") {
    const nationId = Number(body.receiver_nation_id);
    const sourceAllianceId = body.source_alliance_id != null ? Number(body.source_alliance_id) : undefined;
    const label = String(body.label || "").trim().slice(0, 80);
    if (!Number.isFinite(nationId) || nationId <= 0) {
      return NextResponse.json({ error: "Enter a valid offshore receiver nation ID" }, { status: 400 });
    }
    if (sourceAllianceId != null && (!Number.isFinite(sourceAllianceId) || sourceAllianceId <= 0)) {
      return NextResponse.json({ error: "Invalid source alliance ID" }, { status: 400 });
    }
    const value: OffshoreConfig = {
      receiver_nation_id: nationId,
      label: label || undefined,
      source_alliance_id: sourceAllianceId,
      updated_at: new Date().toISOString(),
    };
    const { error } = await setSetting("offshore", value);
    if (error) return NextResponse.json({ error }, { status: 500 });
    await supa.from("econ_audit_log").insert({
      actor_discord_id: staff.discordId,
      action: "offshore_config_saved",
      details: value,
    });
    return NextResponse.json({ ok: true, offshore: value });
  }

  if (action === "send_all") {
    const cfg = await getSetting<OffshoreConfig | null>("offshore", null);
    if (!cfg?.receiver_nation_id) {
      return NextResponse.json(
        { error: "Set offshore receiver nation ID first" },
        { status: 400 }
      );
    }
    const allianceId =
      Number(body.source_alliance_id) ||
      cfg.source_alliance_id ||
      Number((await getSetting<{ alliance_id?: number }>("alliance", {})).alliance_id);
    if (!allianceId) {
      return NextResponse.json(
        { error: "Set source alliance ID (main bank) on offshore settings or alliance setting" },
        { status: 400 }
      );
    }

    let amounts;
    try {
      amounts = await fetchAllianceBank(allianceId);
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error
              ? e.message
              : "Could not read alliance bank (check API key bank access)",
        },
        { status: 502 }
      );
    }

    const result = await bankWithdrawToNation(
      cfg.receiver_nation_id,
      amounts,
      "Econ offshore transfer"
    );
    await supa.from("econ_audit_log").insert({
      actor_discord_id: staff.discordId,
      action: result.ok ? "offshore_send_all" : "offshore_send_all_failed",
      details: {
        allianceId,
        receiver: cfg.receiver_nation_id,
        amounts,
        result: result.ok ? result.raw : result.error,
      },
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, amounts, raw: result.raw });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
