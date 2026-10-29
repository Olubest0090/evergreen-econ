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

export type PnwHolding = PnwNation & { resources: Record<string, number> | null };

const RES = ["money", "food", "coal", "oil", "uranium", "lead", "iron", "bauxite", "gasoline", "munitions", "steel", "aluminum"];

/** Alliance nations with what each one is holding. Resources are null if the API won't show them. */
export async function fetchAllianceHoldings(allianceId: number): Promise<PnwHolding[]> {
  try {
    const data = await gql<{ nations: { data: (PnwNation & Record<string, number | null>)[] } }>(
      `query($a:[Int]){ nations(alliance_id:$a, first:500){ data { id nation_name leader_name discord num_cities alliance_position ${RES.join(" ")} } } }`,
      { a: [allianceId] }
    );
    return data.nations.data.map((n) => {
      const resources: Record<string, number> = {};
      let known = false;
      for (const k of RES) {
        const v = n[k];
        if (typeof v === "number") { resources[k] = v; known = true; }
      }
      return { ...n, resources: known ? resources : null };
    });
  } catch {
    const plain = await fetchAllianceNations(allianceId);
    return plain.map((n) => ({ ...n, resources: null }));
  }
}
