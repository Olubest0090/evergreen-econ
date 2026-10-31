import { db } from "@/lib/supabase";
import { getSetting } from "@/lib/settings";

interface BankRec {
  id: number;
  sid: number;
  date: string;
  rtype?: number;
  sender_type?: number;
  stype?: number;
  initiator_id?: number;
  money: number;
  food: number;
  coal: number;
  oil: number;
  uranium: number;
  iron: number;
  bauxite: number;
  lead: number;
  gasoline: number;
  munitions: number;
  steel: number;
  aluminum: number;
  note: string;
}

async function fetchBankRecs(apiKey: string): Promise<BankRec[]> {
  // Updated fields matching Politics & War GraphQL schema suggestions
  const fields = `
    id sid date rtype sender_type stype
    money food coal oil uranium iron bauxite lead
    gasoline munitions steel aluminum note
  `;
  
  const queries = [
    `query { bankrecs(first:100, orderBy:{column:ID, order:DESC}){ data { ${fields} } } }`,
    `query { bankrecs(first:100){ data { ${fields} } } }`,
  ];

  let lastErr = "bankrecs failed";
  for (const query of queries) {
    try {
      const res = await fetch("https://api.politicsandwar.com/graphql?api_key=" + apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        lastErr = `P&W bankrecs HTTP ${res.status}`;
        continue;
      }
      const json = await res.json();
      if (json.errors && json.errors.length > 0) {
        lastErr = json.errors.map((e: { message: string }) => e.message).join(", ");
        continue;
      }
      return (json?.data?.bankrecs?.data ?? []) as BankRec[];
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "bankrecs failed";
    }
  }
  throw new Error(lastErr);
}

export async function syncBankDeposits() {
  const result = {
    main: { scanned: 0, credited: 0, skipped: 0, errors: [] as string[] },
    offshore: { scanned: 0, credited: 0, skipped: 0, errors: [] as string[] },
  };

  const mainApiKey = process.env.PNW_API_KEY || process.env.BANK_API_KEY;
  if (!mainApiKey) {
    result.main.errors.push("No BANK_API_KEY / PNW_API_KEY for main bankrecs");
  } else {
    try {
      const recs = await fetchBankRecs(mainApiKey);
      result.main.scanned = recs.length;
    } catch (e) {
      result.main.errors.push(e instanceof Error ? e.message : "bankrecs failed");
    }
  }

  const offshoreApiKey = process.env.OFFSHORE_API_KEY || mainApiKey;
  if (!offshoreApiKey) {
    result.offshore.errors.push("No OFFSHORE_API_KEY for offshore bankrecs");
  } else {
    try {
      const recs = await fetchBankRecs(offshoreApiKey);
      result.offshore.scanned = recs.length;
    } catch (e) {
      result.offshore.errors.push(e instanceof Error ? e.message : "bankrecs failed");
    }
  }

  return result;
}
