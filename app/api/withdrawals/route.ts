import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { getMe, requireStaff } from "@/lib/auth";
import { cleanAmounts, LABEL } from "@/lib/resources";
import { getSetting } from "@/lib/settings";
import { bankWithdraw, type BankAmounts } from "@/lib/pnwBank";

export const dynamic = "force-dynamic";
export const maxDuration = 60;


const TAGS = new Set(["GRANT", "DEPOSIT", "IGNORE"]);

/** Map P&W / bank errors to member-facing text. */
function friendlySendError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("blockade") || m.includes("blockaded"))
    return "You are blockaded — the alliance bank cannot send to you until the blockade ends.";
  if (m.includes("vacation") || m.includes("vm mode") || m.includes("vacation mode"))
    return "Your nation is in Vacation Mode — bank transfers cannot complete.";
  if (m.includes("not enough") || m.includes("insufficient") || m.includes("lack the resources"))
    return "The offshore bank does not have enough of one or more resources right now. Try again later or contact econ.";
  if (m.includes("401") || m.includes("unauthorized") || m.includes("don't belong together"))
    return "Bank keys are misconfigured. Econ staff need to fix API/bot keys.";
  if (m.includes("429") || m.includes("rate"))
    return "Politics & War rate-limited the send. Wait a minute and try again.";
  if (m.includes("receiver") && m.includes("id"))
    return "Invalid recipient nation for the bank send.";
  const cut = raw.replace(/\s+/g, " ").trim().slice(0, 180);
  return cut
    ? `Could not send in-game: ${cut}`
    : "Could not send in-game. Your deposit was refunded on the site.";
}

/** Credit site balance back when in-game send fails after deduct. */
async function refundDepositWithdrawal(
  memberId: string,
  amounts: Record<string, number>,
  withdrawalId: string,
  reason: string
) {
  const supa = db();
  const entries = Object.entries(amounts)
    .filter(([, v]) => Number(v) > 0)
    .map(([resource, amount]) => ({
      member_id: memberId,
      resource,
      amount: Number(amount),
      kind: "deposit",
      note: `Refund: withdrawal ${withdrawalId} not sent — ${reason.slice(0, 120)}`,
      created_by: "system:auto_refund",
    }));
  if (!entries.length) return { ok: true as const };
  const { error } = await supa.from("econ_ledger").insert(entries);
  if (error) {
    console.error("refund ledger failed:", error.message, withdrawalId);
    return { ok: false as const, error: error.message };
  }
  await supa.from("econ_audit_log").insert({
    actor_discord_id: "system",
    action: "withdrawal_auto_refund",
    details: { withdrawal: withdrawalId, amounts, reason: reason.slice(0, 200) },
  });
  await supa
    .from("econ_withdrawals")
    .update({
      status: "failed",
      error: `Refunded on site. ${reason}`.slice(0, 250),
    })
    .eq("id", withdrawalId);
  return { ok: true as const };
}


/**
 * After a DEPOSIT withdrawal is created (balance already deducted by RPC),
 * send resources from the offshore bank automatically — no staff approval.
 */
async function autoSendDepositFromOffshore(opts: {
  withdrawalId: string;
  memberId: string;
  receiverNationId: number;
  amounts: BankAmounts;
  actorDiscordId: string;
}): Promise<{ sent: boolean; record?: string | null; error?: string }> {
  const supa = db();
  const id = opts.withdrawalId;

  // Ensure status is approved so the same claim/sent RPCs staff use will work.
  await supa
    .from("econ_withdrawals")
    .update({ status: "approved", error: null })
    .eq("id", id)
    .in("status", ["pending_approval", "approved", "queued"]);

  const claim = await supa.rpc("econ_resolve_withdrawal", {
    p_id: id,
    p_action: "claim",
    p_actor: opts.actorDiscordId,
    p_ref: null,
    p_note: null,
  });
  if (claim.error) {
    return {
      sent: false,
      error: claim.error.message.includes("claim")
        ? "Could not lock withdrawal for auto-send"
        : claim.error.message,
    };
  }

  const result = await bankWithdraw({
    actor: "offshore",
    receiver: opts.receiverNationId,
    receiverType: "nation",
    amounts: opts.amounts,
    note: "Evergreen Econ auto DEPOSIT",
  });

  if (result.ok) {
    const done = await supa.rpc("econ_resolve_withdrawal", {
      p_id: id,
      p_action: "sent",
      p_actor: opts.actorDiscordId,
      p_ref: result.id ? `bank record #${result.id}` : "auto-sent from offshore",
      p_note: null,
    });
    if (done.error) {
      console.error("auto-send marked-sent failed:", done.error.message, id);
      return {
        sent: true,
        record: result.id,
        error:
          "Sent in-game but site failed to mark sent — tell staff with the bank record id",
      };
    }
    await supa.from("econ_audit_log").insert({
      actor_discord_id: opts.actorDiscordId,
      action: "withdrawal_auto_sent_offshore",
      details: {
        withdrawal: id,
        receiver: opts.receiverNationId,
        amounts: opts.amounts,
        record: result.id,
        tag: "DEPOSIT",
      },
    });
    return { sent: true, record: result.id };
  }

  await supa.rpc("econ_resolve_withdrawal", {
    p_id: id,
    p_action: "release",
    p_actor: opts.actorDiscordId,
    p_ref: null,
    p_note: result.error.slice(0, 250),
  });

  const friendly = friendlySendError(result.error);
  const refund = await refundDepositWithdrawal(
    opts.memberId,
    opts.amounts as Record<string, number>,
    id,
    friendly
  );

  await supa.from("econ_audit_log").insert({
    actor_discord_id: opts.actorDiscordId,
    action: "withdrawal_auto_send_failed",
    details: {
      withdrawal: id,
      receiver: opts.receiverNationId,
      error: result.error,
      friendly,
      refunded: refund.ok,
      tag: "DEPOSIT",
    },
  });

  return {
    sent: false,
    error: refund.ok
      ? friendly
      : `${friendly} (refund failed — contact econ urgently)`,
    refunded: refund.ok,
  };
}

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
      { error: "Choose a tag: GRANT or DEPOSIT (IGNORE is staff-only)" },
      { status: 400 }
    );
  }

  // IGNORE is gov-only — members cannot request it
  if (tag === "IGNORE") {
    const staff = await requireStaff();
    if (!staff) {
      return NextResponse.json(
        { error: "Only econ staff can use IGNORE" },
        { status: 403 }
      );
    }
  }

  const recipientRaw = String(body.recipient ?? "").trim();
  if (recipientRaw && !/^\d{1,9}$/.test(recipientRaw)) {
    return NextResponse.json(
      { error: "The recipient must be a nation ID (numbers only)" },
      { status: 400 }
    );
  }

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

    const withdrawalId = data?.id ? String(data.id) : null;
    try {
      if (withdrawalId) {
        await db().from("econ_withdrawals").update({ tag: "DEPOSIT" }).eq("id", withdrawalId);
      }
    } catch {
      /* column may not exist */
    }

    if (!withdrawalId) {
      return NextResponse.json({
        ok: true,
        status: data?.status,
        self: data?.self,
        tag,
        auto_send: false,
        message: "Requested but no id returned — staff may need to send",
      });
    }

    const receiver =
      recipientRaw && /^\d+$/.test(recipientRaw)
        ? Number(recipientRaw)
        : Number(me.nationId);

    const auto = await autoSendDepositFromOffshore({
      withdrawalId,
      memberId: me.id,
      receiverNationId: receiver,
      amounts: amounts as BankAmounts,
      actorDiscordId: me.discordId,
    });

    if (auto.sent) {
      return NextResponse.json({
        ok: true,
        status: "sent",
        self: data?.self,
        tag: "DEPOSIT",
        auto_send: true,
        record: auto.record ?? null,
        message: auto.error || "Sent from offshore",
      });
    }

    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        self: data?.self,
        tag: "DEPOSIT",
        auto_send: false,
        refunded: auto.refunded !== false,
        error: auto.error,
        message:
          auto.error ||
          "In-game send failed. Your site balance was refunded for what was not sent.",
      },
      { status: 422 }
    );
  }

  // GRANT / IGNORE: still need staff approval (no auto-send)
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
  return NextResponse.json({
    ok: true,
    status: ins?.status || "pending_approval",
    tag,
    auto_send: false,
    message: "Queued for staff approval",
  });
}
