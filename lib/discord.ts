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
    prompt: "none",
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
  if (!res.ok) return null;
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

/** The user's membership in the server, or null if they are not in it. */
export async function fetchGuildMember(token: string, guildId: string): Promise<{ roles: string[] } | null> {
  const res = await fetch(`${API}/users/@me/guilds/${guildId}/member`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { roles?: string[] };
  return { roles: json.roles ?? [] };
}

/** Compare Discord names loosely: case, a leading @, and the old #1234 tag are ignored. */
export function normName(s: string | null | undefined): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/#\d{1,4}$/, "");
}
