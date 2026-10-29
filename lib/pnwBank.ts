/**
 * P&W bank mutations. 401 = bad/mismatched API key + bot key, or bot not linked to that nation.
 * bankWithdraw always pays a NATION from the API key's alliance bank (not another alliance id).
 * To fund "offshore", withdraw to a nation in the offshore alliance (banker), then they hold/deposit there.
 */

const RES = [
  "money", "coal", "oil", "uranium", "iron", "bauxite", "lead",
  "gasoline", "munitions", "steel", "aluminum", "food",
] as const;

export type BankAmounts = Partial<Record<(typeof RES)[number], number>>;

function keys() {
  const apiKey = process.env.PNW_API_KEY?.trim();
  const botKey = process.env.VERIFIED_BOT_KEY?.trim();
  if (!apiKey) throw new Error("PNW_API_KEY is not set on the server");
  if (!botKey) throw new Error("VERIFIED_BOT_KEY is not set on the server");
  return { apiKey, botKey };
}

async function bankGql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const { apiKey, botKey } = keys();

  // Official bot style: headers only (no key in URL)
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

  const text = await res.text();
  let json: { data?: T; errors?: { message: string }[] } = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }

  if (res.status === 401) {
    throw new Error(
      "P&W returned 401 (unauthorized). Check: (1) PNW_API_KEY is the nation key linked to the verified bot, " +
        "(2) VERIFIED_BOT_KEY is exact with no spaces, (3) that nation has bank access on the SOURCE alliance, " +
        "(4) bot is approved for this API key on the account page."
    );
  }
  if (!res.ok) {
    throw new Error(`P&W bank API HTTP ${res.status}: ${text.slice(0, 180)}`);
  }
  if (json.errors?.length) throw new Error(json.errors[0].message);
  if (!json.data) throw new Error("P&W bank API returned no data");
  return json.data;
}

export async function fetchAllianceBank(allianceId: number): Promise<BankAmounts> {
  const data = await bankGql<{
    alliances: { data: Record<string, number | null>[] };
  }>(
    `query($id:[Int]){ alliances(id:$id){ data { money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food } } }`,
    { id: [allianceId] }
  );
  const row = data.alliances?.data?.[0];
  if (!row) throw new Error("Alliance bank not found or this API key cannot see that bank");
  const out: BankAmounts = {};
  for (const k of RES) {
    const v = Number(row[k] ?? 0);
    if (v > 0.0001) out[k] = Math.floor(v * 100) / 100;
  }
  return out;
}

/** First member nation id in alliance (fallback banker). */
export async function firstNationInAlliance(allianceId: number): Promise<number | null> {
  const data = await bankGql<{
    nations: { data: { id: string; alliance_position: string | null }[] };
  }>(
    `query($a:[Int]){ nations(alliance_id:$a, first:50){ data { id alliance_position } } }`,
    { a: [allianceId] }
  );
  const rows = data.nations?.data ?? [];
  const nonApp = rows.find((n) => (n.alliance_position || "").toUpperCase() !== "APPLICANT");
  const id = Number((nonApp || rows[0])?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function bankWithdrawToNation(
  receiverNationId: number,
  amounts: BankAmounts,
  note: string
): Promise<{ ok: true; raw: unknown } | { ok: false; error: string }> {
  try {
    const vars: Record<string, unknown> = {
      receiver: receiverNationId,
      note: (note || "Evergreen Econ").slice(0, 50),
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
      return { ok: false, error: "Nothing to send (source bank empty)" };
    }

    const mutation = `mutation(${argParts.join(", ")}) {
      bankWithdraw(${callParts.join(", ")}) {
        id
        date
      }
    }`;

    const data = await bankGql<{ bankWithdraw: unknown }>(mutation, vars);
    return { ok: true, raw: data.bankWithdraw };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bank withdraw failed" };
  }
}

export { RES as BANK_RESOURCES };
