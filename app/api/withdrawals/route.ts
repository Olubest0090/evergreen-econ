import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getMe } from "@/lib/auth";
import { cleanAmounts, LABEL } from "@/lib/resources";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const { data, error } = await db()
    .from("econ_withdrawals")
    .select("id, amounts, status, requested_at, sent_at, error, recipient_nation_id, recipient_is_self")
    .eq("member_id", me.id)
    .order("requested_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: "Could not load withdrawals" }, { status: 500 });
  return NextResponse.json({ withdrawals: data });
}

export async function POST(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  let body: { amounts?: unknown; recipient?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const amounts = cleanAmounts(body.amounts);
  if (!amounts) return NextResponse.json({ error: "Enter at least one amount" }, { status: 400 });

  const recipientRaw = String(body.recipient ?? "").trim();
  if (recipientRaw && !/^\d{1,9}$/.test(recipientRaw)) {
    return NextResponse.json({ error: "The recipient must be a nation ID (numbers only)" }, { status: 400 });
  }

  const rules = await getSetting<{ auto_limit_money?: number }>("withdraw_rules", { auto_limit_money: 0 });
  const { data, error } = await db().rpc("econ_request_withdrawal", {
    p_member: me.id,
    p_amounts: amounts,
    p_auto_limit: Number(rules.auto_limit_money ?? 0),
    p_recipient: recipientRaw ? Number(recipientRaw) : null,
  });
  if (error) {
    const m = error.message;
    const short = /insufficient_balance:(\w+)/.exec(m);
    if (short) {
      return NextResponse.json({ error: `Not enough ${(LABEL[short[1]] || short[1]).toLowerCase()} in your balance` }, { status: 400 });
    }
    if (m.includes("bad_recipient")) return NextResponse.json({ error: "Invalid recipient nation" }, { status: 400 });
    if (m.includes("member_suspended")) return NextResponse.json({ error: "Your account is suspended" }, { status: 403 });
    console.error("withdrawal failed:", m);
    return NextResponse.json({ error: "Could not request withdrawal" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, status: data?.status, self: data?.self });
}
