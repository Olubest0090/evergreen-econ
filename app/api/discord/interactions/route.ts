import { NextResponse } from "next/server";
import crypto from "crypto";
import { executeOffshoreSendAll } from "@/lib/offshoreOps";
import {
  approveAndSendGrant,
  denyGrant,
  approveAndSendGrantRequest,
  denyGrantRequest,
} from "@/lib/grantOps";

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
        Buffer.from("302a300506032b6570032100", "hex"),
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
    member?: { user?: { id?: string } };
    user?: { id?: string };
    data?: { custom_id?: string };
  };
  try {
    interaction = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (interaction.type === 1) {
    return NextResponse.json({ type: 1 });
  }

  if (interaction.type === 3) {
    const customId = interaction.data?.custom_id || "";
    const actor =
      interaction.member?.user?.id || interaction.user?.id || "discord";

    if (customId === "offshore_send_all") {
      const result = await executeOffshoreSendAll(actor);
      if (!result.ok) {
        return NextResponse.json({
          type: 4,
          data: { content: `❌ Offshore failed: ${result.error}`, flags: 64 },
        });
      }
      const lines = Object.entries(result.amounts)
        .map(([k, v]) => `${k}: ${Number(v).toLocaleString()}`)
        .join(", ");
      return NextResponse.json({
        type: 4,
        data: {
          content: `✅ Main → offshore.\n${lines}${
            result.record ? `\nRecord #${result.record}` : ""
          }`,
        },
      });
    }

    // Requests page GRANT
    if (customId.startsWith("grant_req_accept:")) {
      const id = customId.slice("grant_req_accept:".length);
      const result = await approveAndSendGrantRequest(id, actor);
      if (!result.ok) {
        return NextResponse.json({
          type: 4,
          data: { content: `❌ Accept failed: ${result.error}`, flags: 64 },
        });
      }
      return NextResponse.json({
        type: 4,
        data: {
          content: `✅ GRANT request accepted & sent from offshore.${
            result.record ? ` Record #${result.record}` : ""
          }`,
        },
      });
    }
    if (customId.startsWith("grant_req_reject:")) {
      const id = customId.slice("grant_req_reject:".length);
      const result = await denyGrantRequest(id, actor);
      if (!result.ok) {
        return NextResponse.json({
          type: 4,
          data: { content: `❌ Reject failed: ${result.error}`, flags: 64 },
        });
      }
      return NextResponse.json({
        type: 4,
        data: { content: "⛔ GRANT request rejected." },
      });
    }

    // Bank GRANT withdrawal
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
          content: `✅ GRANT withdrawal sent.${
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
        data: { content: "⛔ GRANT withdrawal rejected." },
      });
    }

    return NextResponse.json({
      type: 4,
      data: { content: "Unknown button.", flags: 64 },
    });
  }

  return NextResponse.json({ type: 1 });
}
