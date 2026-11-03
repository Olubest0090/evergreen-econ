import crypto from "crypto";
import { db } from "@/lib/supabase";
import { parseNumber, readSheet } from "@/lib/sheet";

export type LocutusPlan = {
  matched: { memberId: string; nationId: number; label: string; deltas: Record<string, number> }[];
  /** Unregistered but has nation ID → will be saved as pending on apply */
  pending: { nationId: number; label: string; deltas: Record<string, number> }[];
  /** No nation ID or unusable row */
  unmatched: string[];
  errors: string[];
  resources: string[];
  rowCount: number;
};

function batchId(csv: string): string {
  return crypto.createHash("sha256").update(csv).digest("hex").slice(0, 24);
}

/** Preview: registered → matched; unregistered with nation ID → pending. */
export async function planLocutusImport(
  csv: string,
  mode: string
): Promise<{ plan: LocutusPlan } | { error: string }> {
  const parsed = readSheet(csv);
  if (!parsed.ok) return { error: parsed.error };
  const { sheet } = parsed;
  const supa = db();

  const { data: members } = await supa
    .from("econ_members")
    .select("id, nation_id, nation_name, leader_name")
    .limit(3000);

  const byId = new Map<number, { id: string; label: string }>();
  const byName = new Map<string, { id: string; label: string } | null>();
  for (const m of members ?? []) {
    const label = `${m.leader_name ?? m.nation_name} (#${m.nation_id})`;
    byId.set(Number(m.nation_id), { id: m.id, label });
    for (const n of [m.nation_name, m.leader_name]) {
      const key = String(n ?? "").trim().toLowerCase();
      if (!key) continue;
      byName.set(
        key,
        byName.has(key) && byName.get(key)?.id !== m.id ? null : { id: m.id, label }
      );
    }
  }

  const { data: bal } = await supa
    .from("econ_balances")
    .select("member_id, resource, balance")
    .limit(20000);
  const current = new Map<string, number>();
  for (const b of bal ?? []) {
    current.set(`${b.member_id}|${b.resource}`, Number(b.balance));
  }

  const plan: LocutusPlan = {
    matched: [],
    pending: [],
    unmatched: [],
    errors: [],
    resources: sheet.resCols.map((c) => c.resource),
    rowCount: sheet.rows.length,
  };
  const seenMember = new Set<string>();
  const seenNation = new Set<number>();

  sheet.rows.forEach((row, i) => {
    const idText = sheet.idCol >= 0 ? (row[sheet.idCol] ?? "").replace(/\D/g, "") : "";
    const nameText = sheet.nameCol >= 0 ? (row[sheet.nameCol] ?? "").trim() : "";
    const nationId = idText ? Number(idText) : 0;
    const who = idText ? `#${idText}` : nameText || `row ${i + 2}`;

    const hit = idText
      ? byId.get(nationId)
      : byName.get(nameText.toLowerCase());

    const deltas: Record<string, number> = {};
    for (const { col, resource } of sheet.resCols) {
      const v = parseNumber(row[col] ?? "");
      if (v === null) continue;
      if (Number.isNaN(v)) {
        plan.errors.push(`${who}: "${row[col]}" is not a number (${resource}).`);
        continue;
      }
      if (hit) {
        const delta =
          mode === "add" ? v : v - (current.get(`${hit.id}|${resource}`) ?? 0);
        if (Math.abs(delta) >= 0.005) deltas[resource] = Math.round(delta * 100) / 100;
      } else {
        // pending: store sheet values as add amounts (match mode still uses sheet numbers)
        if (Math.abs(v) >= 0.005) deltas[resource] = Math.round(v * 100) / 100;
      }
    }
    if (!Object.keys(deltas).length) return;

    if (hit) {
      if (seenMember.has(hit.id)) {
        plan.errors.push(`${hit.label} appears more than once. Only the first row was used.`);
        return;
      }
      seenMember.add(hit.id);
      plan.matched.push({
        memberId: hit.id,
        nationId: nationId || 0,
        label: hit.label,
        deltas,
      });
      return;
    }

    // Unregistered: only if we have a real nation ID
    if (nationId > 0) {
      if (seenNation.has(nationId)) {
        plan.errors.push(`Nation #${nationId} appears more than once. Only the first row was used.`);
        return;
      }
      seenNation.add(nationId);
      plan.pending.push({
        nationId,
        label: nameText || `#${nationId}`,
        deltas,
      });
      return;
    }

    plan.unmatched.push(who);
  });

  return { plan };
}

/** Apply: credit matched members + save pending for unregistered nation IDs. */
export async function applyLocutusImport(opts: {
  csv: string;
  mode: string;
  staffDiscordId: string;
}): Promise<
  | {
      ok: true;
      members: number;
      entries: number;
      pendingNations: number;
      pendingRows: number;
      batch: string;
    }
  | { error: string }
> {
  const built = await planLocutusImport(opts.csv, opts.mode);
  if ("error" in built) return { error: built.error };
  const { plan } = built;
  const batch = batchId(opts.csv);
  const supa = db();
  const noteBase = `Locutus import ${batch}`;

  let entries = 0;
  for (const m of plan.matched) {
    for (const [resource, amount] of Object.entries(m.deltas)) {
      if (!amount) continue;
      const kind =
        opts.mode === "add" && amount > 0 ? "deposit" : "adjustment";
      const { error } = await supa.from("econ_ledger").insert({
        member_id: m.memberId,
        resource,
        amount,
        kind,
        note: noteBase,
        created_by: opts.staffDiscordId,
      });
      if (error) return { error: `Ledger: ${error.message}` };
      entries += 1;
    }
  }

  let pendingRows = 0;
  for (const p of plan.pending) {
    for (const [resource, amount] of Object.entries(p.deltas)) {
      if (!amount) continue;
      const { error } = await supa.from("econ_locutus_pending").upsert(
        {
          nation_id: p.nationId,
          nation_label: p.label,
          resource,
          amount,
          import_batch: batch,
          mode: opts.mode === "add" ? "add" : "match",
          note: noteBase,
          created_by: opts.staffDiscordId,
          claimed_at: null,
          claimed_member_id: null,
        },
        { onConflict: "import_batch,nation_id,resource" }
      );
      if (error) return { error: `Pending: ${error.message}` };
      pendingRows += 1;
    }
  }

  await supa.from("econ_audit_log").insert({
    actor_discord_id: opts.staffDiscordId,
    action: "locutus_import",
    details: {
      batch,
      mode: opts.mode,
      members: plan.matched.length,
      entries,
      pendingNations: plan.pending.length,
      pendingRows,
      unmatched: plan.unmatched.slice(0, 50),
    },
  });

  return {
    ok: true,
    members: plan.matched.length,
    entries,
    pendingNations: plan.pending.length,
    pendingRows,
    batch,
  };
}
