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
