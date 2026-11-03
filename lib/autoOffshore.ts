/**
 * Auto-offshore on a timer after P&W turn change.
 * Turns are every 2 hours (UTC even hours: 00:00, 02:00, …).
 * When enabled, we pick a random delay 10–25 min after that turn,
 * then empty main AA → offshore once per turn (via the 1‑min cron).
 */
import { getSetting, setSetting } from "@/lib/settings";
import { executeOffshoreSendAll } from "@/lib/offshoreOps";
import { db } from "@/lib/supabase";

export type AutoOffshoreConfig = {
  enabled: boolean;
  /** inclusive minutes after turn */
  minMinutes?: number;
  maxMinutes?: number;
};

type State = {
  /** unix ms of the turn we already offshored for */
  lastTurnMs?: number;
  /** planned fire time (unix ms) for current turn */
  fireAtMs?: number;
  /** turn boundary this fireAt belongs to */
  plannedForTurnMs?: number;
};

const TURN_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Most recent turn change at or before `now` (UTC even-hour boundaries). */
export function lastTurnChangeMs(now = Date.now()): number {
  return Math.floor(now / TURN_MS) * TURN_MS;
}

function randInt(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export async function getAutoOffshore(): Promise<AutoOffshoreConfig> {
  const v = await getSetting<AutoOffshoreConfig>("auto_offshore", {
    enabled: false,
    minMinutes: 10,
    maxMinutes: 25,
  });
  return {
    enabled: !!v?.enabled,
    minMinutes: Number(v?.minMinutes) > 0 ? Number(v.minMinutes) : 10,
    maxMinutes: Number(v?.maxMinutes) > 0 ? Number(v.maxMinutes) : 25,
  };
}

export async function setAutoOffshore(
  enabled: boolean,
  minMinutes = 10,
  maxMinutes = 25
) {
  const min = Math.max(1, Math.min(110, Number(minMinutes) || 10));
  const max = Math.max(min, Math.min(119, Number(maxMinutes) || 25));
  await setSetting("auto_offshore", { enabled: !!enabled, minMinutes: min, maxMinutes: max });
  return { enabled: !!enabled, minMinutes: min, maxMinutes: max };
}

/**
 * Call from cron (about every minute).
 * If enabled and we are past the random 10–25m window for this turn, offshore once.
 */
export async function maybeRunAutoOffshore(): Promise<{
  ran: boolean;
  reason: string;
  record?: string | null;
}> {
  const cfg = await getAutoOffshore();
  if (!cfg.enabled) return { ran: false, reason: "disabled" };

  const now = Date.now();
  const turnMs = lastTurnChangeMs(now);
  const minM = cfg.minMinutes ?? 10;
  const maxM = cfg.maxMinutes ?? 25;

  const state = await getSetting<State>("auto_offshore_state", {});
  if (state.lastTurnMs === turnMs) {
    return { ran: false, reason: "already ran this turn" };
  }

  // Plan a random fire time once per turn
  let fireAt = state.fireAtMs;
  if (state.plannedForTurnMs !== turnMs || !fireAt) {
    const delayMin = randInt(minM, maxM);
    fireAt = turnMs + delayMin * 60_000;
    await setSetting("auto_offshore_state", {
      ...state,
      plannedForTurnMs: turnMs,
      fireAtMs: fireAt,
    });
  }

  if (now < fireAt!) {
    const minsLeft = Math.ceil((fireAt! - now) / 60_000);
    return { ran: false, reason: `waiting ~${minsLeft}m (fire at ${new Date(fireAt!).toISOString()})` };
  }

  const result = await executeOffshoreSendAll("system:auto_offshore_turn");
  await setSetting("auto_offshore_state", {
    lastTurnMs: turnMs,
    plannedForTurnMs: turnMs,
    fireAtMs: fireAt,
  });

  await db().from("econ_audit_log").insert({
    actor_discord_id: "system",
    action: result.ok ? "auto_offshore_ok" : "auto_offshore_failed",
    details: result.ok
      ? {
          amounts: result.amounts,
          receiver: result.receiver,
          record: result.record,
          turnMs,
          fireAtMs: fireAt,
          mode: "turn_timer",
        }
      : { error: result.error, turnMs, fireAtMs: fireAt, mode: "turn_timer" },
  });

  if (!result.ok) return { ran: false, reason: result.error };
  return { ran: true, reason: "sent", record: result.record };
}
