import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { quoteGrowthGrant } from "@/lib/grantCosts";
import { executeGrowthGrant } from "@/lib/grantGrowth";
import { collectGrant, applyConvertNegatives } from "@/lib/grants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!staff.can("balances") && !staff.can("requests") && !staff.can("members")) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(body.action || "");

  if (action === "quote") {
    const quote = await quoteGrowthGrant({
      nationId: Number(body.nationId),
      grantType: body.grantType as "city" | "infra" | "land" | "project",
      cityCount: body.cityCount != null ? Number(body.cityCount) : undefined,
      targetInfra: body.targetInfra != null ? Number(body.targetInfra) : undefined,
      targetLand: body.targetLand != null ? Number(body.targetLand) : undefined,
      projectName: body.projectName ? String(body.projectName) : undefined,
    });
    if (!quote.ok) return NextResponse.json({ error: quote.error }, { status: 400 });
    return NextResponse.json(quote);
  }

  if (action === "execute") {
    const result = await executeGrowthGrant({
      nationId: Number(body.nationId),
      grantType: body.grantType as "city" | "infra" | "land" | "project",
      cityCount: body.cityCount != null ? Number(body.cityCount) : undefined,
      targetInfra: body.targetInfra != null ? Number(body.targetInfra) : undefined,
      targetLand: body.targetLand != null ? Number(body.targetLand) : undefined,
      projectName: body.projectName ? String(body.projectName) : undefined,
      send: body.send === true,
      staffDiscordId: staff.discordId,
      note: body.note ? String(body.note) : undefined,
      amountsOverride:
        body.amounts && typeof body.amounts === "object"
          ? (body.amounts as Record<string, number>)
          : null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  }

  if (action === "convert_apply") {
    const result = await applyConvertNegatives({
      staffDiscordId: staff.discordId,
      note: body.note ? String(body.note) : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "collect") {
    const result = await collectGrant({
      grantId: String(body.grantId || ""),
      staffDiscordId: staff.discordId,
      waive: body.waive === true,
      note: body.note ? String(body.note) : undefined,
      amounts:
        body.amounts && typeof body.amounts === "object"
          ? (body.amounts as Record<string, number>)
          : null,
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
