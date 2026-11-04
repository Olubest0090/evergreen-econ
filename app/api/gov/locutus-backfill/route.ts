import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const staff = await requireStaff();

  if (!staff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Historical balance credits are restricted to the Head of Economics.
  if (!staff.isHead) {
    return NextResponse.json(
      { error: "Only the Head of Economics can run this backfill." },
      { status: 403 }
    );
  }

  try {
    const { data, error } = await db().rpc("econ_backfill_locutus_pending");

    if (error) {
      console.error("Locutus historical backfill failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    const result = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      ok: true,
      membersProcessed: Number(result?.members_processed ?? 0),
      depositsClaimed: Number(result?.deposits_claimed ?? 0),
    });
  } catch (error) {
    console.error("Locutus historical backfill error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backfill failed" },
      { status: 500 }
    );
  }
}
