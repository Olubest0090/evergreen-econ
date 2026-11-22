import { NextResponse } from "next/server";
import crypto from "crypto";
import { executeOffshoreSendAll } from "@/lib/offshoreOps";
import {
  approveAndSendGrant,
  denyGrant,
  approveAndSendGrantRequest,
  denyGrantRequest,
} from "@/lib/grantOps";
import {
  econRoleId,
  formatDepositsValueReply,
  formatOffshoreBalanceReply,
} from "@/lib/econDiscordPanel";
import { getDiscordBotToken } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Interaction = {
  type: number;
  id?: string;
  token?: string;
  application_id?: string;
  member?: { user?: { id?: string }; roles?: string[] };
  user?: { id?: string };
  data?: { custom_id?: string };
};

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

/** Edit the deferred original interaction response (up to 15 min). */
async function editOriginal(
  applicationId: string,
  token: string,
  content: string,
  ephemeral = false
) {
  const body: Record<string, unknown> = { content };
  if (ephemeral) body.flags = 64;
  const res = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("discord editOriginal failed", res.status, t.slice(0, 200));
  }
}

/**
 * Acknowledge within 3s (type 5), run work in background, then edit message.
 * Fixes "bot didn't respond in time" while in-game send still works.
 */
function deferWork(
  interaction: Interaction,
  opts: { ephemeral?: boolean },
  work: () => Promise<string>
): NextResponse {
  const appId = String(interaction.application_id || process.env.DISCORD_CLIENT_ID || "");
  const token = String(interaction.token || "");
  if (!appId || !token) {
    return NextResponse.json({
      type: 4,
      data: { content: "❌ Missing interaction token.", flags: 64 },
    });
  }

  const run = async () => {
    try {
      const content = await work();
      await editOriginal(appId, token, content, !!opts.ephemeral);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      console.error("deferred interaction work failed:", msg);
      await editOriginal(appId, token, `❌ ${msg}`, true);
    }
  };

  // Keep serverless function alive after the 3s ack (Next 15+ / Vercel)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { after } = require("next/server") as { after?: (fn: () => void) => void };
    if (typeof after === "function") after(() => void run());
    else void run();
  } catch {
    void run();
  }

  return NextResponse.json({
    type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    data: opts.ephemeral ? { flags: 64 } : {},
  });
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

  let interaction: Interaction;
  try {
    interaction = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // PING
  if (interaction.type === 1) {
    return NextResponse.json({ type: 1 });
  }

  // MESSAGE_COMPONENT (buttons)
  if (interaction.type === 3) {
    const customId = interaction.data?.custom_id || "";
    const actor =
      interaction.member?.user?.id || interaction.user?.id || "discord";

    // --- Econ panel: Offshore (slow) ---
    if (customId === "econ_panel_offshore" || customId === "offshore_send_all") {
      const role = await econRoleId();
      const roles = interaction.member?.roles || [];
      if (role && !roles.includes(role)) {
        return NextResponse.json({
          type: 4,
          data: {
            content: "❌ Only the econ role can run Offshore now.",
            flags: 64,
          },
        });
      }
      return deferWork(interaction, { ephemeral: false }, async () => {
        const result = await executeOffshoreSendAll(actor);
        if (!result.ok) return `❌ Offshore failed: ${result.error}`;
        const lines = Object.entries(result.amounts)
          .map(([k, v]) => `${k}: ${Number(v).toLocaleString()}`)
          .join(", ");
        return `✅ Main → offshore.\n${lines}${
          result.record ? `\nRecord #${result.record}` : ""
        }`;
      });
    }

    // --- Panel: balances (can be slow due to API) ---
    if (customId === "econ_panel_offshore_bal") {
      return deferWork(interaction, { ephemeral: true }, async () =>
        formatOffshoreBalanceReply()
      );
    }
    if (customId === "econ_panel_deposits") {
      return deferWork(interaction, { ephemeral: true }, async () =>
        formatDepositsValueReply()
      );
    }

    // --- GRANT request ---
    if (customId.startsWith("grant_req_accept:")) {
      const id = customId.slice("grant_req_accept:".length);
      return deferWork(interaction, { ephemeral: false }, async () => {
        const result = await approveAndSendGrantRequest(id, actor);
        if (!result.ok) return `❌ Accept failed: ${result.error}`;
        return `✅ GRANT request accepted & sent from offshore.${
          result.record ? ` Record #${result.record}` : ""
        }`;
      });
    }
    if (customId.startsWith("grant_req_reject:")) {
      const id = customId.slice("grant_req_reject:".length);
      return deferWork(interaction, { ephemeral: false }, async () => {
        const result = await denyGrantRequest(id, actor);
        if (!result.ok) return `❌ Reject failed: ${result.error}`;
        return "⛔ GRANT request rejected.";
      });
    }

    // --- WARCHEST request ---
    if (customId.startsWith("warchest_req_accept:")) {
      const id = customId.slice("warchest_req_accept:".length);
      return deferWork(interaction, { ephemeral: false }, async () => {
        const result = await approveAndSendGrantRequest(id, actor);
        if (!result.ok) return `❌ Accept failed: ${result.error}`;
        return `✅ WARCHEST accepted & sent from offshore.${
          result.record ? ` Record #${result.record}` : ""
        }`;
      });
    }
    if (customId.startsWith("warchest_req_reject:")) {
      const id = customId.slice("warchest_req_reject:".length);
      return deferWork(interaction, { ephemeral: false }, async () => {
        const result = await denyGrantRequest(id, actor);
        if (!result.ok) return `❌ Reject failed: ${result.error}`;
        return "⛔ WARCHEST request rejected.";
      });
    }

    // --- GRANT withdrawal ---
    if (customId.startsWith("grant_accept:")) {
      const id = customId.slice("grant_accept:".length);
      return deferWork(interaction, { ephemeral: false }, async () => {
        const result = await approveAndSendGrant(id, actor);
        if (!result.ok) return `❌ Accept failed: ${result.error}`;
        return `✅ GRANT withdrawal sent.${
          result.record ? ` Record #${result.record}` : ""
        }`;
      });
    }
    if (customId.startsWith("grant_reject:")) {
      const id = customId.slice("grant_reject:".length);
      return deferWork(interaction, { ephemeral: false }, async () => {
        const result = await denyGrant(id, actor);
        if (!result.ok) return `❌ Reject failed: ${result.error}`;
        return "⛔ GRANT withdrawal rejected.";
      });
    }

    return NextResponse.json({
      type: 4,
      data: { content: "Unknown button.", flags: 64 },
    });
  }

  return NextResponse.json({ type: 1 });
}
