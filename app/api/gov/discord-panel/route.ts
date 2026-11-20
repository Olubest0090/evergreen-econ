import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { postEconControlPanel, panelChannelId } from "@/lib/econDiscordPanel";
import { setSetting, getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ch = await panelChannelId();
  const cfg = await getSetting("discord_channels", {});
  return NextResponse.json({ panelChannelId: ch || null, discord_channels: cfg });
}

export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staff.can("balances") && !staff.isHead) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body.channel_id) {
    const prev = await getSetting<Record<string, string>>("discord_channels", {});
    await setSetting("discord_channels", {
      ...prev,
      panel_channel_id: String(body.channel_id),
    });
  }

  const result = await postEconControlPanel(
    body.channel_id ? String(body.channel_id) : undefined
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
