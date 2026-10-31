import { db } from "@/lib/supabase";
import { getSetting } from "@/lib/settings";
import { getBankApiKey, getOffshoreApiKey } from "@/lib/secrets";
import { RESOURCES, type Resource } from "@/lib/resources";

type BankRec = {
  id: string | number;
  sid: string | number | null;
  rid: string | number | null;
  date: string;
  stype: number | null;
  rtype: number | null;
  money?: number | null;
  food?: number | null;
  coal?: number | null;
  oil?: number | null;
  uranium?: number | null;
  iron?: number | null;
  bauxite?: number | null;
  lead?: number | null;
  gasoline?: number | null;
  munitions?: number | null;
  steel?: number | null;
  aluminum?: number | null;
  note?: string | null;
};

type SyncStats = {
  scanned: number;
  credited: number;
  skipped: number;
  unmatched: number;
  errors: string[];
};

const emptyStats = (): SyncStats => ({
  scanned: 0,
  credited: 0,
  skipped: 0,
  unmatched: 0,
  errors: [],
});

async function fetchBankRecs(apiKey: string, allianceId: number): Promise<BankRec[]> {
  const fields = `
    id sid rid date stype rtype
    money food coal oil uranium iron bauxite lead
    gasoline munitions steel aluminum note
  `;

  const all: BankRec[] = [];
  let page = 1;

  // P&W bankrecs exposes the records for the last 14 days.
  // Fetch all pages, filtering to nation -> alliance deposits for this bank.
  while (page <= 20) {
    const query = `query {
      bankrecs(
        first: 100,
        page: ${page},
        rid: [${allianceId}],
        rtype: [2],
        stype: [1],
        orderBy: [{ column: ID, order: DESC }]
      ) {
        data { ${fields} }
        paginatorInfo { hasMorePages }
      }
    }`;

    const response = await fetch(
      "https://api.politicsandwar.com/graphql?api_key=" + encodeURIComponent(apiKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error(`P&W bankrecs HTTP ${response.status}`);
    }

    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(
        json.errors.map((item: { message: string }) => item.message).join("; ")
      );
    }

    const pageData = json?.data?.bankrecs;
    if (!pageData) {
      throw new Error("P&W returned no bankrecs data. Check the API key and bank access.");
    }

    const rows = (pageData.data ?? []) as BankRec[];
    all.push(...rows);

    if (!pageData.paginatorInfo?.hasMorePages || rows.length === 0) break;
    page += 1;
  }

  if (page > 20) {
    console.warn("Bank sync reached its 2,000-record page safety limit.");
  }

  return all;
}

function getPositiveAmounts(rec: BankRec): Partial<Record<Resource, number>> {
  const amounts: Partial<Record<Resource, number>> = {};

  for (const resource of RESOURCES) {
    const amount = Number(rec[resource] ?? 0);
    if (Number.isFinite(amount) && amount > 0) {
      amounts[resource] = Math.round(amount * 100) / 100;
    }
  }

  return amounts;
}

async function notifyDeposit(
  scope: "main" | "offshore",
  memberLabel: string,
  nationId: number,
  recordId: number,
  amounts: Partial<Record<Resource, number>>,
  note: string | null | undefined
) {
  const webhook = process.env.DISCORD_DEPOSIT_WEBHOOK_URL;
  if (!webhook) return;

  const lines = Object.entries(amounts).map(
    ([resource, amount]) => `**${resource}:** ${Number(amount).toLocaleString()}`
  );

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title:
              scope === "main"
                ? "📥 Main Bank Deposit Credited"
                : "📥 Offshore Bank Deposit Credited",
            description: [
              `**Member:** ${memberLabel} (#${nationId})`,
              `**Record:** #${recordId}`,
              ...lines,
              `**Note:** ${note || "None"}`,
            ].join("\n"),
            color: 3066993,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch (error) {
    console.error("Deposit Discord notification failed:", error);
  }
}

async function syncAlliance(
  scope: "main" | "offshore",
  apiKey: string | null,
  allianceId: number
): Promise<SyncStats> {
  const stats = emptyStats();

  if (!apiKey) {
    stats.errors.push(`No API key configured for the ${scope} bank.`);
    return stats;
  }

  if (!Number.isInteger(allianceId) || allianceId <= 0) {
    stats.errors.push(`No valid alliance ID configured for the ${scope} bank.`);
    return stats;
  }

  const records = await fetchBankRecs(apiKey, allianceId);
  stats.scanned = records.length;

  const incoming = records.filter(
    (record) =>
      Number(record.rid) === allianceId &&
      Number(record.rtype) === 2 &&
      Number(record.stype) === 1
  );

  const nationIds = [
    ...new Set(
      incoming
        .map((record) => Number(record.sid))
        .filter((id) => Number.isSafeInteger(id) && id > 0)
    ),
  ];

  if (nationIds.length === 0) return stats;

  const supabase = db();
  const { data: members, error: memberError } = await supabase
    .from("econ_members")
    .select("id, nation_id, nation_name, leader_name")
    .in("nation_id", nationIds)
    .limit(3000);

  if (memberError) {
    throw new Error(`Could not match depositing nations: ${memberError.message}`);
  }

  const membersByNation = new Map<
    number,
    { id: string; label: string }
  >();

  for (const member of members ?? []) {
    membersByNation.set(Number(member.nation_id), {
      id: member.id,
      label:
        member.leader_name ||
        member.nation_name ||
        `Nation #${member.nation_id}`,
    });
  }

  for (const record of incoming) {
    const recordId = Number(record.id);
    const nationId = Number(record.sid);

    if (
      !Number.isSafeInteger(recordId) ||
      recordId <= 0 ||
      !Number.isSafeInteger(nationId) ||
      nationId <= 0
    ) {
      stats.skipped += 1;
      stats.errors.push(`Invalid sender or record ID in ${scope} record ${record.id}.`);
      continue;
    }

    const member = membersByNation.get(nationId);
    if (!member) {
      stats.unmatched += 1;
      continue;
    }

    const amounts = getPositiveAmounts(record);
    if (Object.keys(amounts).length === 0) {
      stats.skipped += 1;
      continue;
    }

    // This RPC atomically claims the bank record and inserts its ledger rows.
    // A unique (source, record_id) key prevents double-crediting on retries.
    const { data: credited, error } = await supabase.rpc(
      "econ_credit_bank_deposit",
      {
        p_source: scope,
        p_record_id: recordId,
        p_member_id: member.id,
        p_nation_id: nationId,
        p_amounts: amounts,
        p_note: (record.note || `${scope} bank deposit #${recordId}`).slice(0, 300),
        p_occurred_at: record.date || new Date().toISOString(),
      }
    );

    if (error) {
      stats.errors.push(`Record #${recordId}: ${error.message}`);
      continue;
    }

    if (credited === true) {
      stats.credited += 1;
      await notifyDeposit(
        scope,
        member.label,
        nationId,
        recordId,
        amounts,
        record.note
      );
    } else {
      stats.skipped += 1;
    }
  }

  return stats;
}

export async function syncBankDeposits() {
  const [mainApiKey, offshoreApiKey, allianceConfig, offshoreConfig] =
    await Promise.all([
      getBankApiKey(),
      getOffshoreApiKey(),
      getSetting<{ alliance_id?: number }>("alliance", {}),
      getSetting<{
        offshore_alliance_id?: number;
        source_alliance_id?: number;
      } | null>("offshore", null),
    ]);

  const mainAllianceId = Number(
    allianceConfig?.alliance_id || process.env.ALLIANCE_ID || 0
  );
  const offshoreAllianceId = Number(
    offshoreConfig?.offshore_alliance_id || 0
  );

  const result = {
    main: emptyStats(),
    offshore: emptyStats(),
  };

  try {
    result.main = await syncAlliance(
      "main",
      mainApiKey,
      mainAllianceId
    );
  } catch (error) {
    result.main.errors.push(
      error instanceof Error ? error.message : "Main bank sync failed."
    );
  }

  try {
    result.offshore = await syncAlliance(
      "offshore",
      offshoreApiKey || mainApiKey,
      offshoreAllianceId
    );
  } catch (error) {
    result.offshore.errors.push(
      error instanceof Error ? error.message : "Offshore bank sync failed."
    );
  }

  return result;
}
