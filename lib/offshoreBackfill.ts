/**
 * One-shot backfill: net deposits/withdrawals for a nation vs offshore AA since a date.
 * Uses alliances { bankrecs } (last ~14 days of records the key can see).
 */
import { db } from "@/lib/supabase";
import { getSetting } from "@/lib/settings";
import { getOffshoreApiKey, getPnwApiKey } from "@/lib/secrets";
import { RESOURCES } from "@/lib/resources";

const URL_BASE = "https://api.politicsandwar.com/graphql";

async function gql<T>(apiKey: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${URL_BASE}?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  if (!res.ok) throw new Error(`P&W HTTP ${res.status}: ${text.slice(0, 160)}`);
  if (json.errors?.length) throw new Error(json.errors[0].message);
  if (!json.data) throw new Error("P&W returned no data");
  return json.data;
}

function addAmt(into: Record<string, number>, row: Record<string, unknown>) {
  for (const r of RESOURCES) {
    const v = Number(row[r] ?? 0);
    if (v > 0.0001) into[r] = Math.round(((into[r] ?? 0) + v) * 100) / 100;
  }
}

export type BackfillPreview = {
  nationId: number;
  offshoreAllianceId: number;
  since: string;
  deposits: Record<string, number>;
  withdrawals: Record<string, number>;
  net: Record<string, number>;
  depositCount: number;
  withdrawalCount: number;
  memberId: string | null;
  leaderName: string | null;
  note?: string;
};

export async function previewOffshoreNationBackfill(opts: {
  nationId: number;
  sinceIso: string;
}): Promise<BackfillPreview> {
  const nationId = Number(opts.nationId);
  if (!Number.isInteger(nationId) || nationId <= 0) throw new Error("Invalid nation id");
  const sinceMs = Date.parse(opts.sinceIso);
  if (!Number.isFinite(sinceMs)) throw new Error("Invalid since date");

  const offshore = await getSetting<{
    offshore_alliance_id?: number;
    banker_nation_id?: number;
  } | null>("offshore", null);
  const aa = Number(offshore?.offshore_alliance_id || 0);
  if (!aa) throw new Error("Offshore alliance ID is not set");

  const rawKey = (await getOffshoreApiKey()) || (await getPnwApiKey());
  if (!rawKey) throw new Error("OFFSHORE_API_KEY / PNW_API_KEY missing");
  const apiKey: string = rawKey;

  const data = await gql<{
    alliances: { data: { bankrecs: Record<string, unknown>[] | null }[] };
  }>(
    apiKey,
    `query($id: [Int]) {
      alliances(id: $id, first: 1) {
        data {
          bankrecs {
            id date note
            sid stype rid rtype
            money food coal oil uranium lead iron bauxite gasoline munitions steel aluminum
          }
        }
      }
    }`,
    { id: [aa] }
  );

  const list = data.alliances?.data?.[0]?.bankrecs ?? [];
  const deposits: Record<string, number> = {};
  const withdrawals: Record<string, number> = {};
  let depositCount = 0;
  let withdrawalCount = 0;

  for (const r of list) {
    const d = Date.parse(String(r.date ?? ""));
    if (!Number.isFinite(d) || d < sinceMs) continue;
    const sid = Number(r.sid);
    const rid = Number(r.rid);
    const stype = Number(r.stype);
    const rtype = Number(r.rtype);
    // Deposit: nation -> offshore AA
    if (stype === 1 && rtype === 2 && sid === nationId && rid === aa) {
      addAmt(deposits, r);
      depositCount++;
    }
    // Withdrawal to nation: AA -> nation
    if (stype === 2 && rtype === 1 && sid === aa && rid === nationId) {
      addAmt(withdrawals, r);
      withdrawalCount++;
    }
  }

  const net: Record<string, number> = {};
  for (const r of RESOURCES) {
    const n = Math.round(((deposits[r] ?? 0) - (withdrawals[r] ?? 0)) * 100) / 100;
    if (n > 0.0001) net[r] = n;
  }

  const { data: mem } = await db()
    .from("econ_members")
    .select("id, leader_name, status")
    .eq("nation_id", nationId)
    .maybeSingle();

  return {
    nationId,
    offshoreAllianceId: aa,
    since: new Date(sinceMs).toISOString(),
    deposits,
    withdrawals,
    net,
    depositCount,
    withdrawalCount,
    memberId: mem?.status === "active" ? String(mem.id) : mem?.id != null ? String(mem.id) : null,
    leaderName: mem?.leader_name ?? null,
    note: "Game only returns ~last 14 days of alliance bankrecs.",
  };
}

export async function applyOffshoreNationBackfill(opts: {
  nationId: number;
  sinceIso: string;
  staffDiscordId: string;
  depositsOnly?: boolean;
}): Promise<{
  ok: true;
  credited: Record<string, number>;
  memberId: string;
  preview: BackfillPreview;
}> {
  const preview = await previewOffshoreNationBackfill({
    nationId: opts.nationId,
    sinceIso: opts.sinceIso,
  });
  if (!preview.memberId) {
    throw new Error(
      `Nation #${opts.nationId} is not registered on the site (or inactive). Register them first.`
    );
  }
  const memberId: string = preview.memberId;
  const amounts = opts.depositsOnly ? preview.deposits : preview.net;
  if (!Object.keys(amounts).length) {
    throw new Error(
      "Nothing to credit. Game only exposes ~last 14 days of bankrecs; deposit may be older, or already net zero."
    );
  }

  const supa = db();
  const note = `Offshore backfill since ${preview.since.slice(0, 10)} (alliance bankrecs)`;

  let usedRpc = false;
  for (const [res, amt] of Object.entries(amounts)) {
    const { error } = await supa.rpc("econ_credit_deposit", {
      p_member: memberId,
      p_resource: res,
      p_amount: amt,
      p_bankrec: -Math.floor(Date.now() / 1000),
      p_note: note,
    });
    if (error) {
      usedRpc = false;
      break;
    }
    usedRpc = true;
  }

  if (!usedRpc) {
    const rows = Object.entries(amounts).map(([resource, amount]) => ({
      member_id: memberId,
      resource,
      amount,
      kind: "deposit",
      note,
      created_by: `staff:${opts.staffDiscordId}`,
    }));
    const { error } = await supa.from("econ_ledger").insert(rows);
    if (error) throw new Error(error.message);
  }

  if (Object.keys(preview.deposits).length) {
    await supa.from("econ_audit_log").insert({
      actor_discord_id: opts.staffDiscordId,
      action: "offshore_deposit_credit",
      details: {
        bankrec_id: "backfill",
        sender_nation: opts.nationId,
        amounts: preview.deposits,
        since: preview.since,
        mode: "manual_backfill",
      },
    });
  }

  await supa.from("econ_audit_log").insert({
    actor_discord_id: opts.staffDiscordId,
    action: "offshore_nation_backfill",
    details: {
      nationId: opts.nationId,
      since: preview.since,
      deposits: preview.deposits,
      withdrawals: preview.withdrawals,
      credited: amounts,
      depositCount: preview.depositCount,
      withdrawalCount: preview.withdrawalCount,
      depositsOnly: !!opts.depositsOnly,
    },
  });

  return { ok: true, credited: amounts, memberId, preview };
}
