import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE = "econ_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET is missing or shorter than 32 characters");
  return s;
}

const sig = (payload: string) =>
  crypto.createHmac("sha256", secret()).update(payload).digest("hex");

/**
 * Token formats:
 * - v2: discordId.staff.exp.epoch.hmac
 * - v1 legacy: discordId.staff.exp.hmac (epoch treated as 0)
 */
export async function setSession(
  discordId: string,
  staff: boolean,
  sessionEpoch = 0
) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const epoch = Math.max(0, Math.floor(Number(sessionEpoch) || 0));
  const payload = `${discordId}.${staff ? 1 : 0}.${exp}.${epoch}`;
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

export async function readSession(): Promise<{
  discordId: string;
  staff: boolean;
  epoch: number;
} | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const parts = raw.split(".");

  // v2: 5 parts
  if (parts.length === 5) {
    const [discordId, staff, expStr, epochStr, given] = parts;
    const payload = `${discordId}.${staff}.${expStr}.${epochStr}`;
    const a = Buffer.from(given);
    const b = Buffer.from(sig(payload));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (!/^\d+$/.test(discordId)) return null;
    if (Number(expStr) < Math.floor(Date.now() / 1000)) return null;
    return { discordId, staff: staff === "1", epoch: Number(epochStr) || 0 };
  }

  // v1 legacy: 4 parts
  if (parts.length === 4) {
    const [discordId, staff, expStr, given] = parts;
    const payload = `${discordId}.${staff}.${expStr}`;
    const a = Buffer.from(given);
    const b = Buffer.from(sig(payload));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (!/^\d+$/.test(discordId)) return null;
    if (Number(expStr) < Math.floor(Date.now() / 1000)) return null;
    return { discordId, staff: staff === "1", epoch: 0 };
  }

  return null;
}
