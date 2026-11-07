import { NextResponse } from "next/server";
import { syncBankrecs } from "@/lib/bankrecs";
import { maybeRunAutoOffshore } from "@/lib/autoOffshore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const url = new URL(req.url);
  return (
    req.headers.get("authorization") === `Bearer ${secret}` ||
    url.searchParams.get("secret") === secret ||
    req.headers.get("x-cron-secret") === secret
  );
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
