// Politics & War API v3 (GraphQL), read only.
export type PnwNation = {
  id: string;
  nation_name: string;
  leader_name: string;
  discord: string | null;
  num_cities: number;
  alliance_position: string | null;
};

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = process.env.PNW_API_KEY;
  if (!key) throw new Error("PNW_API_KEY is not set");
  const res = await fetch(`https://api.politicsandwar.com/graphql?api_key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`P&W API responded ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`P&W API: ${json.errors[0].message}`);
  return json.data as T;
}

/** Every nation in the alliance, including the Discord name each player set on their nation. */
export async function fetchAllianceNations(allianceId: number): Promise<PnwNation[]> {
  const data = await gql<{ nations: { data: PnwNation[] } }>(
    `query($a:[Int]){ nations(alliance_id:$a, first:500){ data { id nation_name leader_name discord num_cities alliance_position } } }`,
    { a: [allianceId] }
  );
  return data.nations.data;
}

export async function fetchCities(nationId: number): Promise<number | null> {
  try {
    const data = await gql<{ nations: { data: { num_cities: number }[] } }>(
      `query($id:[Int]){ nations(id:$id, first:1){ data { num_cities } } }`,
      { id: [nationId] }
    );
    return data.nations.data[0]?.num_cities ?? null;
  } catch {
    return null;
  }
}
