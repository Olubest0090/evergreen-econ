/**
 * Runtime secrets: DB override (econ_settings) wins over Vercel env.
 * Lets heads rotate P&W / bot keys from the site without Vercel access.
 * Values are never returned in full via API — only masked previews.
 */
import { getSetting, setSetting } from "@/lib/settings";

export type RuntimeSecrets = {
  pnw_api_key?: string;
  verified_bot_key?: string;
  discord_bot_token?: string;
  updated_at?: string;
  updated_by?: string;
};

const KEY = "runtime_secrets";

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
  if (patch.pnw_api_key !== undefined) {
    const v = String(patch.pnw_api_key).trim();
    if (v) next.pnw_api_key = v;
    else delete next.pnw_api_key;
  }
  if (patch.verified_bot_key !== undefined) {
    const v = String(patch.verified_bot_key).trim();
    if (v) next.verified_bot_key = v;
    else delete next.verified_bot_key;
  }
  if (patch.discord_bot_token !== undefined) {
    const v = String(patch.discord_bot_token).trim();
    if (v) next.discord_bot_token = v;
    else delete next.discord_bot_token;
  }
  return setSetting(KEY, next);
}

function mask(value: string | undefined, fromEnv: boolean): {
  set: boolean;
  source: "site" | "env" | "none";
  preview: string;
} {
  if (value) {
    const p =
      value.length <= 8
        ? "••••"
        : `${value.slice(0, 4)}…${value.slice(-4)}`;
    return { set: true, source: fromEnv ? "env" : "site", preview: p };
  }
  return { set: false, source: "none", preview: "" };
}

/** Status only — never the raw secret. */
export async function secretsStatus() {
  const rt = await readRuntimeSecrets();
  const envPnw = process.env.PNW_API_KEY?.trim();
  const envBot = process.env.VERIFIED_BOT_KEY?.trim();
  const envDiscord = process.env.DISCORD_BOT_TOKEN?.trim();

  const pnw = rt.pnw_api_key || envPnw;
  const bot = rt.verified_bot_key || envBot;
  const discord = rt.discord_bot_token || envDiscord;

  return {
    pnw_api_key: mask(pnw, !rt.pnw_api_key && !!envPnw),
    verified_bot_key: mask(bot, !rt.verified_bot_key && !!envBot),
    discord_bot_token: mask(discord, !rt.discord_bot_token && !!envDiscord),
    updated_at: rt.updated_at ?? null,
    updated_by: rt.updated_by ?? null,
  };
}

export async function getPnwApiKey(): Promise<string | null> {
  const rt = await readRuntimeSecrets();
  return (rt.pnw_api_key || process.env.PNW_API_KEY || "").trim() || null;
}

export async function getVerifiedBotKey(): Promise<string | null> {
  const rt = await readRuntimeSecrets();
  return (rt.verified_bot_key || process.env.VERIFIED_BOT_KEY || "").trim() || null;
}

export async function getDiscordBotToken(): Promise<string | null> {
  const rt = await readRuntimeSecrets();
  return (rt.discord_bot_token || process.env.DISCORD_BOT_TOKEN || "").trim() || null;
}
