import { NextResponse } from "next/server";
import { cronAuthorized, cronUnauthorized } from "@/lib/cronAuth";
import { runGrantRepaySync } from "@/lib/grantRepay";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return cronUnauthorized();
  try {
    const result = await runGrantRepaySync();
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "grant repay failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
