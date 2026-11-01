import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const STATIC_FILE = /\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|txt|webp|woff2?)$/i;

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/_next/") || path === "/favicon.ico" ||
      path === "/robots.txt" || path === "/sitemap.xml" || STATIC_FILE.test(path)) {
    return NextResponse.next();
  }

  // Logging failure must never take the application offline.
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (url && key) {
      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const ip = request.headers.get("x-real-ip") ??
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

      // Never store query strings, request bodies, cookies or authorization headers.
      await supabase.from("econ_security_logs").insert({
        ip_address: ip,
        method: request.method.slice(0, 12),
        path: path.slice(0, 500),
        user_agent: (request.headers.get("user-agent") ?? "").slice(0, 1000),
      });
    }
  } catch (error) {
    console.error("Security request logging failed:", error);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
