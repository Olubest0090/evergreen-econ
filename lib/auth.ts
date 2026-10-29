import { readSession } from "@/lib/session";
import { db } from "@/lib/supabase";

export type Me = {
  id: string; // econ_members.id
  discordId: string;
  username: string;
  nationId: number;
  nationName: string | null;
  leaderName: string | null;
  staff: boolean;
};

export async function getMe(): Promise<Me | null> {
  const s = await readSession();
  if (!s) return null;
  const { data } = await db()
    .from("econ_members")
    .select("id, discord_id, discord_username, nation_id, nation_name, leader_name, status")
    .eq("discord_id", s.discordId)
    .maybeSingle();
  if (!data || data.status !== "active") return null;
  return {
    id: data.id,
    discordId: String(data.discord_id),
    username: data.discord_username,
    nationId: Number(data.nation_id),
    nationName: data.nation_name,
    leaderName: data.leader_name,
    staff: s.staff,
  };
}

export async function requireStaff(): Promise<Me | null> {
  const me = await getMe();
  return me && me.staff ? me : null;
}
