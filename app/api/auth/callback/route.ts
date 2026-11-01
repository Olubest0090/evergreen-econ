import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { setSession } from "@/lib/session";
import { exchangeCode, fetchGuildMember, fetchUser, normName } from "@/lib/discord";
import { fetchAllianceNations } from "@/lib/pnw";
import { syncDepositsForNation } from "@/lib/bankDeposits";

type Alliance = { alliance_id: number | null; guild_id: string | null };
type Roles = { guild_id: string | null; role_ids: string[] };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = process.env.SITE_URL || url.origin;
  const fail = (code: string) => {
    const r = NextResponse.redirect(new URL(`/login?error=${code}`, origin));
    r.cookies.delete("econ_oauth");
    return r;
  };

  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = req.headers.get("cookie")?.match(/(?:^|;\s*)econ_oauth=([^;]+)/)?.[1];
    if (!code || !state || !cookieState || state !== cookieState) return fail("state");

    const token = await exchangeCode(code, `${origin}/api/auth/callback`);
    if (!token) return fail("discord");
    const user = await fetchUser(token);
    if (!user) return fail("discord");

    const supa = db();
    const { data: rows } = await supa
      .from("econ_settings")
      .select("key, value")
      .in("key", ["alliance", "econ_staff_roles", "member_roles"]);
    const alliance = (rows?.find((r) => r.key === "alliance")?.value ?? {}) as Alliance;
    const roleCfg = (rows?.find((r) => r.key === "econ_staff_roles")?.value ?? {}) as Roles;
    const memberCfg = (rows?.find((r) => r.key === "member_roles")?.value ?? {}) as Roles;
    if (!alliance.alliance_id || !alliance.guild_id) return fail("setup");

    const member = await fetchGuildMember(token, alliance.guild_id);
    if (!member) return fail("not_in_server");
    const staff = (roleCfg.role_ids ?? []).some((id) => member.roles.includes(String(id)));
    // Everyone who uses the site needs the Member role (econ staff count as members).
    const isMember = (memberCfg.role_ids ?? []).some((id) => member.roles.includes(String(id)));
    if (!staff && !isMember) return fail("not_member");

    // The Discord name the player typed on their P&W nation must match this Discord account.
    const nations = await fetchAllianceNations(alliance.alliance_id);
    const mine = normName(user.username);
    const matches = nations.filter((n) => n.discord && normName(n.discord) === mine);
    if (matches.length === 0) return fail("no_nation");
    if (matches.length > 1) return fail("ambiguous");
    const nation = matches[0];
    if ((nation.alliance_position || "").toUpperCase() === "APPLICANT") return fail("not_in_alliance");

    const { data: existing } = await supa
      .from("econ_members")
      .select("id, status")
      .or(`discord_id.eq.${user.id},nation_id.eq.${nation.id}`)
      .limit(2);
    if (existing?.some((m) => m.status === "suspended")) return fail("suspended");

    const { error } = await supa.from("econ_members").upsert(
      {
        discord_id: user.id,
        discord_username: user.username,
        nation_id: Number(nation.id),
        nation_name: nation.nation_name,
        leader_name: nation.leader_name,
        staff,
        last_login: new Date().toISOString(),
      },
      { onConflict: "nation_id" }
    );
    if (error) {
      console.error("member upsert failed:", error.message);
      return fail("server");
    }

    await setSession(user.id, staff);

    // Credit any in-game deposits for this nation + DM (same as auto bankrec path)
    try {
      void syncDepositsForNation(Number(nation.id));
    } catch (e) {
      console.error("post-login deposit sync:", e);
    }

    const res = NextResponse.redirect(new URL("/", origin));
    res.cookies.delete("econ_oauth");
    return res;
  } catch (e) {
    console.error("discord callback error:", e);
    return fail("server");
  }
}
