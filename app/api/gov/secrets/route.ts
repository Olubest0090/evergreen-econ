import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { secretsStatus, writeRuntimeSecrets } from "@/lib/secrets";

export const dynamic = "force-dynamic";

const ALLOWED = [
  "pnw_api_key",
  "verified_bot_key",
  "bot_key_api_key",
  "bank_api_key",
  "offshore_api_key",
  "discord_bot_token",
] as const;

export async function GET() {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!staff.isHead && staff.perms !== null) {
    return NextResponse.json({ error: "Only econ head can view secret status" }, { status: 403 });
  }
  return NextResponse.json(await secretsStatus());
}

export async function POST(req: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!staff.isHead && staff.perms !== null) {
    return NextResponse.json({ error: "Only econ head can change keys" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const patch: Record<string, string> = {};
  for (const k of ALLOWED) {
    if (k in body) patch[k] = String(body[k] ?? "");
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await writeRuntimeSecrets(patch, staff.discordId);
  if (error) return NextResponse.json({ error }, { status: 500 });

  await db().from("econ_audit_log").insert({
    actor_discord_id: staff.discordId,
    action: "runtime_secrets_updated",
    details: { fields: Object.keys(patch) },
  });

  return NextResponse.json({ ok: true, status: await secretsStatus() });
}
