import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getMe } from "@/lib/auth";
import { cleanAmounts, LABEL } from "@/lib/resources";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

const TAGS = new Set(["GRANT", "DEPOSIT", "IGNORE"]);

export async function GET() {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const { data, error } = await db()
    .from("econ_withdrawals")
    .select(
      "id, amounts, status, requested_at, sent_at, error, recipient_nation_id, recipient_is_self, tag"
    )
    .eq("member_id", me.id)
    .order("requested_at", { ascending: false })
    .limit(30);
  if (error) {
    // tag column may not exist yet
    const fallback = await db()
      .from("econ_withdrawals")
      .select(
        "id, amounts, status, requested_at, sent_at, error, recipient_nation_id, recipient_is_self"
      )
      .eq("member_id", me.id)
      .order("requested_at", { ascending: false })
      .limit(30);
    if (fallback.error)
      return NextResponse.json({ error: "Could not load withdrawals" }, { status: 500 });
    return NextResponse.json({ withdrawals: fallback.data });
  }
  return NextResponse.json({ withdrawals: data });
}

export async function POST(req: Request) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  let body: { amounts?: unknown; recipient?: unknown; tag?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const amounts = cleanAmounts(body.amounts);
  if (!amounts) return NextResponse.json({ error: "Enter at least one amount" }, { status: 400 });

  const tag = String(body.tag || "")
    .trim()
    .toUpperCase();
  if (!TAGS.has(tag)) {
    return NextResponse.json(
      { error: "Choose a tag: GRANT, DEPOSIT, or IGNORE" },
      { status: 400 }
    );
  }

  const recipientRaw = String(body.recipient ?? "").trim();
  if (recipientRaw && !/^\d{1,9}$/.test(recipientRaw)) {
    return NextResponse.json(
      { error: "The recipient must be a nation ID (numbers only)" },
      { status: 400 }
    );
  }

  /**
   * Accounting rules:
   * DEPOSIT — deduct from site balance (normal withdrawal RPC).
   * GRANT — recorded as grant-style; should NOT deduct deposit (needs DB support; we still
   *         create a withdrawal row flagged GRANT when possible; balance deduct skipped via note for staff).
   * IGNORE — no deposit deduct, no grant total (flag only).
   *
   * Until SQL RPC is updated: DEPOSIT uses existing RPC. GRANT/IGNORE insert a pending row
   * without calling balance-deduct RPC when a soft path exists; otherwise DEPOSIT-only auto path.
   */
  const rules = await getSetting<{ auto_limit_money?: number }>("withdraw_rules", {
    auto_limit_money: 0,
  });

  if (tag === "DEPOSIT") {
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
        return NextResponse.json(
          {
            error: `Not enough ${(LABEL[short[1]] || short[1]).toLowerCase()} in your balance`,
          },
          { status: 400 }
        );
      }
      if (m.includes("bad_recipient"))
        return NextResponse.json({ error: "Invalid recipient nation" }, { status: 400 });
      if (m.includes("member_suspended"))
        return NextResponse.json({ error: "Your account is suspended" }, { status: 403 });
      console.error("withdrawal failed:", m);
      return NextResponse.json({ error: "Could not request withdrawal" }, { status: 500 });
    }
    // best-effort tag
    try {
      if (data?.id) {
        await db().from("econ_withdrawals").update({ tag: "DEPOSIT" }).eq("id", data.id);
      }
    } catch {
      /* column may not exist */
    }
    return NextResponse.json({ ok: true, status: data?.status, self: data?.self, tag });
  }

  // GRANT / IGNORE: queue for staff without balance deduct (insert if table allows)
  const { data: ins, error: insErr } = await db()
    .from("econ_withdrawals")
    .insert({
      member_id: me.id,
      amounts,
      status: "pending_approval",
      recipient_nation_id: recipientRaw ? Number(recipientRaw) : me.nationId,
      recipient_is_self: !recipientRaw || Number(recipientRaw) === me.nationId,
      tag,
      error: null,
    })
    .select("id, status")
    .maybeSingle();

  if (insErr) {
    console.error("grant/ignore withdraw insert:", insErr.message);
    return NextResponse.json(
      {
        error:
          "GRANT/IGNORE needs the withdrawals.tag column (and insert policy). Ask staff to run the SQL migration, or use DEPOSIT for now.",
      },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, status: ins?.status || "pending_approval", tag });
}
