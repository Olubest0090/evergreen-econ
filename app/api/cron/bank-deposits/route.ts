import { NextResponse } from "next/server";
import { syncBankrecs } from "@/lib/bankrecs";
import { maybeRunAutoOffshore } from "@/lib/autoOffshore";
import { cronAuthorized, cronUnauthorized } from "@/lib/cronAuth";
import { clientIp, logSecurityEvent } from "@/lib/securityCore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    void logSecurityEvent({
      kind: "cron_denied",
      ip: clientIp(req),
      path: "/api/cron/bank-deposits",
    });
    return cronUnauthorized();
  }

  try {
    const result = await syncBankrecs({ minIntervalMs: 50_000, force: false });
    let autoOffshore: { ran: boolean; reason: string; record?: string | null } | null = null;
    try {
      autoOffshore = await maybeRunAutoOffshore();
    } catch (e) {
      console.error("auto-offshore cron:", e);
      autoOffshore = {
        ran: false,
        reason: e instanceof Error ? e.message : "auto-offshore error",
      };
    }
    return NextResponse.json({ ok: true, ...result, autoOffshore });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Sync failed";
    console.error("bank-deposits cron:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
