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
  sent?: string;
}

async function sendDiscordAlert(type: 'deposit' | 'withdrawal' | 'grant', title: string, description: string, color: number) {
  let webhookUrl = process.env.DISCORD_DEPOSIT_WEBHOOK_URL;
  if (type === 'withdrawal') webhookUrl = process.env.DISCORD_WITHDRAWAL_WEBHOOK_URL;
  if (type === 'grant') webhookUrl = process.env.DISCORD_GRANT_WEBHOOK_URL;

  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{ title, description, color, timestamp: new Date().toISOString() }],
      }),
    });
  } catch (error) {
    console.error("Failed to send Discord notification:", error);
  }
}

async function fetchBankRecs(apiKey: string): Promise<BankRec[]> {
  const fields = `
    id sid date rtype sender_type stype initiator_id
    money food coal oil uranium iron bauxite lead
    gasoline munitions steel aluminum note sent
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

  // --- 1. MAIN BANK SYNC ---
  const mainApiKey = process.env.PNW_API_KEY || process.env.BANK_API_KEY;
  if (!mainApiKey) {
    result.main.errors.push("No BANK_API_KEY / PNW_API_KEY for main bankrecs");
  } else {
    try {
      const recs = await fetchBankRecs(mainApiKey);
      result.main.scanned = recs.length;
      console.log(`[Main Bank] Fetched ${recs.length} records.`);

      for (const rec of recs) {
        console.log(`[Main] ID: ${rec.id}, Money: ${rec.money}, Note: ${rec.note}`);

        if (rec.money > 0) {
          // TODO: Add database crediting & duplicate check here
          result.main.credited++;

          await sendDiscordAlert(
            'deposit',
            '📥 Main Bank Deposit Credited',
            `**Record ID:** ${rec.id}\n**Amount:** $${rec.money.toLocaleString()}\n**Note:** ${rec.note || 'None'}`,
            3066993
          );
        }
      }
    } catch (e) {
      result.main.errors.push(e instanceof Error ? e.message : "bankrecs failed");
    }
  }

  // --- 2. OFFSHORE BANK SYNC ---
  const offshoreApiKey = process.env.OFFSHORE_API_KEY || mainApiKey;
  if (!offshoreApiKey) {
    result.offshore.errors.push("No OFFSHORE_API_KEY for offshore bankrecs");
  } else {
    try {
      const recs = await fetchBankRecs(offshoreApiKey);
      result.offshore.scanned = recs.length;
      console.log(`[Offshore Bank] Fetched ${recs.length} records.`);

      for (const rec of recs) {
        console.log(`[Offshore] ID: ${rec.id}, Money: ${rec.money}, Note: ${rec.note}`);

        if (rec.money > 0) {
          // TODO: Add database crediting & duplicate check here
          result.offshore.credited++;

          await sendDiscordAlert(
            'deposit',
            '📥 Offshore Bank Deposit Credited',
            `**Record ID:** ${rec.id}\n**Amount:** $${rec.money.toLocaleString()}\n**Note:** ${rec.note || 'None'}`,
            3066993
          );
        }
      }
    } catch (e) {
      result.offshore.errors.push(e instanceof Error ? e.message : "bankrecs failed");
    }
  }

  return result;
}
