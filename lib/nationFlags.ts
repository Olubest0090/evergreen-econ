/**
 * Resolve Politics & War nation flag URLs (batch).
 */
import { getBankApiKey, getPnwApiKey } from "@/lib/secrets";

const DEFAULT_FLAG = "https://politicsandwar.com/img/default.jpg";

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = (await getBankApiKey()) || (await getPnwApiKey());
  if (!key) throw new Error("API key not set");
  const res = await fetch(
    `https://api.politicsandwar.com/graphql?api_key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`P&W API ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

/** Map nation_id → flag image URL */
export async function fetchNationFlags(nationIds: number[]): Promise<Map<number, string>> {
  const ids = [...new Set(nationIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const map = new Map<number, string>();
  if (!ids.length) return map;

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const data = await gql<{
        nations: { data: { id: string; flag?: string | null }[] };
      }>(
        `query($ids:[Int],$first:Int){
          nations(id:$ids, first:$first){
            data { id flag }
          }
        }`,
        { ids: chunk, first: chunk.length }
      );
      for (const n of data.nations?.data ?? []) {
        const id = Number(n.id);
        const flag = (n.flag || "").trim();
        map.set(id, flag || DEFAULT_FLAG);
      }
    } catch {
      for (const id of chunk) {
        if (!map.has(id)) map.set(id, DEFAULT_FLAG);
      }
    }
  }
  for (const id of ids) {
    if (!map.has(id)) map.set(id, DEFAULT_FLAG);
  }
  return map;
}

export { DEFAULT_FLAG };
