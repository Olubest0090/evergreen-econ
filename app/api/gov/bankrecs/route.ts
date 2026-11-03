import { NextResponse } from "next/server";
import { requireStaff, type Staff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { getSetting, setSetting } from "@/lib/settings";
import { diagnoseBankrecs, syncBankrecs } from "@/lib/bankrecs";
import { previewOffshoreNationBackfill, applyOffshoreNationBackfill } from "@/lib/offshoreBackfill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
const canConfigure = (s: Staff) => s.isHead || s.canManageRoles;

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return err("Forbidden", 403);
  const [cursor, sync, books, pending] = await Promise.all([
    getSetting<{ start?: string; main?: number; offshore?: number }>("bankrec_cursor", {}),
    getSetting<{ last_run?: string; last_result?: unknown }>("bankrec_sync", {}),
    getSetting<{ trusted_depositors?: number[] }>("offshore_books", {}),
    db().from("econ_pending_deposits").select("id", { count: "exact", head: true }).is("claimed_at", null),
  ]);
  return NextResponse.json({
    cursor, lastRun: sync.last_run ?? null, lastResult: sync.last_result ?? null,
    pendingUnclaimed: pending.count ?? 0, trustedDepositors: books.trusted_depositors ?? [],
    canConfigure: canConfigure(staff),
  });
}

export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return err("Forbidden", 403);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err("Invalid request");
  }
  const action = String(body.action || "");
  const supa = db();

  if (action === "sync") {
    const r = await syncBankrecs({ force: true });
    return NextResponse.json({ ok: true, result: r });
  }

  if (action === "offshore_backfill_preview" || action === "offshore_backfill_apply") {
    if (!canConfigure(staff)) return err("Only the econ head can backfill.");
    const nationId = Number(body.nationId);
    const since = String(body.since || "2026-11-01T00:00:00.000Z");
    const depositsOnly = body.depositsOnly === true;
    try {
      if (action === "offshore_backfill_preview") {
        const preview = await previewOffshoreNationBackfill({ nationId, sinceIso: since });
        return NextResponse.json({ ok: true, preview });
      }
      if (body.confirm !== "CREDIT") return err("Type CREDIT to confirm");
      const applied = await applyOffshoreNationBackfill({
        nationId,
        sinceIso: since,
        staffDiscordId: staff.discordId,
        depositsOnly,
      });
      return NextResponse.json({
        ok: true,
        credited: applied.credited,
        memberId: applied.memberId,
        preview: applied.preview,
      });
    } catch (e) {
      return err(e instanceof Error ? e.message : "Backfill failed", 502);
    }
  }

  if (!canConfigure(staff)) return err("Only the econ head can do that.");

  if (action === "diagnose") {
    return NextResponse.json({ ok: true, report: await diagnoseBankrecs(body.which === "offshore" ? "offshore" : "main") });
  }

  if (action === "set_start") {
    const raw = String(body.start || "now");
    const when = raw === "now" ? new Date() : new Date(raw);
    if (Number.isNaN(when.getTime())) return err("That date isn't valid");
    const cursor = await getSetting<Record<string, unknown>>("bankrec_cursor", {});
    const next: Record<string, unknown> = { ...cursor, start: when.toISOString() };
    if (body.rescan === true) { delete next.main; delete next.offshore; }
    const { error } = await setSetting("bankrec_cursor", next);
    if (error) return err(error, 500);
    await supa.from("econ_audit_log").insert({ actor_discord_id: staff.discordId, action: "bankrec_start_set", details: { start: next.start, rescan: body.rescan === true } });
    return NextResponse.json({ ok: true, start: next.start });
  }

  if (action === "set_depositors") {
    const list = Array.isArray(body.nations) ? body.nations : String(body.nations ?? "").split(/[\s,]+/);
    const ids = Array.from(new Set(list.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)));
    const books = await getSetting<Record<string, unknown>>("offshore_books", {});
    const { error } = await setSetting("offshore_books", { ...books, trusted_depositors: ids });
    if (error) return err(error, 500);
    await supa.from("econ_audit_log").insert({ actor_discord_id: staff.discordId, action: "offshore_depositors_set", details: { nations: ids } });
    return NextResponse.json({ ok: true, trustedDepositors: ids });
  }

  return err("Unknown action");
}
