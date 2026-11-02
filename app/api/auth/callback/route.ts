import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { setSession } from "@/lib/session";
import { exchangeCode, fetchGuildMember, fetchUser, normName } from "@/lib/discord";
import { fetchAllianceNations } from "@/lib/pnw";
import { syncBankrecs } from "@/lib/bankrecs";
import { claimLocutusPendingForNation } from "@/lib/locutusPending";

type Alliance = { alliance_id: number | null; guild_id: string | null };
type Roles = { guild_id: string | null; role_ids: string[] };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = process.env.SITE_URL || url.origin;
  const fail = (code: string) => {
    const response = NextResponse.redirect(new URL(`/login?error=${code}`, origin));
    response.cookies.delete("econ_oauth");
    return response;
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
    const alliance = (rows?.find((row) => row.key === "alliance")?.value ?? {}) as Alliance;
    const roleCfg = (rows?.find((row) => row.key === "econ_staff_roles")?.value ?? {}) as Roles;
    const memberCfg = (rows?.find((row) => row.key === "member_roles")?.value ?? {}) as Roles;
    if (!alliance.alliance_id || !alliance.guild_id) return fail("setup");

    const guildMember = await fetchGuildMember(token, alliance.guild_id);
    if (!guildMember) return fail("not_in_server");
    const staff = (roleCfg.role_ids ?? []).some((id) => guildMember.roles.includes(String(id)));
    const isMember = (memberCfg.role_ids ?? []).some((id) => guildMember.roles.includes(String(id)));
    if (!staff && !isMember) return fail("not_member");

    const allianceIds = [...new Set([Number(alliance.alliance_id), 15718])];
    const nationGroups = await Promise.all(allianceIds.map((id) => fetchAllianceNations(id)));
    const nations = nationGroups.flat();

    const mine = normName(user.username);
    const matches = nations.filter((nation) => nation.discord && normName(nation.discord) === mine);
    if (matches.length === 0) return fail("no_nation");
    if (matches.length > 1) return fail("ambiguous");
    const nation = matches[0];
    if ((nation.alliance_position || "").toUpperCase() === "APPLICANT") return fail("not_in_alliance");

    const { data: existing } = await supa
      .from("econ_members")
      .select("id, status")
      .or(`discord_id.eq.\( {user.id},nation_id.eq. \){nation.id}`)
      .limit(2);
    if (existing?.some((member) => member.status === "suspended")) return fail("suspended");

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

    // Claim Locutus sheet deposits held while unregistered
    const { data: mem } = await supa
      .from("econ_members")
      .select("id")
      .eq("nation_id", Number(nation.id))
      .maybeSingle();

    if (mem?.id) {
      void claimLocutusPendingForNation(Number(nation.id), mem.id).catch((e) =>
        console.error("locutus pending claim:", e)
      );
    }

    await setSession(user.id, staff);

    // Live bankrec + pending bank deposits
    void syncBankrecs({ force: true }).catch((error) => {
      console.error("post-login pending deposit claim:", error);
    });

    const response = NextResponse.redirect(new URL("/", origin));
    response.cookies.delete("econ_oauth");
    return response;
  } catch (error) {
    console.error("discord callback error:", error);
    return fail("server");
  }
}
