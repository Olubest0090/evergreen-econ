import { db } from "@/lib/supabase";
import { bankWithdraw, type BankAmounts } from "@/lib/pnwBank";
import { issueGrant } from "@/lib/grants";
import { quoteGrowthGrant } from "@/lib/grantCosts";

function toBankAmounts(amounts: Record<string, number>): BankAmounts {
  const out: BankAmounts = {};
  for (const [k, v] of Object.entries(amounts)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) (out as Record<string, number>)[k] = n;
  }
  return out;
}

function grantNote(type: string, meta: Record<string, unknown>): string {
  if (type === "city") return `#grant #city=${meta.cityCount ?? 1}`;
  if (type === "infra") return `#grant #infra=${meta.targetInfra ?? ""}`;
  if (type === "land") return `#grant #land=${meta.targetLand ?? ""}`;
  if (type === "project") return `#grant #project=${String(meta.projectName ?? "").replace(/\s+/g, "_")}`;
  return "#grant";
}

export async function executeGrowthGrant(opts: {
  nationId: number;
  grantType: "city" | "infra" | "land" | "project";
  cityCount?: number;
  cityTo?: number;
  cityIds?: number[];
  targetInfra?: number;
  targetLand?: number;
  projectName?: string;
  send: boolean;
  staffDiscordId: string;
  note?: string;
  amountsOverride?: Record<string, number> | null;
}): Promise<
  | {
      ok: true;
      quote: Extract<Awaited<ReturnType<typeof quoteGrowthGrant>>, { ok: true }>;
      grantId?: string;
      bankRecord?: string | null;
      sent: boolean;
    }
  | { ok: false; error: string }
> {
  const quote = await quoteGrowthGrant({
    nationId: opts.nationId,
    grantType: opts.grantType,
    cityCount: opts.cityCount,
    cityTo: opts.cityTo,
    cityIds: opts.cityIds,
    targetInfra: opts.targetInfra,
    targetLand: opts.targetLand,
    projectName: opts.projectName,
  });
  if (!quote.ok) return { ok: false, error: quote.error };

  let amounts = { ...quote.amounts };
  if (opts.amountsOverride && Object.keys(opts.amountsOverride).length) {
    amounts = {};
    for (const [k, v] of Object.entries(opts.amountsOverride)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) amounts[k] = n;
    }
  }
  if (!Object.keys(amounts).length) return { ok: false, error: "Grant amounts are empty" };

  let bankRecord: string | null = null;
  let sent = false;

  if (opts.send) {
    const note = (opts.note || grantNote(opts.grantType, quote.meta)).slice(0, 50);
    const result = await bankWithdraw({
      actor: "offshore",
      receiver: opts.nationId,
      receiverType: "nation",
      amounts: toBankAmounts(amounts),
      note,
    });
    if (!result.ok) return { ok: false, error: result.error || "Offshore bank withdraw failed" };
    sent = true;
    bankRecord = result.id;
  }

  const issued = await issueGrant({
    nationId: opts.nationId,
    leaderName: quote.label.replace(/\s*\(#\d+\)\s*$/, ""),
    grantType: opts.grantType,
    amounts,
    meta: { ...quote.meta, breakdown: quote.breakdown, sent, bankRecord },
    note: opts.note || grantNote(opts.grantType, quote.meta),
    staffDiscordId: opts.staffDiscordId,
  });
  if ("error" in issued) {
    return {
      ok: false,
      error: sent ? `Sent in-game but failed to record grant: ${issued.error}` : issued.error,
    };
  }

  await db().from("econ_audit_log").insert({
    actor_discord_id: opts.staffDiscordId,
    action: "growth_grant",
    details: {
      grantId: issued.id,
      grantType: opts.grantType,
      nationId: opts.nationId,
      amounts,
      sent,
      bankRecord,
    },
  });

  return { ok: true, quote, grantId: issued.id, bankRecord, sent };
}
