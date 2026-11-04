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
    const cookieState = req.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)econ_oauth=([^;]+)/)?.[1];
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

    const guildMember = await fetchGuildMember(token, String(alliance.guild_id), user.id);
    if (!guildMember) return fail("not_in_server");

    const staff = (roleCfg.role_ids ?? []).some((id) => guildMember.roles.includes(String(id)));
    const isMember = (memberCfg.role_ids ?? []).some((id) =>
      guildMember.roles.includes(String(id))
    );
    if (!staff && !isMember) return fail("not_member");

    const allianceIds = [...new Set([Number(alliance.alliance_id), 15718].filter((n) => n > 0))];
    const nationGroups = await Promise.all(allianceIds.map((id) => fetchAllianceNations(id)));
    const nations = nationGroups.flat();

    const mine = normName(user.username);
    const mineGlobal = normName(user.global_name);
    const matches = nations.filter((nation) => {
      if (!nation.discord) return false;
      const d = normName(nation.discord);
      return d === mine || (mineGlobal && d === mineGlobal);
    });
    if (matches.length === 0) return fail("no_nation");
    if (matches.length > 1) return fail("ambiguous");
    const nation = matches[0];
    if ((nation.alliance_position || "").toUpperCase() === "APPLICANT") return fail("not_in_alliance");

    const nationId = Number(nation.id);
    const { data: existing } = await supa
      .from("econ_members")
      .select("id, status")
      .or(`discord_id.eq.${user.id},nation_id.eq.${nationId}`)
      .limit(5);
    if (existing?.some((member) => member.status === "suspended")) return fail("suspended");

    const { error } = await supa.from("econ_members").upsert(
      {
        discord_id: user.id,
        discord_username: user.username,
        nation_id: nationId,
        nation_name: nation.nation_name,
        leader_name: nation.leader_name,
        staff,
        status: "active",
        last_login: new Date().toISOString(),
      },
      { onConflict: "nation_id" }
    );
    if (error) {
      console.error("member upsert failed:", error.message);
      return fail("server");
    }

    const { data: mem } = await supa
      .from("econ_members")
      .select("id")
      .eq("nation_id", nationId)
      .maybeSingle();

    // Auto-credit Locutus pending deposits on first (and every) login — never block login
    if (mem?.id) {
      try {
        const claim = await claimLocutusPendingForNation(nationId, mem.id);
        console.log(
          `Locutus claim nation #${nationId}: claimed=${claim.claimed}` +
            (claim.error ? ` error=${claim.error}` : "")
        );
      } catch (e) {
        console.error("Locutus claim threw:", e);
      }
    }

    await setSession(user.id, staff);

    void syncBankrecs({ force: true }).catch((error) => {
      console.error("post-login bankrec sync:", error);
    });

    const response = NextResponse.redirect(new URL("/", origin));
    response.cookies.delete("econ_oauth");
    return response;
  } catch (error) {
    console.error("discord callback error:", error);
    return fail("server");
  }
}
