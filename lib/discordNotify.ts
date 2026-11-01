/**
 * Channel notifications + buttons for econ (bot token).
 * Env / Keys:
 *   DISCORD_BOT_TOKEN
 *   DISCORD_ECON_CHANNEL_ID  (deposits + offshore button + grants)
 *   DISCORD_ECON_ROLE_ID     (pinged on GRANT requests)
 */
import { getDiscordBotToken } from "@/lib/secrets";
import { RESOURCES } from "@/lib/resources";

const API = "https://discord.com/api/v10";

function depositChannelId() {
  return (
    process.env.DISCORD_DEPOSIT_CHANNEL_ID?.trim() ||
    process.env.DISCORD_ECON_CHANNEL_ID?.trim() ||
    ""
  );
}
function grantChannelId() {
  return (
    process.env.DISCORD_GRANT_CHANNEL_ID?.trim() ||
    process.env.DISCORD_ECON_CHANNEL_ID?.trim() ||
    ""
  );
}
function roleId() {
  return process.env.DISCORD_ECON_ROLE_ID?.trim() || "";
}

async function botFetch(path: string, init: RequestInit = {}) {
  const token = await getDiscordBotToken();
  if (!token) return { ok: false as const, error: "DISCORD_BOT_TOKEN not set" };
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    return {
      ok: false as const,
      error: `Discord ${res.status}: ${text.slice(0, 200)}`,
    };
  }
  return { ok: true as const, json };
}

function amountLines(amounts: Record<string, number>) {
  return RESOURCES.filter((r) => Number(amounts[r]) > 0)
    .map((r) => `**${r}:** ${Number(amounts[r]).toLocaleString()}`)
    .join("\n");
}

/** Deposit credited — channel embed + Offshore now button */
export async function notifyDepositChannel(opts: {
  label: string;
  nationId: number;
  amounts: Record<string, number>;
  scope: "main" | "offshore";
  note?: string;
}) {
  const ch = depositChannelId();
  if (!ch)
    return {
      ok: false as const,
      error: "DISCORD_DEPOSIT_CHANNEL_ID (or DISCORD_ECON_CHANNEL_ID) not set",
    };

  const body = {
    embeds: [
      {
        title:
          opts.scope === "main"
            ? "📥 Main bank deposit credited"
            : "📥 Offshore deposit credited",
        description: [
          `**Member:** ${opts.label} (#${opts.nationId})`,
          amountLines(opts.amounts),
          opts.note ? `**Note:** ${opts.note}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        color: 0x22c55e,
        timestamp: new Date().toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3, // success green
            label: "Offshore now",
            custom_id: "offshore_send_all",
          },
        ],
      },
    ],
  };

  return botFetch(`/channels/${ch}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** GRANT request — ping role + Accept / Reject */
export async function notifyGrantRequest(opts: {
  withdrawalId: string;
  label: string;
  nationId: number;
  amounts: Record<string, number>;
  recipientNationId: number;
}) {
  const ch = grantChannelId();
  if (!ch)
    return {
      ok: false as const,
      error: "DISCORD_GRANT_CHANNEL_ID (or DISCORD_ECON_CHANNEL_ID) not set",
    };
  const role = roleId();
  const content = role
    ? `<@&${role}> **GRANT request** from ${opts.label}`
    : `**GRANT request** from ${opts.label}`;

  const body = {
    content,
    embeds: [
      {
        title: "GRANT withdrawal request",
        description: [
          `**Member:** ${opts.label} (#${opts.nationId})`,
          `**Send to nation:** #${opts.recipientNationId}`,
          amountLines(opts.amounts),
          `**ID:** \`${opts.withdrawalId}\``,
        ].join("\n"),
        color: 0xf59e0b,
        timestamp: new Date().toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "Accept",
            custom_id: `grant_accept:${opts.withdrawalId}`,
          },
          {
            type: 2,
            style: 4,
            label: "Reject",
            custom_id: `grant_reject:${opts.withdrawalId}`,
          },
        ],
      },
    ],
  };

  return botFetch(`/channels/${ch}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
