import { db } from "@/lib/supabase";

/** Atomically claim Locutus rows for a nation before login completes. */
export async function claimLocutusPendingForNation(
  nationId: number,
  memberId: string
): Promise<{ claimed: number; error?: string }> {
  if (!Number.isSafeInteger(nationId) || nationId <= 0 || !memberId) {
    return { claimed: 0, error: "Invalid nation or member ID." };
  }

  const { data, error } = await db().rpc(
    "econ_claim_locutus_pending_for_nation",
    { p_nation_id: nationId, p_member_id: memberId }
  );

  if (error) {
    console.error("Locutus pending claim RPC failed:", error.message);
    return { claimed: 0, error: error.message };
  }

  const claimed = Number(data ?? 0);
  if (!Number.isFinite(claimed) || claimed < 0) {
    return { claimed: 0, error: "Invalid claim count returned by database." };
  }
  return { claimed };
}
