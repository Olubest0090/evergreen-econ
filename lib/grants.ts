/**
 * Phase 1 grants:
 * - Convert negative deposit balances → grant (zero deposit, track grant)
 * - List grants (kept even after leave via nation_id + names)
 * - Collect / waive on leave (gov decides how much)
 */
import { db } from "@/lib/supabase";
import { RESOURCES } from "@/lib/resources";

export type GrantType =
  | "converted_negative"
  | "city"
  | "infra"
  | "land"
  | "project"
  | "other";

export type GrantStatus = "active" | "collected" | "waived" | "partial";

export type GrantRow = {
  id: string;
  member_id: string | null;
  nation_id: number;
  leader_name: string | null;
  nation_name: string | null;
  discord_id: string | null;
  grant_type: string;
  amounts: Record<string, number>;
  meta: Record<string, unknown>;
  status: string;
  note: string | null;
  issued_at: string;
  issued_by: string | null;
  approved_by: string | null;
  collected_at: string | null;
  collected_by: string | null;
  collected_amounts: Record<string, number> | null;
  collect_note: string | null;
};

function cleanAmounts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Math.round(Number(v) * 100) / 100;
    if (Number.isFinite(n) && n !== 0) out[k] = n;
  }
  return out;
}

function absNegatives(balances: { resource: string; balance: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of balances) {
    const n = Number(b.balance);
    if (Number.isFinite(n) && n < -0.005) {
      out[b.resource] = Math.round(Math.abs(n) * 100) / 100;
    }
  }
  return out;
}

/** Preview: members with any negative deposit resource. */
export async function previewConvertNegatives(): Promise<{
  members: {
    memberId: string;
    nationId: number;
    label: string;
    negatives: Record<string, number>;
  }[];
  totals: Record<string, number>;
}> {
  const supa = db();
  const { data: neg, error } = await supa
    .from("econ_balances")
    .select("member_id, resource, balance")
    .lt("balance", -0.005)
    .limit(20000);
  if (error) throw new Error(error.message);

  const byMember = new Map<string, { resource: string; balance: number }[]>();
  for (const row of neg ?? []) {
    const list = byMember.get(row.member_id) ?? [];
    list.push({ resource: row.resource, balance: Number(row.balance) });
    byMember.set(row.member_id, list);
  }

  if (!byMember.size) return { members: [], totals: {} };

  const ids = [...byMember.keys()];
  const { data: mems } = await supa
    .from("econ_members")
    .select("id, nation_id, leader_name, nation_name, discord_id")
    .in("id", ids);

  const members: {
    memberId: string;
    nationId: number;
    label: string;
    negatives: Record<string, number>;
  }[] = [];
  const totals: Record<string, number> = {};

  for (const m of mems ?? []) {
    const negatives = absNegatives(byMember.get(m.id) ?? []);
    if (!Object.keys(negatives).length) continue;
    members.push({
      memberId: m.id,
      nationId: Number(m.nation_id),
      label: `${m.leader_name || m.nation_name || "Member"} (#${m.nation_id})`,
      negatives,
    });
    for (const [k, v] of Object.entries(negatives)) {
      totals[k] = Math.round(((totals[k] ?? 0) + v) * 100) / 100;
    }
  }

  members.sort((a, b) => a.label.localeCompare(b.label));
  return { members, totals };
}

/**
 * Convert negatives → grant:
 * 1) ledger credit so deposit hits 0 on those resources
 * 2) insert econ_grants row (active)
 * Idempotent-ish: skips if member has no current negatives.
 */
export async function applyConvertNegatives(opts: {
  staffDiscordId: string;
  note?: string;
}): Promise<{ converted: number; grants: string[]; errors: string[] }> {
  const preview = await previewConvertNegatives();
  const supa = db();
  const grants: string[] = [];
  const errors: string[] = [];
  let converted = 0;

  for (const row of preview.members) {
    const { data: mem } = await supa
      .from("econ_members")
      .select("id, nation_id, leader_name, nation_name, discord_id")
      .eq("id", row.memberId)
      .maybeSingle();
    if (!mem) {
      errors.push(`${row.label}: member missing`);
      continue;
    }

    // Re-read balances to avoid stale double convert
    const { data: bals } = await supa
      .from("econ_balances")
      .select("resource, balance")
      .eq("member_id", row.memberId);
    const negatives = absNegatives(
      (bals ?? []).map((b) => ({ resource: b.resource, balance: Number(b.balance) }))
    );
    if (!Object.keys(negatives).length) continue;

    // Zero deposit: positive ledger entries
    for (const [resource, amount] of Object.entries(negatives)) {
      const { error: ledErr } = await supa.from("econ_ledger").insert({
        member_id: row.memberId,
        resource,
        amount,
        kind: "adjustment",
        note: "Converted negative deposit to grant",
        created_by: opts.staffDiscordId,
      });
      if (ledErr) {
        errors.push(`${row.label} ${resource}: ${ledErr.message}`);
        continue;
      }
    }

    const { data: g, error: gErr } = await supa
      .from("econ_grants")
      .insert({
        member_id: mem.id,
        nation_id: Number(mem.nation_id),
        leader_name: mem.leader_name,
        nation_name: mem.nation_name,
        discord_id: mem.discord_id,
        grant_type: "converted_negative",
        amounts: negatives,
        meta: { source: "negative_deposit_conversion" },
        status: "active",
        note: opts.note || "Negative deposit shifted to grant (not collected while in AA)",
        issued_by: opts.staffDiscordId,
        approved_by: opts.staffDiscordId,
      })
      .select("id")
      .maybeSingle();

    if (gErr) {
      errors.push(`${row.label} grant row: ${gErr.message}`);
      continue;
    }
    if (g?.id) grants.push(g.id);
    converted += 1;
  }

  await supa.from("econ_audit_log").insert({
    actor_discord_id: opts.staffDiscordId,
    action: "grants_convert_negatives",
    details: {
      converted,
      grantIds: grants,
      totals: preview.totals,
      errors,
    },
  });

  return { converted, grants, errors };
}

export async function listGrants(opts?: {
  status?: string;
  nationId?: number;
  memberId?: string;
  limit?: number;
}): Promise<GrantRow[]> {
  const supa = db();
  let q = supa
    .from("econ_grants")
    .select("*")
    .order("issued_at", { ascending: false })
    .limit(opts?.limit ?? 200);
  if (opts?.status) q = q.eq("status", opts.status);
  if (opts?.nationId) q = q.eq("nation_id", opts.nationId);
  if (opts?.memberId) q = q.eq("member_id", opts.memberId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    ...r,
    nation_id: Number(r.nation_id),
    amounts: cleanAmounts(r.amounts),
    meta: (r.meta && typeof r.meta === "object" ? r.meta : {}) as Record<string, unknown>,
    collected_amounts: r.collected_amounts ? cleanAmounts(r.collected_amounts) : null,
  }));
}

/** Active grant totals per nation (for gov + member views). */
export async function activeGrantTotalsByNation(
  nationIds?: number[]
): Promise<Map<number, Record<string, number>>> {
  const supa = db();
  let q = supa.from("econ_grants").select("nation_id, amounts, status").eq("status", "active");
  if (nationIds?.length) q = q.in("nation_id", nationIds);
  const { data } = await q.limit(5000);
  const map = new Map<number, Record<string, number>>();
  for (const r of data ?? []) {
    const nid = Number(r.nation_id);
    const cur = map.get(nid) ?? {};
    for (const [k, v] of Object.entries(cleanAmounts(r.amounts))) {
      cur[k] = Math.round(((cur[k] ?? 0) + v) * 100) / 100;
    }
    map.set(nid, cur);
  }
  return map;
}

/**
 * Collect (or waive) a grant. Gov chooses amounts.
 * collected_amounts empty + status waived = full waive.
 * collected_amounts < full + status partial = partial collect.
 */
export async function collectGrant(opts: {
  grantId: string;
  staffDiscordId: string;
  /** If omitted, collect full remaining amounts */
  amounts?: Record<string, number> | null;
  waive?: boolean;
  note?: string;
}): Promise<{ ok: true } | { error: string }> {
  const supa = db();
  const { data: g, error } = await supa
    .from("econ_grants")
    .select("*")
    .eq("id", opts.grantId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!g) return { error: "Grant not found" };
  if (g.status === "collected" || g.status === "waived") {
    return { error: `Grant already ${g.status}` };
  }

  const remaining = cleanAmounts(g.amounts);
  if (opts.waive) {
    const { error: uErr } = await supa
      .from("econ_grants")
      .update({
        status: "waived",
        collected_at: new Date().toISOString(),
        collected_by: opts.staffDiscordId,
        collected_amounts: {},
        collect_note: opts.note || "Waived by gov",
        approved_by: g.approved_by || opts.staffDiscordId,
      })
      .eq("id", opts.grantId);
    if (uErr) return { error: uErr.message };
  } else {
    const collect = opts.amounts ? cleanAmounts(opts.amounts) : { ...remaining };
    // Clamp to remaining
    for (const k of Object.keys(collect)) {
      if (!remaining[k]) delete collect[k];
      else collect[k] = Math.min(collect[k], remaining[k]);
    }
    if (!Object.keys(collect).length) return { error: "Nothing to collect" };

    const still: Record<string, number> = {};
    for (const [k, v] of Object.entries(remaining)) {
      const left = Math.round((v - (collect[k] ?? 0)) * 100) / 100;
      if (left > 0.005) still[k] = left;
    }
    const status = Object.keys(still).length ? "partial" : "collected";

    const { error: uErr } = await supa
      .from("econ_grants")
      .update({
        status,
        amounts: status === "partial" ? still : remaining,
        collected_at: new Date().toISOString(),
        collected_by: opts.staffDiscordId,
        collected_amounts: collect,
        collect_note: opts.note || (status === "partial" ? "Partial collection" : "Collected on leave"),
        approved_by: g.approved_by || opts.staffDiscordId,
        meta: {
          ...(typeof g.meta === "object" && g.meta ? g.meta : {}),
          last_collect: collect,
          previous_amounts: remaining,
        },
      })
      .eq("id", opts.grantId);
    if (uErr) return { error: uErr.message };
  }

  await supa.from("econ_audit_log").insert({
    actor_discord_id: opts.staffDiscordId,
    action: opts.waive ? "grant_waived" : "grant_collected",
    details: {
      grantId: opts.grantId,
      nation_id: g.nation_id,
      note: opts.note ?? null,
    },
  });

  return { ok: true };
}

/** Issue a typed grant record (phase 1 tracking only — send still manual / later phase 2). */
export async function issueGrant(opts: {
  memberId?: string;
  nationId: number;
  leaderName?: string;
  nationName?: string;
  discordId?: string;
  grantType: GrantType;
  amounts: Record<string, number>;
  meta?: Record<string, unknown>;
  note?: string;
  staffDiscordId: string;
}): Promise<{ id: string } | { error: string }> {
  const amounts = cleanAmounts(opts.amounts);
  if (!Object.keys(amounts).length) return { error: "Enter at least one resource amount" };
  if (!opts.nationId) return { error: "Nation id required" };

  const supa = db();
  let memberId = opts.memberId ?? null;
  let leader = opts.leaderName ?? null;
  let nationName = opts.nationName ?? null;
  let discordId = opts.discordId ?? null;

  if (memberId || opts.nationId) {
    const q = memberId
      ? supa.from("econ_members").select("id, nation_id, leader_name, nation_name, discord_id").eq("id", memberId)
      : supa.from("econ_members").select("id, nation_id, leader_name, nation_name, discord_id").eq("nation_id", opts.nationId);
    const { data: mem } = await q.maybeSingle();
    if (mem) {
      memberId = mem.id;
      leader = leader || mem.leader_name;
      nationName = nationName || mem.nation_name;
      discordId = discordId || mem.discord_id;
    }
  }

  const { data, error } = await supa
    .from("econ_grants")
    .insert({
      member_id: memberId,
      nation_id: opts.nationId,
      leader_name: leader,
      nation_name: nationName,
      discord_id: discordId,
      grant_type: opts.grantType,
      amounts,
      meta: opts.meta ?? {},
      status: "active",
      note: opts.note ?? null,
      issued_by: opts.staffDiscordId,
      approved_by: opts.staffDiscordId,
    })
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data?.id) return { error: "Insert failed" };

  await supa.from("econ_audit_log").insert({
    actor_discord_id: opts.staffDiscordId,
    action: "grant_issued",
    details: {
      grantId: data.id,
      grantType: opts.grantType,
      nation_id: opts.nationId,
      amounts,
    },
  });

  return { id: data.id };
}

export function formatGrantType(t: string): string {
  const map: Record<string, string> = {
    converted_negative: "Converted negative deposit",
    city: "City grant",
    infra: "Infra grant",
    land: "Land grant",
    project: "Project grant",
    other: "Other grant",
  };
  return map[t] || t;
}
