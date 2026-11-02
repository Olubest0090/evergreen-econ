// Politics & War API v3 (GraphQL), read only.
import { getPnwApiKey } from "@/lib/secrets";
export type PnwNation = {
  id: string;
  nation_name: string;
  leader_name: string;
  discord: string | null;
  num_cities: number;
  alliance_position: string | null;
};

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = await getPnwApiKey();
  if (!key) throw new Error("PNW_API_KEY is not set (site secrets or Vercel env)");
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

export type PnwMarketPrices = {
  date: string | null;
  prices: Record<string, number>;
};

/**
 * Gets the latest published daily average market prices from P&W.
 */
export async function fetchLatestMarketPrices(): Promise<PnwMarketPrices> {
  const data = await gql<{
    tradeprices: {
      data: (Record<string, number | string | null> & { date?: string | null })[];
    };
  }>(
    `query {
      tradeprices(first: 1, page: 1) {
        data {
          date food coal oil uranium lead iron bauxite
          gasoline munitions steel aluminum
        }
      }
    }`,
    {}
  );

  const latest = data.tradeprices?.data?.[0];
  if (!latest) throw new Error("P&W did not return market prices");

  const prices: Record<string, number> = { money: 1 };

  for (const resource of RES) {
    if (resource === "money") continue;

    const price = Number(latest[resource]);

    if (Number.isFinite(price) && price >= 0) {
      prices[resource] = price;
    }
  }

  return {
    date: latest.date ? String(latest.date) : null,
    prices,
  };
}

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
