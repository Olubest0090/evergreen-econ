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
  if (!res.ok) {
    return { ok: false as const, error: `Discord ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true as const, json: text ? JSON.parse(text) : null };
}

function amountLines(amounts: Record<string, number>) {
  return RESOURCES.filter((r) => Number(amounts[r]) > 0)
    .map((r) => `**${r}:** ${Number(amounts[r]).toLocaleString()}`)
    .join("\n");
}

export async function notifyDepositChannel(opts: {
  label: string;
  nationId: number;
  amounts: Record<string, number>;
  scope: "main" | "offshore";
  note?: string;
}) {
  const ch = depositChannelId();
  if (!ch) return { ok: false as const, error: "DISCORD_DEPOSIT_CHANNEL_ID not set" };
  return botFetch(`/channels/${ch}/messages`, {
    method: "POST",
    body: JSON.stringify({
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
              style: 3,
              label: "Offshore now",
              custom_id: "offshore_send_all",
            },
          ],
        },
      ],
    }),
  });
}

async function notifyRequest(
  kind: "grant" | "warchest",
  opts: {
    requestId: string;
    label: string;
    nationId: number;
    amounts: Record<string, number>;
    purpose?: string;
  }
) {
  const ch = grantChannelId();
  if (!ch) return { ok: false as const, error: "DISCORD_GRANT_CHANNEL_ID not set" };
  const role = roleId();
  const title = kind === "grant" ? "GRANT" : "WARCHEST";
  const content = role
    ? `<@&${role}> **${title} request** from ${opts.label}`
    : `**${title} request** from ${opts.label}`;
  const prefix = kind === "grant" ? "grant_req" : "warchest_req";

  return botFetch(`/channels/${ch}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      embeds: [
        {
          title: `${title} request (Requests)`,
          description: [
            `**Member:** ${opts.label} (#${opts.nationId})`,
            amountLines(opts.amounts),
            opts.purpose ? `**Purpose:** ${opts.purpose}` : null,
            `**ID:** \`${opts.requestId}\``,
          ]
            .filter(Boolean)
            .join("\n"),
          color: kind === "grant" ? 0xf59e0b : 0x3b82f6,
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
              custom_id: `${prefix}_accept:${opts.requestId}`,
            },
            {
              type: 2,
              style: 4,
              label: "Reject",
              custom_id: `${prefix}_reject:${opts.requestId}`,
            },
          ],
        },
      ],
    }),
  });
}

export async function notifyGrantRequest(opts: {
  requestId: string;
  label: string;
  nationId: number;
  amounts: Record<string, number>;
  purpose?: string;
}) {
  return notifyRequest("grant", opts);
}

export async function notifyWarchestRequest(opts: {
  requestId: string;
  label: string;
  nationId: number;
  amounts: Record<string, number>;
  purpose?: string;
}) {
  return notifyRequest("warchest", opts);
}

export async function notifyGrantWithdrawal(opts: {
  withdrawalId: string;
  label: string;
  nationId: number;
  amounts: Record<string, number>;
  recipientNationId: number;
}) {
  const ch = grantChannelId();
  if (!ch) return { ok: false as const, error: "DISCORD_GRANT_CHANNEL_ID not set" };
  const role = roleId();
  const content = role
    ? `<@&${role}> **GRANT withdrawal** from ${opts.label}`
    : `**GRANT withdrawal** from ${opts.label}`;

  return botFetch(`/channels/${ch}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      embeds: [
        {
          title: "GRANT withdrawal (Bank)",
          description: [
            `**Member:** ${opts.label} (#${opts.nationId})`,
            `**Send to:** #${opts.recipientNationId}`,
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
    }),
  });
}
