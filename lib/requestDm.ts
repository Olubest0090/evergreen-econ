import { getDiscordBotToken } from "@/lib/secrets";
import { RESOURCES } from "@/lib/resources";

const API = "https://discord.com/api/v10";

function amountLines(amounts: Record<string, number>) {
  return RESOURCES.filter((r) => Number(amounts[r] || 0) > 0)
    .map((r) => `**${r}:** ${Number(amounts[r]).toLocaleString()}`)
    .join("\n");
}

async function openDm(botToken: string, userId: string): Promise<string | null> {
  const res = await fetch(`${API}/users/@me/channels`, {
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

/** DM the member when a grant/warchest request is approved or denied. */
export async function sendRequestOutcomeDm(opts: {
  discordId: string;
  kind: string;
  decision: "approved" | "denied" | "paid";
  amounts: Record<string, number>;
  purpose?: string | null;
  note?: string | null;
  bankRecord?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const botToken = await getDiscordBotToken();
  if (!botToken) return { ok: false, error: "DISCORD_BOT_TOKEN not set" };
  if (!opts.discordId) return { ok: false, error: "No Discord id" };

  const channelId = await openDm(botToken, opts.discordId);
  if (!channelId) {
    return { ok: false, error: "Could not open DM (user may have DMs closed)" };
  }

  const title =
    opts.decision === "denied"
      ? `Your ${opts.kind.toUpperCase()} request was denied`
      : opts.decision === "paid" || opts.decision === "approved"
        ? `Your ${opts.kind.toUpperCase()} request was approved`
        : `Your ${opts.kind.toUpperCase()} request update`;

  const color =
    opts.decision === "denied" ? 0xef4444 : 0x22c55e;

  const description = [
    amountLines(opts.amounts),
    opts.purpose ? `**Purpose:** ${opts.purpose}` : null,
    opts.note ? `**Note:** ${opts.note}` : null,
    opts.bankRecord ? `**Bank record:** #${opts.bankRecord}` : null,
    opts.decision === "denied"
      ? "Contact econ staff if you need more detail."
      : "Resources should arrive from the alliance bank shortly (if not blockaded).",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      embeds: [
        {
          title,
          description,
          color,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `DM send failed: ${res.status} ${text.slice(0, 120)}` };
  }
  return { ok: true };
}
