import { NextResponse } from "next/server";
import { syncBankrecs } from "@/lib/bankrecs";
import { cronAuthorized, cronUnauthorized } from "@/lib/cronAuth";
import { clientIp, logSecurityEvent } from "@/lib/securityCore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    void logSecurityEvent({
      kind: "cron_denied",
      ip: clientIp(req),
      path: "/api/cron/bankrecs",
    });
    return cronUnauthorized();
  }
  try {
    const result = await syncBankrecs({ force: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    console.error("cron bankrecs failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
