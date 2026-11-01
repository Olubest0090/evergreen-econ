import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { getDiscordBotToken } from "@/lib/secrets";
import { notifyGrantRequest } from "@/lib/discordNotify";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const token = await getDiscordBotToken();
  const grantCh =
    process.env.DISCORD_GRANT_CHANNEL_ID?.trim() ||
    process.env.DISCORD_ECON_CHANNEL_ID?.trim() ||
    "";
  const depositCh =
    process.env.DISCORD_DEPOSIT_CHANNEL_ID?.trim() ||
    process.env.DISCORD_ECON_CHANNEL_ID?.trim() ||
    "";
  const role = process.env.DISCORD_ECON_ROLE_ID?.trim() || "";
  const publicKey = !!process.env.DISCORD_PUBLIC_KEY?.trim();

  const status = {
    botToken: token ? `set (len ${token.length})` : "MISSING",
    grantChannelId: grantCh || "MISSING",
    depositChannelId: depositCh || "MISSING",
    econRoleId: role || "MISSING",
    publicKey: publicKey ? "set" : "MISSING",
  };

  if (!token || !grantCh) {
    return NextResponse.json({
      ok: false,
      status,
      error: "Fix MISSING env vars, redeploy, then retry",
    });
  }

  const result = await notifyGrantRequest({
    requestId: "00000000-0000-0000-0000-000000000001",
    label: "Discord test (staff)",
    nationId: 0,
    amounts: { money: 1 },
    purpose: "Manual test from /api/gov/discord-test",
  });

  return NextResponse.json({ ok: result.ok, status, result });
}
