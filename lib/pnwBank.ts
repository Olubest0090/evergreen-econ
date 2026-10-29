/**
 * Politics & War bank mutations (verified bot).
 * Env: PNW_API_KEY (nation with bank access on the SOURCE alliance),
 *      VERIFIED_BOT_KEY (X-Bot-Key).
 * Offshore payouts should use keys tied to the offshore alliance when withdrawing FROM offshore.
 * "Send all to offshore" uses the source alliance bank → receiver nation on offshore.
 */

const RES = [
  "money",
  "coal",
  "oil",
  "uranium",
  "iron",
  "bauxite",
  "lead",
  "gasoline",
  "munitions",
  "steel",
  "aluminum",
  "food",
] as const;

export type BankAmounts = Partial<Record<(typeof RES)[number], number>>;

function keys() {
  const apiKey = process.env.PNW_API_KEY;
  const botKey = process.env.VERIFIED_BOT_KEY;
  if (!apiKey) throw new Error("PNW_API_KEY is not set on the server");
  if (!botKey) throw new Error("VERIFIED_BOT_KEY is not set on the server");
  return { apiKey, botKey };
}

async function bankGql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const { apiKey, botKey } = keys();
  const res = await fetch("https://api.politicsandwar.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "X-Bot-Key": botKey,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`P&W bank API HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);
  if (!json.data) throw new Error("P&W bank API returned no data");
  return json.data;
}

/** Read alliance bank holdings (needs bank permission on the API key's nation). */
export async function fetchAllianceBank(allianceId: number): Promise<BankAmounts> {
  const data = await bankGql<{
    alliances: { data: Record<string, number | null>[] };
  }>(
    `query($id:[Int]){ alliances(id:$id){ data { money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food } } }`,
    { id: [allianceId] }
  );
  const row = data.alliances?.data?.[0];
  if (!row) throw new Error("Alliance bank not found or no access");
  const out: BankAmounts = {};
  for (const k of RES) {
    const v = Number(row[k] ?? 0);
    if (v > 0.0001) out[k] = Math.floor(v * 100) / 100;
  }
  return out;
}

/** Send resources from the alliance bank of the API key's alliance to a nation. */
export async function bankWithdrawToNation(
  receiverNationId: number,
  amounts: BankAmounts,
  note: string
): Promise<{ ok: true; raw: unknown } | { ok: false; error: string }> {
  try {
    const vars: Record<string, unknown> = {
      receiver: receiverNationId,
      note: note.slice(0, 50) || "Evergreen Econ",
    };
    const argParts: string[] = ["$receiver: Int!", "$note: String"];
    const callParts: string[] = ["receiver: $receiver", "note: $note"];
    for (const k of RES) {
      const v = amounts[k];
      if (v == null || v <= 0) continue;
      argParts.push(`$${k}: Float`);
      callParts.push(`${k}: $${k}`);
      vars[k] = v;
    }
    if (Object.keys(vars).length <= 2) {
      return { ok: false, error: "Nothing to send (bank empty or zero amounts)" };
    }

    const mutation = `mutation(${argParts.join(", ")}) {
      bankWithdraw(${callParts.join(", ")}) {
        id
        date
        money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food
      }
    }`;

    const data = await bankGql<{ bankWithdraw: unknown }>(mutation, vars);
    return { ok: true, raw: data.bankWithdraw };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bank withdraw failed" };
  }
}

export { RES as BANK_RESOURCES };
