import { NextResponse } from "next/server";
import { syncBankDeposits } from "@/lib/bankDeposits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const url = new URL(req.url);
  const auth =
    !secret ||
    req.headers.get("authorization") === `Bearer ${secret}` ||
    url.searchParams.get("secret") === secret ||
    req.headers.get("x-cron-secret") === secret;

  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await syncBankDeposits();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("bank-deposits:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 502 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
