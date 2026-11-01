import { readSession } from "@/lib/session";

/** Owner access is independent of staff permissions. Fail closed if unset. */
export async function isOwnerSession(): Promise<boolean> {
  const ownerDiscordId = process.env.OWNER_DISCORD_ID?.trim();
  if (!ownerDiscordId || !/^\d+$/.test(ownerDiscordId)) return false;
  const session = await readSession();
  return !!session && session.discordId === ownerDiscordId;
}
