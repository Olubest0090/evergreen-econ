import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getMe } from "@/lib/auth";
import { cleanAmounts } from "@/lib/resources";
import { notifyGrantRequest } from "@/lib/discordNotify";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OPEN = 5;

export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const { data, error } = await db()
    .from("econ_requests")
    .select("id, kind, status, amounts, purpose, decision_note, created_at, decided_at, paid_at")
    .eq("member_id", me.id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: "Could not load requests" }, { status: 500 });
  return NextResponse.json({ requests: data });
}

export async function POST(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  let body: { action?: string; kind?: string; amounts?: unknown; purpose?: string; id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const supa = db();

  if (body.action === "cancel") {
    const id = String(body.id || "");
    if (!UUID.test(id)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const { data } = await supa
      .from("econ_requests")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("member_id", me.id)
      .eq("status", "pending")
      .select("id");
    if (!data?.length) return NextResponse.json({ error: "That request can't be cancelled" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const kind = body.kind === "grant" ? "grant" : body.kind === "warchest" ? "warchest" : null;
  const amounts = cleanAmounts(body.amounts);
  const purpose = String(body.purpose || "").trim().slice(0, 400);
  if (!kind) return NextResponse.json({ error: "Choose grant or warchest" }, { status: 400 });
  if (!amounts) return NextResponse.json({ error: "Enter at least one amount" }, { status: 400 });
  if (!purpose) return NextResponse.json({ error: "Say what it is for" }, { status: 400 });

  const { count } = await supa
    .from("econ_requests")
    .select("id", { count: "exact", head: true })
    .eq("member_id", me.id)
    .in("status", ["pending", "approved"]);
  if ((count ?? 0) >= MAX_OPEN) {
    return NextResponse.json(
      { error: `You already have ${MAX_OPEN} open requests. Wait for them to be handled first.` },
      { status: 429 }
    );
  }

  const { data: ins, error } = await supa
    .from("econ_requests")
    .insert({ member_id: me.id, kind, amounts, purpose })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("request insert failed:", error.message);
    return NextResponse.json({ error: "Could not save request" }, { status: 500 });
  }

  if (kind === "grant" && ins?.id) {
    try {
      void notifyGrantRequest({
        requestId: String(ins.id),
        label: me.leaderName || me.username || `Nation #${me.nationId}`,
        nationId: me.nationId,
        amounts: amounts as Record<string, number>,
        purpose,
      });
    } catch (e) {
      console.error("grant request discord notify:", e);
    }
  }

  return NextResponse.json({ ok: true });
}
