import { NextResponse } from "next/server";
import crypto from "crypto";
import { executeOffshoreSendAll } from "@/lib/offshoreOps";
import { approveAndSendGrant, denyGrant } from "@/lib/grantOps";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function verifyDiscord(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  body: string
): boolean {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"), // SPKI prefix for ed25519
        Buffer.from(publicKeyHex, "hex"),
      ]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(
      null,
      Buffer.from(timestamp + body),
      key,
      Buffer.from(signatureHex, "hex")
    );
  } catch (e) {
    console.error("discord verify failed", e);
    return false;
  }
}

export async function POST(req: Request) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY?.trim();
  if (!publicKey) {
    return NextResponse.json({ error: "DISCORD_PUBLIC_KEY not set" }, { status: 500 });
  }

  const signature = req.headers.get("x-signature-ed25519") || "";
  const timestamp = req.headers.get("x-signature-timestamp") || "";
  const raw = await req.text();

  if (!verifyDiscord(publicKey, signature, timestamp, raw)) {
    return new NextResponse("invalid request signature", { status: 401 });
  }

  let interaction: {
    type: number;
    id?: string;
    token?: string;
    member?: { user?: { id?: string }; roles?: string[] };
    user?: { id?: string };
    data?: { custom_id?: string };
  };
  try {
    interaction = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // PING
  if (interaction.type === 1) {
    return NextResponse.json({ type: 1 });
  }

  // MESSAGE_COMPONENT
  if (interaction.type === 3) {
    const customId = interaction.data?.custom_id || "";
    const actor =
      interaction.member?.user?.id || interaction.user?.id || "discord";

    // Defer response (type 6) then follow up for long bank ops — or type 4 immediate
    // Use type 5 DEFERRED_UPDATE_MESSAGE for 15 min
    // Next.js must return quickly; bank can take seconds — return deferred then edit

    if (customId === "offshore_send_all") {
      // Respond later pattern: first ACK with type 5
      const result = await executeOffshoreSendAll(actor);
      if (!result.ok) {
        return NextResponse.json({
          type: 4,
          data: {
            content: `❌ Offshore failed: ${result.error}`,
            flags: 64, // ephemeral
          },
        });
      }
      const lines = Object.entries(result.amounts)
        .map(([k, v]) => `${k}: ${Number(v).toLocaleString()}`)
        .join(", ");
      return NextResponse.json({
        type: 4,
        data: {
          content: `✅ Emptied main → offshore.\n${lines}${
            result.record ? `\nBank record #${result.record}` : ""
          }`,
        },
      });
    }

    if (customId.startsWith("grant_accept:")) {
      const id = customId.slice("grant_accept:".length);
      const result = await approveAndSendGrant(id, actor);
      if (!result.ok) {
        return NextResponse.json({
          type: 4,
          data: { content: `❌ Accept failed: ${result.error}`, flags: 64 },
        });
      }
      return NextResponse.json({
        type: 4,
        data: {
          content: `✅ GRANT accepted and sent from offshore.${
            result.record ? ` Record #${result.record}` : ""
          }`,
        },
      });
    }

    if (customId.startsWith("grant_reject:")) {
      const id = customId.slice("grant_reject:".length);
      const result = await denyGrant(id, actor);
      if (!result.ok) {
        return NextResponse.json({
          type: 4,
          data: { content: `❌ Reject failed: ${result.error}`, flags: 64 },
        });
      }
      return NextResponse.json({
        type: 4,
        data: { content: `⛔ GRANT rejected.` },
      });
    }

    return NextResponse.json({
      type: 4,
      data: { content: "Unknown button.", flags: 64 },
    });
  }

  return NextResponse.json({ type: 1 });
}
