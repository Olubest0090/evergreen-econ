/**
 * DM the member a Deposit Confirmation (Chimera-style).
 * Env: DISCORD_BOT_TOKEN — bot must share a server with the user (Evergreen Discord).
 */

import crypto from "crypto";

const RES_ORDER = [
  "money", "food", "coal", "oil", "uranium", "lead", "iron", "bauxite",
  "gasoline", "steel", "aluminum", "munitions",
] as const;

export type DepositNotifyInput = {
  discordId: string;
  accountId: string;
  nationId: number;
  leaderName?: string | null;
  amounts: Record<string, number>;
  depositCode?: string;
  date?: string;
};

export function makeDepositCode(nationId: number, accountId: string): string {
  const short = crypto.randomBytes(5).toString("base64url").slice(0, 10).toUpperCase();
  const acc = String(accountId).replace(/-/g, "").slice(0, 12);
  return `Evergreen_Deposit_${nationId}_${acc}_${short}`;
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function openDm(botToken: string, userId: string): Promise<string | null> {
  const res = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!res.ok) {
    console.error("open DM failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  const json = (await res.json()) as { id?: string };
  return json.id ?? null;
}

export async function sendDepositConfirmation(
  input: DepositNotifyInput
): Promise<{ ok: boolean; error?: string }> {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!botToken) return { ok: false, error: "DISCORD_BOT_TOKEN not set" };
  if (!input.discordId) return { ok: false, error: "No Discord id for member" };

  const code = input.depositCode || makeDepositCode(input.nationId, input.accountId);
  const when = input.date || new Date().toISOString();

  const channelId = await openDm(botToken, input.discordId);
  if (!channelId) {
    return {
      ok: false,
      error:
        "Could not open DM (user may have DMs closed, or bot does not share a server with them)",
    };
  }

  const embed = {
    title: "Deposit Confirmation",
    color: 0x22c55e,
    description: input.leaderName
      ? `Nation **#${input.nationId}** · ${input.leaderName}`
      : `Nation **#${input.nationId}**`,
    fields: [
      { name: "Account ID", value: String(input.accountId).slice(0, 1024), inline: true },
      { name: "Nation ID", value: String(input.nationId), inline: true },
      { name: "Date Submitted", value: when, inline: false },
      ...RES_ORDER.map((k) => {
        const v = Number(input.amounts[k] ?? 0);
        const name = k.charAt(0).toUpperCase() + k.slice(1);
        return {
          name,
          value: k === "money" ? `$${fmtMoney(v)}` : v.toFixed(2),
          inline: true,
        };
      }),
      { name: "Deposit Code", value: `\`${code}\``, inline: false },
    ],
    footer: { text: "Evergreen Econ" },
    timestamp: new Date(when).toISOString(),
  };

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, error: `DM send HTTP ${res.status} ${t.slice(0, 150)}` };
  }
  return { ok: true };
}
