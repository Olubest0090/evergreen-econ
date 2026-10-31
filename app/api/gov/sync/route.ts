import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { syncBankDeposits } from "@/lib/bankDeposits";

export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await requireStaff();

  if (!staff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!staff.can("balances") && !staff.isHead) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  try {
    const result = await syncBankDeposits();
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Protected bank sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
