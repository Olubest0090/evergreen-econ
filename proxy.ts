import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const STATIC_FILE = /\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|txt|webp|woff2?)$/i;

function withSecurityHeaders(res: NextResponse) {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.headers.set("X-DNS-Prefetch-Control", "off");
  if (!res.headers.has("Content-Security-Policy")) {
    res.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.politicsandwar.com https://*.supabase.co https://discord.com; frame-ancestors 'none'"
    );
  }
  return res;
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (
    path.startsWith("/_next/") ||
    path === "/favicon.ico" ||
    path === "/robots.txt" ||
    path === "/sitemap.xml" ||
    STATIC_FILE.test(path)
  ) {
    return withSecurityHeaders(NextResponse.next());
  }

  const ip =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (url && key) {
      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // Phase 4: block listed IPs (except owner-security path still needs owner login —
      // blocked IPs cannot use the site at all)
      if (ip) {
        const { data: rule } = await supabase
          .from("econ_ip_rules")
          .select("status, expires_at")
          .eq("ip_address", ip)
          .eq("status", "blocked")
          .maybeSingle();
        if (rule) {
          const expired =
            rule.expires_at && new Date(rule.expires_at).getTime() < Date.now();
          if (!expired) {
            return withSecurityHeaders(
              new NextResponse("Forbidden", { status: 403 })
            );
          }
        }
      }

      await supabase.from("econ_security_logs").insert({
        ip_address: ip,
        method: request.method.slice(0, 12),
        path: path.slice(0, 500),
        user_agent: (request.headers.get("user-agent") ?? "").slice(0, 1000),
      });
    }
  } catch (error) {
    console.error("Security proxy:", error);
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
