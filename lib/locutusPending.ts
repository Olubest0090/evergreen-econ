import { db } from "@/lib/supabase";
import { RESOURCES } from "@/lib/resources";

/** Credit Locutus pending rows for a nation after they register. */
export async function claimLocutusPendingForNation(
  nationId: number,
  memberId: string
): Promise<{ claimed: number; error?: string }> {
  const supa = db();
  const { data: rows, error } = await supa
    .from("econ_locutus_pending")
    .select("id, resource, amount, note, import_batch")
    .eq("nation_id", nationId)
    .is("claimed_at", null);

  if (error) return { claimed: 0, error: error.message };
  if (!rows?.length) return { claimed: 0 };

  let claimed = 0;
  for (const row of rows) {
    const resource = String(row.resource);
    if (!(RESOURCES as readonly string[]).includes(resource)) continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;

    const { error: ledErr } = await supa.from("econ_ledger").insert({
      member_id: memberId,
      resource,
      amount,
      kind: "deposit",
      note: row.note || `Locutus pending ${row.import_batch}`,
      created_by: "system:locutus_pending",
    });
    if (ledErr) {
      console.error("locutus claim ledger:", ledErr.message);
      continue;
    }
    await supa
      .from("econ_locutus_pending")
      .update({
        claimed_at: new Date().toISOString(),
        claimed_member_id: memberId,
      })
      .eq("id", row.id);
    claimed += 1;
  }
  return { claimed };
}
