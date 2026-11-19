import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { quoteGrowthGrant, fetchNationGrowth, PROJECT_LIST } from "@/lib/grantCosts";
import { executeGrowthGrant } from "@/lib/grantGrowth";
import { collectGrant, applyConvertNegatives } from "@/lib/grants";
import {
  getGrantRepaySettings,
  saveGrantRepaySettings,
  migrateGrantsForRepay,
  runGrantRepaySync,
  backfillGrantsFromPaidRequests,
} from "@/lib/grantRepay";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const a = url.searchParams.get("a");
  if (a === "projects") {
    return NextResponse.json({ projects: PROJECT_LIST });
  }
  if (a === "nation") {
    const id = Number(url.searchParams.get("nationId"));
    if (!id) return NextResponse.json({ error: "nationId required" }, { status: 400 });
    try {
      const n = await fetchNationGrowth(id);
      return NextResponse.json({
        ok: true,
        nation: {
          id: n.id,
          label: `${n.leader_name} (#${n.id})`,
          nation_name: n.nation_name,
          leader_name: n.leader_name,
          num_cities: n.num_cities,
          domestic_policy: n.domestic_policy,
          projects: n.projects,
          cities: n.cities.map((c, i) => ({
            id: c.id,
            index: i + 1,
            infrastructure: c.infrastructure,
            land: c.land,
          })),
        },
        projects: PROJECT_LIST,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Load failed" },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ error: "Unknown" }, { status: 400 });
}

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
  const cityIds = Array.isArray(body.cityIds)
    ? (body.cityIds as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : undefined;

  if (action === "set_repay_tax") {
    const tax_id = Number(body.tax_id);
    if (!Number.isInteger(tax_id) || tax_id <= 0) {
      return NextResponse.json(
        { error: "Enter the in-game tax ID for grant repayment (50/50)" },
        { status: 400 }
      );
    }
    await saveGrantRepaySettings({
      tax_id,
      alliance_id: body.alliance_id != null ? Number(body.alliance_id) : undefined,
    });
    return NextResponse.json({ ok: true, tax_id });
  }

  
  if (action === "backfill_request_grants") {
    const r = await backfillGrantsFromPaidRequests();
    return NextResponse.json({ ok: true, ...r });
  }
if (action === "migrate_repay") {
    const r = await migrateGrantsForRepay();
    return NextResponse.json({ ok: true, ...r });
  }

  if (action === "run_repay_sync") {
    const r = await runGrantRepaySync();
    return NextResponse.json(r);
  }

  if (action === "repay_status") {
    const settings = await getGrantRepaySettings();
    return NextResponse.json({ settings });
  }

  if (action === "quote") {
    const quote = await quoteGrowthGrant({
      nationId: Number(body.nationId),
      grantType: body.grantType as "city" | "infra" | "land" | "project",
      cityCount: body.cityCount != null ? Number(body.cityCount) : undefined,
      cityTo: body.cityTo != null ? Number(body.cityTo) : undefined,
      cityIds,
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
      cityTo: body.cityTo != null ? Number(body.cityTo) : undefined,
      cityIds,
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
