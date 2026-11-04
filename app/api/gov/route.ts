import { NextResponse } from "next/server";
import { bankWithdraw, type BankAmounts } from "@/lib/pnwBank";
import { db } from "@/lib/supabase";
import { PERMS, requireStaff } from "@/lib/auth";
import crypto from "crypto";
import { cleanAmounts, isResource, parseAmount } from "@/lib/resources";
import { parseNumber, readSheet } from "@/lib/sheet";
import { planLocutusImport, applyLocutusImport } from "@/lib/locutusImport";
import { fetchSheetCsv } from "@/lib/gsheet";
import { fetchAllianceHoldings, fetchLatestMarketPrices } from "@/lib/pnw";
import { makeDepositCode, sendDepositConfirmation } from "@/lib/depositNotify";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FRIENDLY: Record<string, string> = {
  wrong_state: "That was already handled",
  request_not_found: "Request not found",
  withdrawal_not_found: "Withdrawal not found",
  loan_needs_money: "A loan needs a money amount",
};
const friendly = (m: string) => {
  for (const k of Object.keys(FRIENDLY)) if (m.includes(k)) return FRIENDLY[k];
  return "Something went wrong";
};

const NOPERM = "You don't have permission for that. Ask the econ head.";
const noPerm = () => NextResponse.json({ error: NOPERM }, { status: 400 });
const note = (v: unknown) => String(v ?? "").trim().slice(0, 300);

type Plan = {
  matched: { memberId: string; label: string; deltas: Record<string, number> }[];
  unmatched: string[];
  errors: string[];
  resources: string[];
  rowCount: number;
};

/** Locutus sheet plan — registered + pending (unregistered nation IDs). */
async function planImport(supa: ReturnType<typeof db>, csv: string, mode: string): Promise<{ plan: Plan & { pending?: { nationId: number; label: string; deltas: Record<string, number> }[] } } | { error: string }> {
  const built = await planLocutusImport(csv, mode);
  if ("error" in built) return built;
  const { plan: lp } = built;
  const plan = {
    matched: lp.matched.map((m) => ({ memberId: m.memberId, label: m.label, deltas: m.deltas })),
    unmatched: [
      ...lp.pending.map((p) => `${p.label} (pending until login)`),
      ...lp.unmatched,
    ],
    errors: lp.errors,
    resources: lp.resources,
    rowCount: lp.rowCount,
    pending: lp.pending,
  };
  return { plan };
}


export async function GET(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const a = new URL(req.url).searchParams.get("a") || "requests";
  const status = new URL(req.url).searchParams.get("status") || "";
  const supa = db();

  if (a === "requests") {
    if (!staff.can("requests")) return noPerm();
    const states = status === "history" ? ["paid", "denied", "cancelled"] : status === "approved" ? ["approved"] : ["pending"];
    const { data, error } = await supa
      .from("econ_requests")
      .select("id, kind, status, amounts, purpose, terms, decision_note, created_at, econ_members(discord_username, nation_id, leader_name)")
      .in("status", states)
      .order("created_at", { ascending: states[0] === "pending" })
      .limit(60);
    if (error) return NextResponse.json({ error: "Could not load requests" }, { status: 500 });
    return NextResponse.json({ requests: data });
  }

  if (a === "withdrawals") {
    if (!staff.can("withdrawals")) return noPerm();
    const states = status === "history" ? ["sent", "failed", "denied"] : status === "approved" ? ["approved", "sending"] : ["pending_approval"];
    const { data, error } = await supa
      .from("econ_withdrawals")
      .select("id, amounts, status, requested_at, bank_ref, error, recipient_nation_id, recipient_is_self, econ_members(discord_username, nation_id, leader_name)")
      .in("status", states)
      .order("requested_at", { ascending: states[0] === "pending_approval" })
      .limit(60);
    if (error) return NextResponse.json({ error: "Could not load withdrawals" }, { status: 500 });
    return NextResponse.json({ withdrawals: data });
  }

  if (a === "members") {
    if (!staff.can("members")) return noPerm();
    const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 40);
    let query = supa
      .from("econ_members")
      .select("id, discord_username, nation_id, nation_name, leader_name, status, last_login")
      .order("leader_name", { ascending: true })
      .limit(100);
    if (q) {
      const safe = q.replace(/[\\%_,()]/g, "\\$&");
      query = /^\d+$/.test(q) ? query.eq("nation_id", Number(q)) : query.or(`leader_name.ilike.%${safe}%,nation_name.ilike.%${safe}%,discord_username.ilike.%${safe}%`);
    }
    const { data: members, error } = await query;
    if (error) return NextResponse.json({ error: "Could not load members" }, { status: 500 });
    const ids = (members ?? []).map((m) => m.id);
    const { data: bal } = ids.length
      ? await supa.from("econ_balances").select("member_id, resource, balance").in("member_id", ids)
      : { data: [] };
    return NextResponse.json({ members, balances: bal ?? [] });
  }

  if (a === "member") {
    if (!staff.can("members")) return noPerm();
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!UUID.test(id)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const [{ data: balRows }, { data: ledger }, { data: paid }, { data: wds }] = await Promise.all([
      supa.from("econ_balances").select("resource, balance").eq("member_id", id),
      supa.from("econ_ledger").select("id, resource, amount, kind, note, created_at").eq("member_id", id).order("created_at", { ascending: false }).limit(2000),
      supa.from("econ_requests").select("id, kind, amounts, purpose, paid_at, decision_note").eq("member_id", id).eq("status", "paid").order("paid_at", { ascending: false }).limit(100),
      supa.from("econ_withdrawals").select("amounts").eq("member_id", id).eq("status", "sent").limit(500),
    ]);
    const add = (t: Record<string, number>, k: string, v: number) => { t[k] = Math.round(((t[k] ?? 0) + v) * 100) / 100; };
    const balances: Record<string, number> = {};
    for (const b of balRows ?? []) balances[b.resource] = Number(b.balance);
    const deposited: Record<string, number> = {};
    const adjusted: Record<string, number> = {};
    for (const l of ledger ?? []) {
      if (l.kind === "deposit") add(deposited, l.resource, Number(l.amount));
      if (l.kind === "adjustment") add(adjusted, l.resource, Number(l.amount));
    }
    const granted: Record<string, number> = {};
    for (const r of paid ?? []) for (const [k, v] of Object.entries((r.amounts ?? {}) as Record<string, number>)) add(granted, k, Number(v));
    const withdrawn: Record<string, number> = {};
    for (const w of wds ?? []) for (const [k, v] of Object.entries((w.amounts ?? {}) as Record<string, number>)) add(withdrawn, k, Number(v));
    return NextResponse.json({
      balances, deposited, adjusted, granted, withdrawn,
      grants: paid ?? [],
      ledger: (ledger ?? []).slice(0, 40),
    });
  }

  if (a === "me") {
    return NextResponse.json({ perms: staff.perms, isHead: staff.isHead, canManageRoles: staff.canManageRoles });
  }

  if (a === "overview") {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const head = (table: string, col: string, val: string) =>
      supa.from(table).select("id", { count: "exact", head: true }).eq(col, val);
    const [pr, ar, pw, aw, mc, bal, dep, paid, sent, market] = await Promise.all([
      head("econ_requests", "status", "pending"),
      head("econ_requests", "status", "approved"),
      head("econ_withdrawals", "status", "pending_approval"),
      head("econ_withdrawals", "status", "approved"),
      supa.from("econ_members").select("id", { count: "exact", head: true }),
      supa.from("econ_balances").select("resource, balance").limit(20000),
      supa.from("econ_ledger").select("resource, amount").eq("kind", "deposit").gte("created_at", since).limit(20000),
      supa.from("econ_requests").select("kind, amounts").eq("status", "paid").gte("paid_at", since).limit(5000),
      supa.from("econ_withdrawals").select("amounts").eq("status", "sent").gte("sent_at", since).limit(5000),
      fetchLatestMarketPrices().catch((error) => {
        console.error("Market price lookup failed:", error);
        return null;
      }),
    ]);
    const add = (t: Record<string, number>, k: string, v: number) => { t[k] = Math.round(((t[k] ?? 0) + v) * 100) / 100; };
    const held: Record<string, number> = {};
    for (const b of bal.data ?? []) add(held, b.resource, Number(b.balance));
    const deposits: Record<string, number> = {};
    for (const l of dep.data ?? []) add(deposits, l.resource, Number(l.amount));
    const grants: Record<string, number> = {};
    for (const r of paid.data ?? []) for (const [k, v] of Object.entries((r.amounts ?? {}) as Record<string, number>)) add(grants, k, Number(v));
    const withdrawn: Record<string, number> = {};
    for (const w of sent.data ?? []) for (const [k, v] of Object.entries((w.amounts ?? {}) as Record<string, number>)) add(withdrawn, k, Number(v));

    const marketPrices = market?.prices ?? null;

    const heldMarketValue = marketPrices
      ? Object.entries(held).reduce((total, [resource, amount]) => {
          const price = Number(marketPrices[resource]);
          return total + (Number.isFinite(price) ? Number(amount) * price : 0);
        }, 0)
      : null;

    return NextResponse.json({
      pendingRequests: pr.count ?? 0, toSendRequests: ar.count ?? 0,
      pendingWithdrawals: pw.count ?? 0, toSendWithdrawals: aw.count ?? 0,
      members: mc.count ?? 0, held, deposits, grants, withdrawn,
      heldMarketValue,
      marketPrices,
      marketPriceDate: market?.date ?? null,
    });
  }

  if (a === "audit") {
    const { data: cfg } = await supa.from("econ_settings").select("value").eq("key", "alliance").maybeSingle();
    const allianceId = Number((cfg?.value as { alliance_id?: number } | null)?.alliance_id);
    if (!allianceId) return NextResponse.json({ error: "The alliance isn't set up yet" }, { status: 400 });
    let nations;
    try {
      nations = await fetchAllianceHoldings(allianceId);
    } catch (e) {
      console.error("audit lookup failed:", e);
      return NextResponse.json({ error: "Could not reach Politics & War right now" }, { status: 502 });
    }
    const [{ data: rule }, { data: overrides }, { data: members }] = await Promise.all([
      supa.from("econ_warchest_rules").select("base, per_city, active").eq("name", "Default").maybeSingle(),
      supa.from("econ_warchest_overrides").select("nation_id, targets"),
      supa.from("econ_members").select("nation_id").limit(3000),
    ]);
    const registered = new Set((members ?? []).map((m) => Number(m.nation_id)));
    const over = new Map<number, Record<string, number>>(
      (overrides ?? []).map((o): [number, Record<string, number>] => [Number(o.nation_id), o.targets as Record<string, number>])
    );
    const base = (rule?.base ?? {}) as Record<string, number>;
    const perCity = (rule?.per_city ?? {}) as Record<string, number>;

    const rows: { nationId: number; nation: string; leader: string; cities: number; registered: boolean; known: boolean; missing: Record<string, number> }[] = [];
    const notRegistered: string[] = [];
    let known = 0;
    for (const n of nations) {
      if ((n.alliance_position || "").toUpperCase() === "APPLICANT") continue;
      const id = Number(n.id);
      if (!registered.has(id)) notRegistered.push(`${n.leader_name} (#${id})`);
      const target: Record<string, number> = over.get(id) ?? {};
      if (!over.has(id) && rule?.active) {
        for (const k of Object.keys({ ...base, ...perCity })) {
          const v = Number(base[k] ?? 0) + Number(perCity[k] ?? 0) * Number(n.num_cities ?? 0);
          if (v > 0) target[k] = v;
        }
      }
      const missing: Record<string, number> = {};
      if (n.resources) {
        known++;
        for (const [k, t] of Object.entries(target)) {
          const short = Math.round((Number(t) - (n.resources[k] ?? 0)) * 100) / 100;
          if (short > 0) missing[k] = short;
        }
      }
      rows.push({ nationId: id, nation: n.nation_name, leader: n.leader_name, cities: Number(n.num_cities ?? 0), registered: registered.has(id), known: !!n.resources, missing });
    }
    rows.sort((a, b) => (b.missing.money ?? 0) - (a.missing.money ?? 0) || Object.keys(b.missing).length - Object.keys(a.missing).length);
    return NextResponse.json({
      targetActive: !!rule?.active || over.size > 0,
      holdingsKnown: known > 0,
      total: rows.length,
      under: rows.filter((r) => Object.keys(r.missing).length > 0).slice(0, 300),
      unknown: rows.filter((r) => !r.known).length,
      notRegistered: notRegistered.slice(0, 200),
    });
  }

  if (a === "staff") {
    if (!staff.canManageRoles) return noPerm();
    const [{ data: people }, { data: rows }] = await Promise.all([
      supa.from("econ_members").select("discord_id, leader_name, discord_username, nation_id").eq("staff", true).order("leader_name"),
      supa.from("econ_staff").select("discord_id, role, perms"),
    ]);
    const byId = new Map<string, { role: string; perms: string[] }>(
      (rows ?? []).map((r): [string, { role: string; perms: string[] }] => [String(r.discord_id), { role: String(r.role), perms: (r.perms as string[]) ?? [] }])
    );
    return NextResponse.json({
      perms: PERMS,
      staff: (people ?? []).map((m) => ({
        discordId: String(m.discord_id), leader: m.leader_name ?? m.discord_username, nationId: Number(m.nation_id),
        role: byId.get(String(m.discord_id))?.role ?? "default",
        perms: byId.get(String(m.discord_id))?.perms ?? null,
      })),
    });
  }

  if (a === "log") {
    const { data, error } = await supa
      .from("econ_audit_log")
      .select("id, actor_discord_id, action, details, created_at, econ_members(leader_name)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return NextResponse.json({ error: "Could not load log" }, { status: 500 });
    return NextResponse.json({ log: data });
  }

  if (a === "warchest") {
    const { data } = await supa.from("econ_warchest_rules").select("base, per_city, active").eq("name", "Default").maybeSingle();
    return NextResponse.json({ rule: data ?? { base: {}, per_city: {}, active: false } });
  }

  if (a === "taxes") {
    const { data } = await supa.from("econ_tax_rates").select("id, name, money_pct, resource_pct, note").order("sort").order("name");
    return NextResponse.json({ taxes: data ?? [] });
  }

  return NextResponse.json({ error: "Unknown request" }, { status: 400 });
}

export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const action = String(body.action || "");
  const supa = db();
  const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });



  // Recover Locutus deposits for members registered after the cutoff.
  // Preview first; applying is separately requested.
  if (action === "import_locutus_recovery") {
    if (!staff.can("import")) return noPerm();

    // 8:40 PM Nigeria time (WAT = UTC+1) on 3 Nov 2026
    const cutoff = String(body.cutoff || "2026-11-03T19:40:00.000Z");
    const cutoffMs = new Date(cutoff).getTime();
    if (!Number.isFinite(cutoffMs)) return bad("Invalid cutoff time");

    let csv = String(body.csv || body.text || body.sheet || "");
    if (!csv.trim() && body.url) {
      const got = await fetchSheetCsv(String(body.url));
      if (!got.ok) return bad(got.error);
      csv = got.csv;
    }
    if (!csv.trim()) return bad("Provide the original Locutus sheet or Google Sheet link.");

    // "add" = sheet amounts as deposits (for people who still have ~0 after registering)
    const built = await planLocutusImport(csv, "add");
    if ("error" in built) return bad(built.error);
    const plan = built.plan;

    if (!plan.matched.length) {
      return bad("No sheet rows matched registered members. They must log in once first, then run recovery again.");
    }

    // Load registration times for matched member IDs
    const memberIds = [...new Set(plan.matched.map((m) => m.memberId))];
    const { data: members, error: memberError } = await supa
      .from("econ_members")
      .select("id, nation_id, leader_name, nation_name, created_at, last_login")
      .in("id", memberIds);
    if (memberError) {
      console.error("Locutus recovery member lookup:", memberError.message);
      return bad("Could not check member registration dates.", 500);
    }

    const memberById = new Map((members ?? []).map((m) => [m.id, m]));

    type Credit = {
      memberId: string;
      nationId: number;
      label: string;
      resource: string;
      amount: number;
    };
    const credits: Credit[] = [];

    for (const row of plan.matched) {
      const mem = memberById.get(row.memberId);
      if (!mem) continue;
      // Prefer created_at; fall back to last_login
      const reg = mem.created_at || mem.last_login;
      if (!reg) continue;
      if (new Date(reg).getTime() <= cutoffMs) continue; // registered before cutoff → skip

      const nationId = Number(mem.nation_id) || Number(row.nationId) || 0;
      const label = `${mem.leader_name || mem.nation_name || "Member"} (#${nationId})`;

      for (const [resource, raw] of Object.entries(row.deltas)) {
        const amount = Number(raw);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        credits.push({
          memberId: row.memberId,
          nationId,
          label,
          resource,
          amount: Math.round(amount * 100) / 100,
        });
      }
    }

    const totals: Record<string, number> = {};
    const byMember = new Map<string, { label: string; nationId: number; amounts: Record<string, number> }>();
    for (const c of credits) {
      totals[c.resource] = Math.round(((totals[c.resource] ?? 0) + c.amount) * 100) / 100;
      const cur = byMember.get(c.memberId) || { label: c.label, nationId: c.nationId, amounts: {} };
      cur.amounts[c.resource] = Math.round(((cur.amounts[c.resource] ?? 0) + c.amount) * 100) / 100;
      byMember.set(c.memberId, cur);
    }

    const eligibleList = [...byMember.entries()].map(([id, v]) => ({
      memberId: id,
      nationId: v.nationId,
      label: v.label,
      amounts: v.amounts,
    }));

    if (body.preview === true || body.dryRun === true) {
      return NextResponse.json({
        ok: true,
        preview: true,
        cutoff,
        eligibleNations: eligibleList.length,
        entries: credits.length,
        totals,
        members: eligibleList.slice(0, 80),
        message:
          eligibleList.length === 0
            ? "No members registered after the cutoff matched the sheet. Nothing would change."
            : `Preview only. Would credit ${eligibleList.length} member(s). Older registrations are skipped.`,
      });
    }

    if (!staff.isHead && staff.perms !== null) {
      // allow any staff with import if no head restriction needed — keep head-only apply
      if (!staff.isHead) return bad("Only the econ head can apply this recovery.", 403);
    }
    if (!credits.length) {
      return bad("No eligible deposits found (nobody registered after the cutoff matched the sheet).");
    }

    // Idempotent note tag for this cutoff recovery
    const noteTag = `Locutus recovery after ${cutoff}`;
    let inserted = 0;
    let skipped = 0;

    for (const c of credits) {
      // Skip if this exact recovery credit already exists for this member+resource
      const { data: existing } = await supa
        .from("econ_ledger")
        .select("id")
        .eq("member_id", c.memberId)
        .eq("resource", c.resource)
        .eq("kind", "deposit")
        .eq("note", noteTag)
        .limit(1);
      if (existing?.length) {
        skipped += 1;
        continue;
      }

      const { error: insErr } = await supa.from("econ_ledger").insert({
        member_id: c.memberId,
        resource: c.resource,
        amount: c.amount,
        kind: "deposit",
        note: noteTag,
        created_by: staff.discordId,
      });
      if (insErr) {
        console.error("recovery insert failed:", insErr.message, c);
        return bad(`Stopped part-way after ${inserted} entries: ${insErr.message}`, 500);
      }
      inserted += 1;
    }

    await supa.from("econ_audit_log").insert({
      actor_discord_id: staff.discordId,
      action: "locutus_registration_recovery",
      details: {
        cutoff,
        eligibleNations: eligibleList.length,
        entries: credits.length,
        inserted,
        skipped,
        totals,
      },
    });

    return NextResponse.json({
      ok: true,
      preview: false,
      cutoff,
      eligibleNations: eligibleList.length,
      inserted,
      skipped,
      totals,
      message: `Credited ${inserted} ledger lines for ${eligibleList.length} member(s). Skipped ${skipped} already recovered. Members registered before the cutoff were not changed.`,
    });
  }

  if (action === "import_locutus" || action === "import") {
    if (!staff.can("balances") && !staff.can("members") && !staff.can("requests")) return noPerm();
    const mode = String(body.mode || "add");
    let csv = String(body.csv || body.text || body.sheet || "");
    if (!csv.trim() && body.url) {
      const got = await fetchSheetCsv(String(body.url));
      if (!got.ok) return bad(got.error);
      csv = got.csv;
    }
    if (!csv.trim()) return bad("Paste the sheet or provide a Google Sheet link");
    // Preview only
    if (body.preview === true || body.dryRun === true) {
      const built = await planImport(supa, csv, mode === "match" ? "match" : "add");
      if ("error" in built) return bad(built.error);
      return NextResponse.json({
        ok: true,
        ...built.plan,
        pending: (built.plan as { pending?: unknown }).pending,
      });
    }
    const applied = await applyLocutusImport({
      csv,
      mode: mode === "match" ? "match" : "add",
      staffDiscordId: staff.discordId,
    });
    if ("error" in applied) return bad(applied.error, 500);
    return NextResponse.json({
      ok: true,
      members: applied.members,
      entries: applied.entries,
      pendingNations: applied.pendingNations,
      pendingRows: applied.pendingRows,
      batch: applied.batch,
    });
  }

  if (action === "decide") {
    if (!staff.can("requests")) return noPerm();
    const id = String(body.requestId || "");
    const decision = String(body.decision || "");
    if (!UUID.test(id) || !["approve", "deny"].includes(decision)) return bad("Invalid request");
    const { error } = await supa.rpc("econ_decide_request", {
      p_staff: staff.discordId, p_request: id, p_decision: decision, p_note: note(body.note), p_terms: null,
    });
    return error ? bad(friendly(error.message)) : NextResponse.json({ ok: true });
  }

  if (action === "paid") {
    if (!staff.can("requests")) return noPerm();
    const id = String(body.requestId || "");
    if (!UUID.test(id)) return bad("Invalid request");
    const { error } = await supa.rpc("econ_mark_request_paid", {
      p_staff: staff.discordId, p_request: id, p_ref: note(body.ref) || null,
    });
    return error ? bad(friendly(error.message)) : NextResponse.json({ ok: true });
  }

  if (action === "withdrawal") {
    if (!staff.can("withdrawals")) return noPerm();
    const id = String(body.id || "");
    const op = String(body.op || "");
    if (!UUID.test(id) || !["approve", "deny", "sent", "failed", "release"].includes(op)) return bad("Invalid request");
    const { error } = await supa.rpc("econ_resolve_withdrawal", {
      p_id: id, p_action: op, p_actor: staff.discordId, p_ref: note(body.ref) || null, p_note: note(body.note) || null,
    });
    if (error) return bad(friendly(error.message));

    // GRANT: on approve, auto-send from offshore (no separate Send / mark sent)
    if (op === "approve") {
      const { data: w } = await supa
        .from("econ_withdrawals")
        .select("id, amounts, status, tag, recipient_nation_id, member_id, econ_members(nation_id)")
        .eq("id", id)
        .maybeSingle();
      const tag = String((w as { tag?: string } | null)?.tag || "").toUpperCase();
      if (w && tag === "GRANT") {
        const member = Array.isArray((w as { econ_members?: unknown }).econ_members)
          ? (w as { econ_members: { nation_id?: number }[] }).econ_members[0]
          : (w as { econ_members?: { nation_id?: number } }).econ_members;
        const receiver = Number(
          (w as { recipient_nation_id?: number }).recipient_nation_id || member?.nation_id || 0
        );
        if (receiver > 0) {
          const claim = await supa.rpc("econ_resolve_withdrawal", {
            p_id: id,
            p_action: "claim",
            p_actor: staff.discordId,
            p_ref: null,
            p_note: null,
          });
          if (!claim.error) {
            const result = await bankWithdraw({
              actor: "offshore",
              receiver,
              receiverType: "nation",
              amounts: (w as { amounts: BankAmounts }).amounts,
              note: "Evergreen Econ GRANT",
            });
            if (result.ok) {
              await supa.rpc("econ_resolve_withdrawal", {
                p_id: id,
                p_action: "sent",
                p_actor: staff.discordId,
                p_ref: result.id ? `bank record #${result.id}` : "auto GRANT from offshore",
                p_note: null,
              });
              await supa.from("econ_audit_log").insert({
                actor_discord_id: staff.discordId,
                action: "withdrawal_grant_auto_sent",
                details: { withdrawal: id, receiver, record: result.id },
              });
              return NextResponse.json({ ok: true, auto_sent: true, record: result.id });
            }
            await supa.rpc("econ_resolve_withdrawal", {
              p_id: id,
              p_action: "release",
              p_actor: staff.discordId,
              p_ref: null,
              p_note: result.error.slice(0, 250),
            });
            await supa
              .from("econ_withdrawals")
              .update({ status: "approved", error: result.error.slice(0, 250) })
              .eq("id", id);
            return NextResponse.json({
              ok: true,
              auto_sent: false,
              error: result.error,
              message: "Approved but offshore send failed — retry Send from offshore",
            });
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  }

  if (action === "save_warchest") {
    if (!staff.can("rules")) return noPerm();
    const base = cleanAmounts(body.base, true);
    const perCity = cleanAmounts(body.per_city, true);
    if (!base || !perCity) return bad("Check the amounts");
    const { error } = await supa.from("econ_warchest_rules").upsert(
      { name: "Default", base, per_city: perCity, active: true, updated_by: staff.discordId, updated_at: new Date().toISOString() },
      { onConflict: "name" }
    );
    if (error) return bad("Could not save");
    await supa.from("econ_audit_log").insert({ actor_discord_id: staff.discordId, action: "warchest_updated", details: { base, per_city: perCity } });
    return NextResponse.json({ ok: true });
  }

  if (action === "save_tax") {
    if (!staff.can("rules")) return noPerm();
    const name = String(body.name || "").trim().slice(0, 60);
    const money = Number(body.money_pct);
    const res = Number(body.resource_pct);
    if (!name || !Number.isFinite(money) || !Number.isFinite(res) || money < 0 || money > 100 || res < 0 || res > 100) {
      return bad("Enter a name and percentages between 0 and 100");
    }
    const { error } = await supa.from("econ_tax_rates").upsert(
      { name, money_pct: money, resource_pct: res, note: note(body.note) || null, updated_by: staff.discordId, updated_at: new Date().toISOString() },
      { onConflict: "name" }
    );
    if (error) return bad("Could not save");
    await supa.from("econ_audit_log").insert({ actor_discord_id: staff.discordId, action: "tax_saved", details: { name, money_pct: money, resource_pct: res } });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete_tax") {
    if (!staff.can("rules")) return noPerm();
    const id = Number(body.id);
    if (!Number.isInteger(id)) return bad("Invalid request");
    await supa.from("econ_tax_rates").delete().eq("id", id);
    await supa.from("econ_audit_log").insert({ actor_discord_id: staff.discordId, action: "tax_deleted", details: { id } });
    return NextResponse.json({ ok: true });
  }

  if (action === "adjust") {
    if (!staff.can("balances")) return noPerm();
    const memberId = String(body.memberId || "");
    const resource = String(body.resource || "");
    const raw = String(body.amount ?? "").trim();
    const negative = raw.startsWith("-");
    const parsed = parseAmount(raw.replace(/^[+-]/, ""));
    if (!UUID.test(memberId) || !isResource(resource) || parsed === null || parsed <= 0) {
      return bad("Enter an amount like 5m or -250k");
    }
    const amount = negative ? -parsed : parsed;
    if (negative) {
      const { data: bal } = await supa.from("econ_balances").select("balance").eq("member_id", memberId).eq("resource", resource).maybeSingle();
      if (Number(bal?.balance ?? 0) + amount < 0) return bad("That would take the balance below zero");
    }
    const { error } = await supa.from("econ_ledger").insert({
      member_id: memberId, resource, amount, kind: "adjustment", note: note(body.note) || "Staff adjustment", created_by: staff.discordId,
    });
    if (error) return bad("Could not save");
    await supa.from("econ_audit_log").insert({
      actor_discord_id: staff.discordId, action: "balance_adjust", target_member: memberId,
      details: { resource, amount, note: note(body.note) },
    });
    if (amount > 0) {
      const { data: mem } = await supa
        .from("econ_members")
        .select("id, nation_id, leader_name, discord_id")
        .eq("id", memberId)
        .maybeSingle();
      if (mem) {
        const code = makeDepositCode(Number(mem.nation_id), mem.id);
        void sendDepositConfirmation({
          discordId: String(mem.discord_id),
          accountId: mem.id,
          nationId: Number(mem.nation_id),
          leaderName: mem.leader_name,
          amounts: { [resource]: amount },
          depositCode: code,
        }).then((r) => {
          if (!r.ok) console.error("deposit discord notify:", r.error);
        });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // Save ONLY Locutus pending rows for unregistered nations — does not touch existing balances
  if (action === "import_pending_only") {
    if (!staff.can("import")) return noPerm();
    let csv = String(body.csv ?? "");
    const link = String(body.url ?? "").trim();
    if (link) {
      const got = await fetchSheetCsv(link);
      if (!got.ok) return bad(got.error);
      csv = got.csv;
    }
    if (!csv.trim()) return bad("Provide the Locutus sheet or link.");

    const built = await planLocutusImport(csv, "add");
    if ("error" in built) return bad(built.error);
    const pending = built.plan.pending ?? [];
    if (!pending.length) {
      return bad("No unregistered nations with resolvable IDs on this sheet. Nothing to save as pending.");
    }

    const batch = crypto.createHash("sha256").update(`pending_only\n${csv.trim()}`).digest("hex").slice(0, 24);
    const noteBase = `Locutus pending ${batch}`;
    let pendingRows = 0;
    for (const p of pending) {
      for (const [resource, amount] of Object.entries(p.deltas)) {
        if (!amount) continue;
        const { error } = await supa.from("econ_locutus_pending").upsert(
          {
            nation_id: p.nationId,
            nation_label: p.label,
            resource,
            amount,
            import_batch: batch,
            mode: "add",
            note: noteBase,
            created_by: staff.discordId,
            claimed_at: null,
            claimed_member_id: null,
          },
          { onConflict: "import_batch,nation_id,resource" }
        );
        if (error) return bad(`Pending save failed: ${error.message}`, 500);
        pendingRows += 1;
      }
    }

    await supa.from("econ_audit_log").insert({
      actor_discord_id: staff.discordId,
      action: "locutus_pending_only",
      details: {
        batch,
        pendingNations: pending.length,
        pendingRows,
        labels: pending.slice(0, 40).map((p) => p.label),
      },
    });

    return NextResponse.json({
      ok: true,
      pendingNations: pending.length,
      pendingRows,
      message: `Saved pending deposits for ${pending.length} unregistered nation(s). Existing member balances were not changed. They get credit on first login.`,
    });
  }

  if (action === "import_preview" || action === "import_apply") {
    if (!staff.can("import")) return noPerm();
    let csv = String(body.csv ?? "");
    const link = String(body.url ?? "").trim();
    if (link) {
      const got = await fetchSheetCsv(link);
      if (!got.ok) return bad(got.error);
      csv = got.csv;
    }
    const mode = body.mode === "add" ? "add" : "set";
    const result = await planImport(supa, csv, mode);
    if ("error" in result) return bad(result.error);
    const { plan } = result;

    if (action === "import_preview") {
      const pendingList = plan.pending ?? [];
      return NextResponse.json({
        ok: true,
        mode,
        rows: plan.rowCount,
        resources: plan.resources,
        matched: plan.matched.slice(0, 60),
        matchedCount: plan.matched.length,
        unmatched: plan.unmatched.slice(0, 60),
        unmatchedCount: plan.unmatched.length,
        pendingCount: pendingList.length,
        pending: pendingList.slice(0, 40).map((p: { nationId: number; label: string }) => ({
          nationId: p.nationId,
          label: p.label,
        })),
        errors: plan.errors.slice(0, 30),
      });
    }

    if (plan.matched.length === 0) return bad("Nothing to import: no changes were found.");
    const hash = crypto.createHash("sha256").update(`${mode}\n${csv.trim()}`).digest("hex");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: dup } = await supa
      .from("econ_audit_log")
      .select("id")
      .eq("action", "sheet_import")
      .gte("created_at", since)
      .contains("details", { hash })
      .limit(1);
    if (dup?.length) return bad("This exact sheet was already imported in the last 24 hours.");

    const day = new Date().toISOString().slice(0, 10);
    const entries = plan.matched.flatMap((m) =>
      Object.entries(m.deltas).map(([resource, amount]) => ({
        member_id: m.memberId,
        resource,
        amount,
        kind: mode === "add" && amount > 0 ? "deposit" : "adjustment",
        note: `Locutus sheet import ${day}`,
        created_by: staff.discordId,
      }))
    );
    for (let i = 0; i < entries.length; i += 200) {
      const { error } = await supa.from("econ_ledger").insert(entries.slice(i, i + 200));
      if (error) {
        console.error("import insert failed:", error.message);
        return bad(`Stopped part-way. ${i} entries were saved. Check the Log tab before trying again.`, 500);
      }
    }
    await supa.from("econ_audit_log").insert({
      actor_discord_id: staff.discordId,
      action: "sheet_import",
      details: { hash, mode, members: plan.matched.length, entries: entries.length, unmatched: plan.unmatched.length },
    });
    // Discord deposit confirmations (one embed per member with positive deltas)
    if (mode === "add") {
      for (const m of plan.matched) {
        const positive: Record<string, number> = {};
        for (const [k, v] of Object.entries(m.deltas)) {
          if (Number(v) > 0) positive[k] = Number(v);
        }
        if (!Object.keys(positive).length) continue;
        const { data: mem } = await supa
          .from("econ_members")
          .select("id, nation_id, leader_name, discord_id")
          .eq("id", m.memberId)
          .maybeSingle();
        if (!mem) continue;
        const code = makeDepositCode(Number(mem.nation_id), mem.id);
        const r = await sendDepositConfirmation({
          discordId: String(mem.discord_id),
          accountId: mem.id,
          nationId: Number(mem.nation_id),
          leaderName: mem.leader_name || m.label,
          amounts: positive,
          depositCode: code,
        });
        if (!r.ok) console.error("deposit discord notify:", r.error);
      }
    }
    return NextResponse.json({ ok: true, members: plan.matched.length, entries: entries.length });
  }

  if (action === "set_staff") {
    if (!staff.canManageRoles) return noPerm();
    const discordId = String(body.discordId || "");
    const role = String(body.role || "");
    if (!/^\d{5,25}$/.test(discordId) || !["head", "staff", "default"].includes(role)) return bad("Invalid request");
    if (role === "default") {
      await supa.from("econ_staff").delete().eq("discord_id", discordId);
    } else {
      const perms = Array.isArray(body.perms) ? (body.perms as unknown[]).map(String).filter((p) => (PERMS as readonly string[]).includes(p)) : [];
      const { error } = await supa.from("econ_staff").upsert(
        { discord_id: discordId, role, perms: role === "head" ? [] : perms, added_by: staff.discordId },
        { onConflict: "discord_id" }
      );
      if (error) return bad("Could not save");
    }
    await supa.from("econ_audit_log").insert({ actor_discord_id: staff.discordId, action: "staff_role_set", details: { discord_id: discordId, role, perms: body.perms ?? null } });
    return NextResponse.json({ ok: true });
  }

  if (action === "member_status") {
    if (!staff.can("members")) return noPerm();
    const memberId = String(body.memberId || "");
    const status = String(body.status || "");
    if (!UUID.test(memberId) || !["active", "suspended"].includes(status)) return bad("Invalid request");
    await supa.from("econ_members").update({ status }).eq("id", memberId);
    await supa.from("econ_audit_log").insert({ actor_discord_id: staff.discordId, action: `member_${status}`, target_member: memberId, details: { note: note(body.note) } });
    return NextResponse.json({ ok: true });
  }

  return bad("Unknown action");
}
