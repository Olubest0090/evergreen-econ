import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE = "econ_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET is missing or shorter than 32 characters");
  return s;
}

const sig = (payload: string) => crypto.createHmac("sha256", secret()).update(payload).digest("hex");

// Token: <discordId>.<staff 0|1>.<expiry>.<hmac>
export async function setSession(discordId: string, staff: boolean) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `${discordId}.${staff ? 1 : 0}.${exp}`;
  const jar = await cookies();
  jar.set(COOKIE, `${payload}.${sig(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function readSession(): Promise<{ discordId: string; staff: boolean } | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [discordId, staff, expStr, given] = parts;
  const a = Buffer.from(given);
  const b = Buffer.from(sig(`${discordId}.${staff}.${expStr}`));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!/^\d+$/.test(discordId)) return null;
  if (Number(expStr) < Math.floor(Date.now() / 1000)) return null;
  return { discordId, staff: staff === "1" };
}
