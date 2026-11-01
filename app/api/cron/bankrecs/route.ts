import { NextResponse } from "next/server";
import { syncBankrecs } from "@/lib/bankrecs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Scheduled sync. Vercel sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set in the project. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await syncBankrecs({ force: true })) });
  } catch (e) {
    console.error("cron bankrecs failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "Sync failed" }, { status: 500 });
  }
}
