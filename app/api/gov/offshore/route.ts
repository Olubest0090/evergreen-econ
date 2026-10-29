import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { getSetting, setSetting, type OffshoreConfig } from "@/lib/settings";
import { db } from "@/lib/supabase";
import {
  bankWithdrawToNation,
  fetchAllianceBank,
  firstNationInAlliance,
} from "@/lib/pnwBank";

export const dynamic = "force-dynamic";

function canOffshore(staff: NonNullable<Awaited<ReturnType<typeof requireStaff>>>) {
  return staff.perms === null || staff.isHead || staff.can("withdrawals");
}

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!canOffshore(staff)) return NextResponse.json({ error: "No permission" }, { status: 403 });

  const cfg = await getSetting<OffshoreConfig | null>("offshore", null);
  return NextResponse.json({
    offshore: cfg,
    botKeyConfigured: !!process.env.VERIFIED_BOT_KEY?.trim(),
    apiKeyConfigured: !!process.env.PNW_API_KEY?.trim(),
  });
}

export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!canOffshore(staff)) return NextResponse.json({ error: "No permission" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const action = String(body.action || "");
  const supa = db();

  if (action === "save") {
    const offshoreAllianceId = Number(body.offshore_alliance_id);
    const sourceAllianceId =
      body.source_alliance_id != null && String(body.source_alliance_id).trim() !== ""
        ? Number(body.source_alliance_id)
        : undefined;
    const bankerNationId =
      body.banker_nation_id != null && String(body.banker_nation_id).trim() !== ""
        ? Number(body.banker_nation_id)
        : undefined;
    const label = String(body.label || "").trim().slice(0, 80);

    if (!Number.isFinite(offshoreAllianceId) || offshoreAllianceId <= 0) {
      return NextResponse.json({ error: "Enter a valid offshore alliance ID" }, { status: 400 });
    }
    if (sourceAllianceId != null && (!Number.isFinite(sourceAllianceId) || sourceAllianceId <= 0)) {
      return NextResponse.json({ error: "Invalid source alliance ID" }, { status: 400 });
    }
    if (bankerNationId != null && (!Number.isFinite(bankerNationId) || bankerNationId <= 0)) {
      return NextResponse.json({ error: "Invalid banker nation ID" }, { status: 400 });
    }

    const value: OffshoreConfig = {
      offshore_alliance_id: offshoreAllianceId,
      source_alliance_id: sourceAllianceId,
      banker_nation_id: bankerNationId,
      label: label || undefined,
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
    if (!cfg?.offshore_alliance_id) {
      return NextResponse.json({ error: "Save offshore alliance ID first" }, { status: 400 });
    }

    const sourceId =
      Number(body.source_alliance_id) ||
      cfg.source_alliance_id ||
      Number((await getSetting<{ alliance_id?: number }>("alliance", {})).alliance_id);
    if (!sourceId) {
      return NextResponse.json(
        { error: "Set source (main) alliance ID — bank to empty" },
        { status: 400 }
      );
    }

    let receiver = cfg.banker_nation_id;
    if (!receiver) {
      try {
        receiver = (await firstNationInAlliance(cfg.offshore_alliance_id)) ?? undefined;
      } catch (e) {
        return NextResponse.json(
          {
            error:
              e instanceof Error
                ? e.message
                : "Could not find a nation in the offshore alliance",
          },
          { status: 502 }
        );
      }
    }
    if (!receiver) {
      return NextResponse.json(
        {
          error:
            "Set a banker nation ID in the offshore alliance (P&W can only bankWithdraw to a nation)",
        },
        { status: 400 }
      );
    }

    let amounts;
    try {
      amounts = await fetchAllianceBank(sourceId);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Could not read source alliance bank" },
        { status: 502 }
      );
    }

    const result = await bankWithdrawToNation(
      receiver,
      amounts,
      "Econ → offshore"
    );
    await supa.from("econ_audit_log").insert({
      actor_discord_id: staff.discordId,
      action: result.ok ? "offshore_send_all" : "offshore_send_all_failed",
      details: {
        sourceId,
        offshoreAlliance: cfg.offshore_alliance_id,
        receiver,
        amounts,
        result: result.ok ? result.raw : result.error,
      },
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({ ok: true, amounts, receiver, raw: result.raw });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
