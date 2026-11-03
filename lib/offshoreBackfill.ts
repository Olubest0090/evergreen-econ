/**
 * One-shot: net Yema (or any nation) vs offshore AA since a date,
 * then credit the net to their site balance + Evergreen books for deposits.
 */
import { db } from "@/lib/supabase";
import { getSetting } from "@/lib/settings";
import { getOffshoreApiKey, getPnwApiKey } from "@/lib/secrets";
import { RESOURCES } from "@/lib/resources";
import { bankrecSchema } from "@/lib/bankrecs";

const URL_BASE = "https://api.politicsandwar.com/graphql";
const PAGE = 100;
const MAX_PAGES = 30;

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

  const s = await bankrecSchema("offshore", true);
  const an = s.args.map((a) => a.name);
  const fields = s.fields;
  const pickA = (...c: string[]): string | undefined => c.find((n) => an.includes(n));
  const pickF = (...c: string[]): string | undefined => c.find((n) => fields.includes(n));
  const argRid = pickA("rid", "receiver_id");
  const argSid = pickA("sid", "sender_id");
  const argRtype = pickA("rtype", "receiver_type");
  const argStype = pickA("stype", "sender_type");
  const argFirst = pickA("first");
  const fId = pickF("id");
  const fDate = pickF("date");
  const fSid = pickF("sender_id", "sid");
  const fStype = pickF("sender_type", "stype");
  const fRid = pickF("receiver_id", "rid");
  const fRtype = pickF("receiver_type", "rtype");
  if (!fId || !fDate || !fSid || !fStype || !fRid || !fRtype) {
    throw new Error("Bank record schema missing required fields");
  }
  const fRes = RESOURCES.filter((r) => fields.includes(r));
  const typeOf: Record<string, string> = {};
  for (const a of s.args) typeOf[a.name] = a.type;

  async function pages(filter: {
    rid?: number;
    sid?: number;
    rtype?: number;
    stype?: number;
  }): Promise<Record<string, unknown>[]> {
    const all: Record<string, unknown>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const decl: string[] = [];
      const call: string[] = [];
      const vars: Record<string, unknown> = {};
      const add = (arg: string | undefined, value: unknown) => {
        if (!arg || !typeOf[arg]) return;
        const t = typeOf[arg];
        decl.push(`$${arg}: ${t}`);
        call.push(`${arg}: $${arg}`);
        vars[arg] = t.startsWith("[") ? (Array.isArray(value) ? value : [value]) : value;
      };
      if (filter.rid != null) add(argRid, filter.rid);
      if (filter.sid != null) add(argSid, filter.sid);
      if (filter.rtype != null) add(argRtype, filter.rtype);
      if (filter.stype != null) add(argStype, filter.stype);
      if (argFirst) add(argFirst, PAGE);
      if (an.includes("page")) {
        decl.push(`$page: Int`);
        call.push(`page: $page`);
        vars.page = page;
      }
      const sel = [fId, fDate, fSid, fStype, fRid, fRtype, ...fRes].join(" ");
      const data = await gql<{
        bankrecs: {
          data: Record<string, unknown>[];
          paginatorInfo?: { hasMorePages?: boolean };
        };
      }>(
        apiKey,
        `query(${decl.join(", ")}) { bankrecs(${call.join(", ")}) { data { ${sel} } paginatorInfo { hasMorePages } } }`,
        vars
      );
      const rows = data.bankrecs?.data ?? [];
      all.push(...rows);
      if (!data.bankrecs?.paginatorInfo?.hasMorePages || rows.length < PAGE) break;
      if (!an.includes("page")) break;
    }
    return all;
  }

  const depRows = await pages({ rid: aa, rtype: 2, stype: 1, sid: nationId });
  const wRows = await pages({ sid: aa, stype: 2, rid: nationId, rtype: 1 });

  const deposits: Record<string, number> = {};
  const withdrawals: Record<string, number> = {};
  let depositCount = 0;
  let withdrawalCount = 0;

  for (const r of depRows) {
    if (Number(r[fSid]) !== nationId) continue;
    if (Number(r[fRid]) !== aa) continue;
    if (Number(r[fStype]) !== 1 || Number(r[fRtype]) !== 2) continue;
    const d = Date.parse(String(r[fDate] ?? ""));
    if (!Number.isFinite(d) || d < sinceMs) continue;
    addAmt(deposits, r);
    depositCount++;
  }
  for (const r of wRows) {
    if (Number(r[fRid]) !== nationId) continue;
    if (Number(r[fSid]) !== aa) continue;
    const d = Date.parse(String(r[fDate] ?? ""));
    if (!Number.isFinite(d) || d < sinceMs) continue;
    addAmt(withdrawals, r);
    withdrawalCount++;
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
    throw new Error("Nothing to credit (net is zero or empty for that period).");
  }

  const supa = db();
  const note = `Offshore backfill since ${preview.since.slice(0, 10)} (bankrecs net)`;

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
