import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { LABEL, RESOURCES } from "@/lib/resources";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RES = [
  "money", "food", "coal", "oil", "uranium", "lead", "iron", "bauxite",
  "gasoline", "munitions", "steel", "aluminum",
] as const;

async function fetchNationStockpile(nationId: number): Promise<Record<string, number> | null> {
  const key = process.env.PNW_API_KEY;
  if (!key) return null;
  try {
    const q = `query($id:[Int]){ nations(id:$id, first:1){ data { id ${RES.join(" ")} } } }`;
    const res = await fetch(
      `https://api.politicsandwar.com/graphql?api_key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, variables: { id: [nationId] } }),
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const n = json?.data?.nations?.data?.[0];
    if (!n) return null;
    const out: Record<string, number> = {};
    let any = false;
    for (const k of RES) {
      if (typeof n[k] === "number") {
        out[k] = n[k];
        any = true;
      }
    }
    return any ? out : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (staff.perms !== null && !staff.isHead && !staff.can("members") && !staff.can("balances")) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad member id" }, { status: 400 });

  const supa = db();
  const { data: mem, error: me } = await supa
    .from("econ_members")
    .select("id, discord_username, nation_id, nation_name, leader_name, status")
    .eq("id", id)
    .maybeSingle();
  if (me || !mem) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const nationId = Number(mem.nation_id);

  const [{ data: bal }, { data: ledger }, { data: paid }, { data: wds }, stockpile] =
    await Promise.all([
      supa.from("econ_balances").select("resource, balance").eq("member_id", id),
      supa
        .from("econ_ledger")
        .select("id, resource, amount, kind, note, created_at, actor_discord_id")
        .eq("member_id", id)
        .order("created_at", { ascending: false })
        .limit(300),
      supa
        .from("econ_requests")
        .select("id, kind, amounts, purpose, paid_at, decision_note, status")
        .eq("member_id", id)
        .eq("status", "paid")
        .order("paid_at", { ascending: false })
        .limit(100),
      supa
        .from("econ_withdrawals")
        .select(
          "id, amounts, status, requested_at, sent_at, error, recipient_nation_id, recipient_is_self, tag, note"
        )
        .eq("member_id", id)
        .order("requested_at", { ascending: false })
        .limit(100),
      fetchNationStockpile(nationId),
    ]);

  // actor names for adjustments
  const actorIds = [
    ...new Set(
      (ledger ?? [])
        .filter((l) => l.kind === "adjustment" && l.actor_discord_id)
        .map((l) => String(l.actor_discord_id))
    ),
  ];
  const actors = new Map<string, string>();
  if (actorIds.length) {
    const { data: people } = await supa
      .from("econ_members")
      .select("discord_id, leader_name, discord_username")
      .in("discord_id", actorIds);
    for (const p of people ?? []) {
      actors.set(String(p.discord_id), p.leader_name || p.discord_username || String(p.discord_id));
    }
  }

  const deposit: Record<string, number> = {};
  for (const b of bal ?? []) deposit[b.resource] = Number(b.balance);

  const lastAdj = (ledger ?? []).find((l) => l.kind === "adjustment") || null;

  const grants: Record<string, number> = {};
  for (const r of paid ?? []) {
    for (const [k, v] of Object.entries((r.amounts || {}) as Record<string, number>)) {
      grants[k] = Math.round(((grants[k] ?? 0) + Number(v)) * 100) / 100;
    }
  }

  // Unified timeline
  type Tx = {
    id: string;
    at: string;
    type: string;
    description: string;
    resource: string;
    amount: number;
    tag?: string | null;
  };
  const rows: Tx[] = [];

  for (const l of ledger ?? []) {
    rows.push({
      id: `L${l.id}`,
      at: l.created_at,
      type: String(l.kind).replace(/_/g, " "),
      description:
        l.kind === "adjustment"
          ? `${l.note || "Adjustment"}${l.actor_discord_id ? ` · by ${actors.get(String(l.actor_discord_id)) || l.actor_discord_id}` : ""}`
          : l.note || String(l.kind),
      resource: l.resource,
      amount: Number(l.amount),
    });
  }
  for (const w of wds ?? []) {
    const tag = (w as { tag?: string }).tag || null;
    for (const [resource, amount] of Object.entries((w.amounts || {}) as Record<string, number>)) {
      rows.push({
        id: `W${w.id}-${resource}`,
        at: w.sent_at || w.requested_at,
        type: `withdrawal ${String(w.status).replace(/_/g, " ")}`,
        description: [
          tag ? `Tag: ${tag}` : null,
          w.recipient_nation_id ? `→ #${w.recipient_nation_id}` : null,
          w.error || null,
        ]
          .filter(Boolean)
          .join(" · ") || "Withdrawal",
        resource,
        amount: -Math.abs(Number(amount)),
        tag,
      });
    }
  }
  for (const r of paid ?? []) {
    for (const [resource, amount] of Object.entries((r.amounts || {}) as Record<string, number>)) {
      rows.push({
        id: `R${r.id}-${resource}`,
        at: r.paid_at || "",
        type: String(r.kind),
        description: r.purpose || "Grant / support",
        resource,
        amount: Math.abs(Number(amount)),
        tag: "GRANT",
      });
    }
  }
  rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return NextResponse.json({
    member: mem,
    deposit,
    stockpile,
    stockpileNote: stockpile
      ? "In-game holdings from Politics & War (if the API key can see them)."
      : "Stockpile hidden or API key cannot read this nation’s resources.",
    lastAdjustment: lastAdj
      ? {
          at: lastAdj.created_at,
          resource: lastAdj.resource,
          amount: Number(lastAdj.amount),
          note: lastAdj.note,
          by: lastAdj.actor_discord_id
            ? actors.get(String(lastAdj.actor_discord_id)) || String(lastAdj.actor_discord_id)
            : "unknown",
        }
      : null,
    grantsTotal: grants,
    grantsList: paid ?? [],
    rows: rows.slice(0, 500),
    labels: LABEL,
    resources: RESOURCES,
  });
}
