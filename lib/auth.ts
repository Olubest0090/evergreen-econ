import { readSession } from "@/lib/session";
import { db } from "@/lib/supabase";

export const PERMS = ["requests", "withdrawals", "balances", "import", "rules", "members", "roles"] as const;
export type Perm = (typeof PERMS)[number];

export type Me = {
  id: string; // econ_members.id
  discordId: string;
  username: string;
  nationId: number;
  nationName: string | null;
  leaderName: string | null;
  staff: boolean;
};

export type Staff = Me & {
  /** null means every permission. */
  perms: string[] | null;
  isHead: boolean;
  /** Heads can manage roles. Until a head exists, every staff member can. */
  canManageRoles: boolean;
  can: (p: Perm) => boolean;
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

/** An econ staff member with their permissions. No row in econ_staff means full access. */
export async function requireStaff(): Promise<Staff | null> {
  const me = await getMe();
  if (!me || !me.staff) return null;
  const supa = db();
  const [{ data: row }, { count: heads }] = await Promise.all([
    supa.from("econ_staff").select("role, perms").eq("discord_id", me.discordId).maybeSingle(),
    supa.from("econ_staff").select("discord_id", { count: "exact", head: true }).eq("role", "head"),
  ]);
  const isHead = row?.role === "head";
  const perms: string[] | null = !row || isHead ? null : ((row.perms as string[]) ?? []);
  return {
    ...me,
    perms,
    isHead,
    canManageRoles: isHead || (heads ?? 0) === 0,
    can: (p: Perm) => perms === null || perms.includes(p),
  };
}
