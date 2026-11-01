import { NextResponse } from "next/server";
import { requireStaff, type Staff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { getSetting, setSetting } from "@/lib/settings";
import { computeNet } from "@/lib/books";
import { cleanAmounts } from "@/lib/resources";

export const dynamic = "force-dynamic";

const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
const canConfigure = (s: Staff) => s.isHead || s.canManageRoles;

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return err("Forbidden", 403);
  try {
    return NextResponse.json({ ...(await computeNet()), canConfigure: canConfigure(staff) });
  } catch (e) {
    console.error("books failed:", e instanceof Error ? e.message : e);
    return err("Could not work out the net", 500);
  }
}

export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return err("Forbidden", 403);
  if (!canConfigure(staff)) return err("Only the econ head can change the books.");
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err("Invalid request");
  }
  const action = String(body.action || "");
  const note = String(body.note ?? "").trim().slice(0, 200);
  const supa = db();

  if (action === "credit" || action === "debit") {
    const amounts = cleanAmounts(body.amounts);
    if (!amounts) return err("Enter at least one amount");
    const { error } = await supa.from("econ_audit_log").insert({
      actor_discord_id: staff.discordId,
      action: action === "credit" ? "offshore_evergreen_credit" : "offshore_evergreen_debit",
      details: { amounts, note, manual: true },
    });
    if (error) return err("Could not save", 500);
    return NextResponse.json({ ok: true });
  }

  if (action === "baseline") {
    const amounts = cleanAmounts(body.amounts, true);
    if (!amounts) return err("Check the amounts");
    const books = await getSetting<Record<string, unknown>>("offshore_books", {});
    const { error } = await setSetting("offshore_books", { ...books, baseline: amounts });
    if (error) return err(error, 500);
    await supa.from("econ_audit_log").insert({ actor_discord_id: staff.discordId, action: "offshore_baseline_set", details: { amounts, note } });
    return NextResponse.json({ ok: true });
  }

  return err("Unknown action");
}
