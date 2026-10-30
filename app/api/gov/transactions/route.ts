import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { LABEL } from "@/lib/resources";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  id: string;
  at: string;
  memberId: string;
  account: string;
  nationId: number | null;
  type: string;
  description: string;
  resource: string;
  amount: number;
};

function sinceDays(period: string): string | null {
  if (period === "all") return null;
  const d = period === "7" ? 7 : period === "90" ? 90 : 30;
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
}

export async function GET(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (staff.perms !== null && !staff.isHead && !staff.can("members") && !staff.can("balances")) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  const url = new URL(req.url);
  const period = url.searchParams.get("period") || "30";
  const memberId = (url.searchParams.get("member") || "").trim();
  const q = (url.searchParams.get("q") || "").trim().slice(0, 40);
  const since = sinceDays(period);
  const supa = db();

  // Resolve member filter
  let memberFilter: string | null = null;
  if (memberId && UUID.test(memberId)) memberFilter = memberId;

  let memberIds: string[] | null = null;
  if (q && !memberFilter) {
    const safe = q.replace(/[\\%_,()]/g, "\\$&");
    let query = supa
      .from("econ_members")
      .select("id")
      .limit(50);
    query = /^\d+$/.test(q)
      ? query.eq("nation_id", Number(q))
      : query.or(
          `leader_name.ilike.%${safe}%,nation_name.ilike.%${safe}%,discord_username.ilike.%${safe}%`
        );
    const { data: hits } = await query;
    memberIds = (hits ?? []).map((m) => m.id);
    if (!memberIds.length) {
      return NextResponse.json({
        period,
        moneyIn: 0,
        moneyOut: 0,
        count: 0,
        rows: [],
      });
    }
  }

  const rows: Row[] = [];

  // Ledger
  {
    let lq = supa
      .from("econ_ledger")
      .select(
        "id, member_id, resource, amount, kind, note, created_at, econ_members(discord_username, nation_id, leader_name)"
      )
      .order("created_at", { ascending: false })
      .limit(2000);
    if (since) lq = lq.gte("created_at", since);
    if (memberFilter) lq = lq.eq("member_id", memberFilter);
    else if (memberIds) lq = lq.in("member_id", memberIds);
    const { data, error } = await lq;
    if (error) {
      console.error("tx ledger", error.message);
      return NextResponse.json({ error: "Could not load ledger" }, { status: 500 });
    }
    for (const r of data ?? []) {
      const m = r.econ_members as {
        discord_username?: string;
        nation_id?: number;
        leader_name?: string | null;
      } | null;
      const amt = Number(r.amount);
      rows.push({
        id: `L${r.id}`,
        at: r.created_at,
        memberId: String(r.member_id),
        account: m
          ? `${m.leader_name ?? m.discord_username} (#${m.nation_id})`
          : String(r.member_id),
        nationId: m?.nation_id != null ? Number(m.nation_id) : null,
        type: String(r.kind || "ledger").replace(/_/g, " "),
        description: r.note || String(r.kind),
        resource: String(r.resource),
        amount: amt,
      });
    }
  }

  // Withdrawals (sent / failed / denied / pending shown in period by requested_at)
  {
    let wq = supa
      .from("econ_withdrawals")
      .select(
        "id, member_id, amounts, status, requested_at, sent_at, error, recipient_nation_id, econ_members(discord_username, nation_id, leader_name)"
      )
      .order("requested_at", { ascending: false })
      .limit(500);
    if (since) wq = wq.gte("requested_at", since);
    if (memberFilter) wq = wq.eq("member_id", memberFilter);
    else if (memberIds) wq = wq.in("member_id", memberIds);
    const { data } = await wq;
    for (const w of data ?? []) {
      const m = w.econ_members as {
        discord_username?: string;
        nation_id?: number;
        leader_name?: string | null;
      } | null;
      const account = m
        ? `${m.leader_name ?? m.discord_username} (#${m.nation_id})`
        : String(w.member_id);
      const amounts = (w.amounts || {}) as Record<string, number>;
      for (const [resource, amount] of Object.entries(amounts)) {
        const signed = -Math.abs(Number(amount));
        rows.push({
          id: `W${w.id}-${resource}`,
          at: w.sent_at || w.requested_at,
          memberId: String(w.member_id),
          account,
          nationId: m?.nation_id != null ? Number(m.nation_id) : null,
          type: `withdrawal ${String(w.status).replace(/_/g, " ")}`,
          description:
            w.recipient_nation_id && Number(w.recipient_nation_id) !== Number(m?.nation_id)
              ? `To nation #${w.recipient_nation_id}${w.error ? ` · ${w.error}` : ""}`
              : w.error || `Withdrawal ${w.status}`,
          resource,
          amount: signed,
        });
      }
    }
  }

  // Paid requests (grants etc.)
  {
    let rq = supa
      .from("econ_requests")
      .select(
        "id, member_id, kind, amounts, purpose, status, paid_at, created_at, econ_members(discord_username, nation_id, leader_name)"
      )
      .eq("status", "paid")
      .order("paid_at", { ascending: false })
      .limit(500);
    if (since) rq = rq.gte("paid_at", since);
    if (memberFilter) rq = rq.eq("member_id", memberFilter);
    else if (memberIds) rq = rq.in("member_id", memberIds);
    const { data } = await rq;
    for (const r of data ?? []) {
      const m = r.econ_members as {
        discord_username?: string;
        nation_id?: number;
        leader_name?: string | null;
      } | null;
      const account = m
        ? `${m.leader_name ?? m.discord_username} (#${m.nation_id})`
        : String(r.member_id);
      const amounts = (r.amounts || {}) as Record<string, number>;
      for (const [resource, amount] of Object.entries(amounts)) {
        rows.push({
          id: `R${r.id}-${resource}`,
          at: r.paid_at || r.created_at,
          memberId: String(r.member_id),
          account,
          nationId: m?.nation_id != null ? Number(m.nation_id) : null,
          type: String(r.kind || "request"),
          description: r.purpose || `Paid ${r.kind}`,
          resource,
          amount: Math.abs(Number(amount)),
        });
      }
    }
  }

  rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  let moneyIn = 0;
  let moneyOut = 0;
  for (const r of rows) {
    if (r.resource !== "money") continue;
    if (r.amount >= 0) moneyIn += r.amount;
    else moneyOut += Math.abs(r.amount);
  }

  return NextResponse.json({
    period,
    moneyIn: Math.round(moneyIn * 100) / 100,
    moneyOut: Math.round(moneyOut * 100) / 100,
    count: rows.length,
    rows: rows.slice(0, 1500),
    labels: LABEL,
  });
}
