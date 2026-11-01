import { getSetting, type OffshoreConfig } from "@/lib/settings";
import { db } from "@/lib/supabase";
import {
  bankWithdraw,
  bankWithdrawArgs,
  fetchAllianceBank,
  firstNationInAlliance,
  type BankAmounts,
} from "@/lib/pnwBank";

export async function executeOffshoreSendAll(actorDiscordId: string): Promise<
  | { ok: true; amounts: BankAmounts; receiver: number; record: string | null }
  | { ok: false; error: string }
> {
  const cfg = await getSetting<OffshoreConfig | null>("offshore", null);
  if (!cfg?.offshore_alliance_id) {
    return { ok: false, error: "Save the offshore alliance ID first" };
  }
  const sourceId =
    cfg.source_alliance_id ||
    Number((await getSetting<{ alliance_id?: number }>("alliance", {})).alliance_id);
  if (!sourceId) return { ok: false, error: "Set the main alliance ID" };

  let amounts: BankAmounts;
  try {
    amounts = await fetchAllianceBank(sourceId, "source");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read main bank" };
  }
  if (!Object.keys(amounts).length) return { ok: false, error: "Main bank is empty" };

  let toAlliance = false;
  try {
    toAlliance = (await bankWithdrawArgs("source")).some((a) => a.name === "receiver_type");
  } catch {
    toAlliance = false;
  }
  let receiver: number | undefined = toAlliance
    ? cfg.offshore_alliance_id
    : cfg.banker_nation_id;
  if (!receiver) {
    try {
      receiver = (await firstNationInAlliance(cfg.offshore_alliance_id, "source")) ?? undefined;
    } catch {
      receiver = undefined;
    }
  }
  if (!receiver) return { ok: false, error: "Set banker nation ID in offshore" };

  const result = await bankWithdraw({
    actor: "source",
    receiver,
    receiverType: toAlliance ? "alliance" : "nation",
    amounts,
    note: "Econ to offshore",
  });

  await db().from("econ_audit_log").insert({
    actor_discord_id: actorDiscordId,
    action: result.ok ? "offshore_send_all" : "offshore_send_all_failed",
    details: {
      sourceId,
      receiver,
      amounts,
      result: result.ok ? result.id : result.error,
      via: "discord_button",
    },
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, amounts, receiver, record: result.id };
}
