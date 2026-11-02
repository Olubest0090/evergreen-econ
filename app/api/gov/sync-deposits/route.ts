import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { syncBankrecs } from "@/lib/bankrecs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!staff.can("balances") && !staff.can("withdrawals") && !staff.isHead) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  try {
    const result = await syncBankrecs({ force: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("government deposit sync:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 502 }
    );
  }
}
