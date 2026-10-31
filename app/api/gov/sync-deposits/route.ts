import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { syncBankDeposits } from "@/lib/bankDeposits";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Staff: pull recent in-game deposits into site balances (+ Yema offshore → Evergreen net). */
export async function POST() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!staff.can("balances") && !staff.can("withdrawals") && !staff.isHead) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }
  try {
    const result = await syncBankDeposits();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 502 }
    );
  }
}
