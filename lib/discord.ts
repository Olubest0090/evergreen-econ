const API = "https://discord.com/api/v10";

export function authorizeUrl(state: string, redirectUri: string): string {
  const id = process.env.DISCORD_CLIENT_ID;
  if (!id) throw new Error("DISCORD_CLIENT_ID is not set");
  const p = new URLSearchParams({
    client_id: id,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "identify guilds.members.read",
    state,
    // Allow Discord to show consent if the user needs the guilds scope again
    prompt: "consent",
  });
  return `https://discord.com/oauth2/authorize?${p.toString()}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<string | null> {
  const id = process.env.DISCORD_CLIENT_ID;
  const secret = process.env.DISCORD_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Discord env vars are not set");
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("discord token exchange failed:", res.status, await res.text().catch(() => ""));
    return null;
  }
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

export type DiscordUser = { id: string; username: string; global_name?: string | null };

export async function fetchUser(token: string): Promise<DiscordUser | null> {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return res.ok ? ((await res.json()) as DiscordUser) : null;
}

/**
 * Membership in the configured guild.
 * 1) User OAuth: GET /users/@me/guilds/{guild}/member
 * 2) Fallback with bot token: GET /guilds/{guild}/members/{user}
 */
export async function fetchGuildMember(
  token: string,
  guildId: string,
  userId?: string
): Promise<{ roles: string[]; via: "user" | "bot" } | null> {
  const res = await fetch(`${API}/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.ok) {
    const json = (await res.json()) as { roles?: string[] };
    return { roles: json.roles ?? [], via: "user" };
  }
  console.error("guild member (user token) failed:", res.status, guildId);

  // Bot fallback — works when user is in the server even if OAuth guild scope glitches
  const bot = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
  if (bot && userId) {
    const botRes = await fetch(`${API}/guilds/${guildId}/members/${userId}`, {
      headers: { Authorization: `Bot ${bot}` },
      cache: "no-store",
    });
    if (botRes.ok) {
      const json = (await botRes.json()) as { roles?: string[] };
      return { roles: json.roles ?? [], via: "bot" };
    }
    console.error("guild member (bot) failed:", botRes.status, guildId, userId);
  }

  return null;
}

/** Compare Discord names loosely: case, a leading @, and the old #1234 tag are ignored. */
export function normName(s: string | null | undefined): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/#\d{1,4}$/, "");
}
