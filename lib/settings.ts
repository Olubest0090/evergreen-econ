import { db } from "@/lib/supabase";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db().from("econ_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
