import { NextResponse } from "next/server";
import crypto from "crypto";
import { authorizeUrl } from "@/lib/discord";

export async function GET(req: Request) {
  const origin = process.env.SITE_URL || new URL(req.url).origin;
  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(state, `${origin}/api/auth/callback`));
  res.cookies.set("econ_oauth", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
