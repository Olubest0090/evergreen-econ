import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { syncBankrecs } from "@/lib/bankrecs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Any logged-in member opening the site nudges a deposit sync (at most one real run every 2 minutes). */
export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const r = await syncBankrecs({ minIntervalMs: 120_000 });
    return NextResponse.json({ ok: true, ran: !r.skipped });
  } catch (e) {
    console.error("deposit sync failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
