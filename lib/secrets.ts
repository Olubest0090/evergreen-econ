/**
 * Runtime secrets: DB override (econ_settings) wins over Vercel env.
 * Heads can rotate keys from /gov/keys without Vercel access.
 * Full values are never returned via API — only masked previews.
 */
import { getSetting, setSetting } from "@/lib/settings";

export type RuntimeSecrets = {
  /** General / legacy P&W read key (GraphQL). */
  pnw_api_key?: string;
  /** Verified bot key for bank mutations. */
  verified_bot_key?: string;
  /**
   * API key of the account that owns the bot key, if different from the
   * nation that actually sends (Claude offshore wiring).
   */
  bot_key_api_key?: string;
  /** Nation in main alliance with bank access. */
  bank_api_key?: string;
  /** Nation in offshore alliance with bank access (withdrawals from offshore). */
  offshore_api_key?: string;
  /** Discord bot token for deposit DMs. */
  discord_bot_token?: string;
  updated_at?: string;
  updated_by?: string;
};

const KEY = "runtime_secrets";

const FIELDS = [
  "pnw_api_key",
  "verified_bot_key",
  "bot_key_api_key",
  "bank_api_key",
  "offshore_api_key",
  "discord_bot_token",
] as const;

type Field = (typeof FIELDS)[number];

export async function readRuntimeSecrets(): Promise<RuntimeSecrets> {
  return getSetting<RuntimeSecrets>(KEY, {});
}

export async function writeRuntimeSecrets(
  patch: Partial<RuntimeSecrets>,
  updatedBy: string
): Promise<{ error?: string }> {
  const cur = await readRuntimeSecrets();
  const next: RuntimeSecrets = {
    ...cur,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  };
  for (const f of FIELDS) {
    if (patch[f] !== undefined) {
      const v = String(patch[f] ?? "").trim();
      if (v) (next as Record<string, string>)[f] = v;
      else delete (next as Record<string, unknown>)[f];
    }
  }
  return setSetting(KEY, next);
}

function mask(
  value: string | undefined,
  fromEnv: boolean
): { set: boolean; source: "site" | "env" | "none"; preview: string } {
  if (value) {
    const p =
      value.length <= 8 ? "••••" : `${value.slice(0, 4)}…${value.slice(-4)}`;
    return { set: true, source: fromEnv ? "env" : "site", preview: p };
  }
  return { set: false, source: "none", preview: "" };
}

function pick(rt: RuntimeSecrets, field: Field, envName: string) {
  const fromSite = rt[field]?.trim();
  const fromEnv = process.env[envName]?.trim();
  const value = fromSite || fromEnv;
  return mask(value, !fromSite && !!fromEnv);
}

/** Status only — never the raw secret. */
export async function secretsStatus() {
  const rt = await readRuntimeSecrets();
  return {
    pnw_api_key: pick(rt, "pnw_api_key", "PNW_API_KEY"),
    verified_bot_key: pick(rt, "verified_bot_key", "VERIFIED_BOT_KEY"),
    bot_key_api_key: pick(rt, "bot_key_api_key", "BOT_KEY_API_KEY"),
    bank_api_key: pick(rt, "bank_api_key", "BANK_API_KEY"),
    offshore_api_key: pick(rt, "offshore_api_key", "OFFSHORE_API_KEY"),
    discord_bot_token: pick(rt, "discord_bot_token", "DISCORD_BOT_TOKEN"),
    updated_at: rt.updated_at ?? null,
    updated_by: rt.updated_by ?? null,
  };
}

async function resolve(field: Field, envName: string): Promise<string | null> {
  const rt = await readRuntimeSecrets();
  return (rt[field] || process.env[envName] || "").trim() || null;
}

export async function getPnwApiKey(): Promise<string | null> {
  // Prefer dedicated bank keys for reads if general key missing
  return (
    (await resolve("pnw_api_key", "PNW_API_KEY")) ||
    (await resolve("bank_api_key", "BANK_API_KEY")) ||
    (await resolve("offshore_api_key", "OFFSHORE_API_KEY"))
  );
}

export async function getVerifiedBotKey(): Promise<string | null> {
  return resolve("verified_bot_key", "VERIFIED_BOT_KEY");
}

/** API key paired with the verified bot (may differ from sender nation). */
export async function getBotKeyApiKey(): Promise<string | null> {
  // Only the explicit bot-owner key — never fall back to BANK/PNW (wrong nation → 401).
  return resolve("bot_key_api_key", "BOT_KEY_API_KEY");
}

export async function getBankApiKey(): Promise<string | null> {
  return (
    (await resolve("bank_api_key", "BANK_API_KEY")) ||
    (await resolve("pnw_api_key", "PNW_API_KEY"))
  );
}

export async function getOffshoreApiKey(): Promise<string | null> {
  return resolve("offshore_api_key", "OFFSHORE_API_KEY");
}

export async function getDiscordBotToken(): Promise<string | null> {
  return resolve("discord_bot_token", "DISCORD_BOT_TOKEN");
}
