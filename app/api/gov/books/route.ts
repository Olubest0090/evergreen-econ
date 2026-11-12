import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { fetchAllianceBank } from "@/lib/pnwBank";
import { getSetting, type OffshoreConfig } from "@/lib/settings";
import { marketWorth } from "@/lib/marketWorth";

export const dynamic = "force-dynamic";

const err = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return err("Forbidden", 403);

  try {
    const cfg = await getSetting<OffshoreConfig | null>("offshore", null);
    if (!cfg?.offshore_alliance_id) {
      return err("Save the offshore alliance ID first (Gov → Offshore)", 409);
    }
    // Live from P&W, not a ledger estimate — this is the bank's real current
    // total right now, including anyone else's holdings if the offshore is shared.
    const net = await fetchAllianceBank(cfg.offshore_alliance_id, "offshore");
    const worth = await marketWorth(net); // null if market prices unavailable
    return NextResponse.json({ net, worth, live: true });
  } catch (error) {
    console.error(
      "Books (live offshore bank) failed:",
      error instanceof Error ? error.message : error
    );
    return err(
      error instanceof Error ? error.message : "Could not read the offshore bank",
      502
    );
  }
}

export async function POST() {
  return err("Manual offshore book entries are disabled.", 405);
}
