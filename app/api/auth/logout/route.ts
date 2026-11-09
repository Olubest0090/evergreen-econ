import { NextResponse } from "next/server";
import { clearSession, readSession } from "@/lib/session";
import { bumpSessionEpoch, clientIp, logSecurityEvent } from "@/lib/securityCore";

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok */
  }

  const session = await readSession();
  const all = body.all === true || body.all === "1";

  if (session && all) {
    try {
      await bumpSessionEpoch(session.discordId);
    } catch (e) {
      console.error("bumpSessionEpoch:", e instanceof Error ? e.message : e);
    }
    void logSecurityEvent({
      kind: "logout_all",
      ip: clientIp(req),
      discordId: session.discordId,
      path: "/api/auth/logout",
    });
  } else if (session) {
    void logSecurityEvent({
      kind: "logout",
      ip: clientIp(req),
      discordId: session.discordId,
      path: "/api/auth/logout",
    });
  }

  await clearSession();
  return NextResponse.json({ ok: true, all: !!all });
}
