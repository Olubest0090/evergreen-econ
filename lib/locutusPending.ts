import { db } from "@/lib/supabase";

/** Claim Locutus pending rows for a nation (RPC first, then app fallback). */
export async function claimLocutusPendingForNation(
  nationId: number,
  memberId: string
): Promise<{ claimed: number; error?: string }> {
  if (!Number.isSafeInteger(nationId) || nationId <= 0 || !memberId) {
    return { claimed: 0 };
  }

  const { data, error } = await db().rpc("econ_claim_locutus_pending_for_nation", {
    p_nation_id: nationId,
    p_member_id: memberId,
  });

  if (!error) {
    const claimed = Number(data ?? 0);
    return { claimed: Number.isFinite(claimed) && claimed > 0 ? claimed : 0 };
  }

  console.error("Locutus pending RPC failed, using fallback:", error.message);
  return claimLocutusPendingFallback(nationId, memberId);
}

async function claimLocutusPendingFallback(
  nationId: number,
  memberId: string
): Promise<{ claimed: number; error?: string }> {
  const supa = db();
  const { data: rows, error } = await supa
    .from("econ_locutus_pending")
    .select("id, resource, amount, note, created_by, import_batch")
    .eq("nation_id", nationId)
    .is("claimed_at", null);

  if (error) {
    console.error("Locutus pending select failed:", error.message);
    return { claimed: 0, error: error.message };
  }
  if (!rows?.length) return { claimed: 0 };

  let claimed = 0;
  for (const r of rows) {
    const amount = Number(r.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      await markClaimed(supa, r, nationId, memberId);
      continue;
    }
    const { error: ledErr } = await supa.from("econ_ledger").insert({
      member_id: memberId,
      resource: r.resource,
      amount,
      kind: "deposit",
      note: r.note || `Locutus pending ${r.import_batch || ""}`.trim(),
      created_by: r.created_by || "system",
    });
    if (ledErr) {
      console.error("Locutus pending ledger failed:", ledErr.message);
      return { claimed, error: ledErr.message };
    }
    await markClaimed(supa, r, nationId, memberId);
    claimed += 1;
  }
  return { claimed };
}

async function markClaimed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supa: any,
  r: { id?: string; resource?: string },
  nationId: number,
  memberId: string
) {
  const patch = {
    claimed_at: new Date().toISOString(),
    claimed_member_id: memberId,
  };
  if (r.id) {
    await supa.from("econ_locutus_pending").update(patch).eq("id", r.id);
  } else {
    await supa
      .from("econ_locutus_pending")
      .update(patch)
      .eq("nation_id", nationId)
      .eq("resource", r.resource)
      .is("claimed_at", null);
  }
}

/** Staff: claim pending for every registered member that still has rows. */
export async function claimAllLocutusPending(): Promise<{
  members: number;
  claimed: number;
  errors: string[];
}> {
  const supa = db();
  const { data: pending, error } = await supa
    .from("econ_locutus_pending")
    .select("nation_id")
    .is("claimed_at", null);
  if (error) return { members: 0, claimed: 0, errors: [error.message] };

  const nationIds = [
    ...new Set((pending ?? []).map((p) => Number(p.nation_id)).filter((n) => n > 0)),
  ];
  if (!nationIds.length) return { members: 0, claimed: 0, errors: [] };

  const { data: members } = await supa
    .from("econ_members")
    .select("id, nation_id")
    .in("nation_id", nationIds)
    .eq("status", "active");

  let claimed = 0;
  const errors: string[] = [];
  for (const m of members ?? []) {
    const r = await claimLocutusPendingForNation(Number(m.nation_id), m.id);
    claimed += r.claimed;
    if (r.error) errors.push(`#${m.nation_id}: ${r.error}`);
  }
  return { members: (members ?? []).length, claimed, errors };
}
