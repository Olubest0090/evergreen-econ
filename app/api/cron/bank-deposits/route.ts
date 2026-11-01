import { NextResponse } from "next/server";
import { syncBankDeposits } from "@/lib/bankDeposits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true; // allow if not set (still prefer setting it)
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
    const result = await syncBankDeposits();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("bank-deposits cron:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 502 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
