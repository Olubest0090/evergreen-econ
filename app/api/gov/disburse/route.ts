import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { previewDisburse, runDisburse } from "@/lib/disburse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const taxId = Number(url.searchParams.get("taxId") || "");
  const days = Number(url.searchParams.get("days") || "7");
  if (!Number.isInteger(taxId) || taxId <= 0) {
    return NextResponse.json({ error: "taxId required (in-game tax bracket id)" }, { status: 400 });
  }

  try {
    const data = await previewDisburse({ taxId, days: days > 0 ? days : 7 });
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Preview failed" },
      { status: 502 }
    );
  }
}

export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { taxId?: number; days?: number; nationIds?: number[]; confirm?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const taxId = Number(body.taxId);
  if (!Number.isInteger(taxId) || taxId <= 0) {
    return NextResponse.json({ error: "taxId required" }, { status: 400 });
  }
  if (body.confirm !== "SEND") {
    return NextResponse.json(
      { error: 'Type confirm: "SEND" to disburse from offshore' },
      { status: 400 }
    );
  }

  try {
    const result = await runDisburse({
      taxId,
      days: body.days && body.days > 0 ? body.days : 7,
      nationIds: body.nationIds,
      staffDiscordId: staff.discordId,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Disburse failed" },
      { status: 502 }
    );
  }
}
