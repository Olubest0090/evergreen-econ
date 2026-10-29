import { db } from "@/lib/supabase";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db().from("econ_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown): Promise<{ error?: string }> {
  const { error } = await db()
    .from("econ_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return error ? { error: error.message } : {};
}

/** Offshore is an ALLIANCE. P&W still pays a nation; banker_nation_id is optional override. */
export type OffshoreConfig = {
  offshore_alliance_id: number;
  /** Nation in offshore that receives bankWithdraw (optional; auto-pick if empty). */
  banker_nation_id?: number;
  label?: string;
  /** Main alliance bank to empty when sending everything. */
  source_alliance_id?: number;
  updated_at?: string;
};
