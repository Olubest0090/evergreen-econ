import { getDiscordBotToken } from "@/lib/secrets";
import { getSetting } from "@/lib/settings";
import { RESOURCES } from "@/lib/resources";
import { marketWorth } from "@/lib/marketWorth";

const API = "https://discord.com/api/v10";

type DiscordChannels = {
  deposit_channel_id?: string;
  grant_channel_id?: string;
  econ_role_id?: string;
};

async function channelConfig(): Promise<DiscordChannels> {
  try {
    return await getSetting<DiscordChannels>("discord_channels", {});
  } catch {
    return {};
  }
}

async function depositChannelId(): Promise<string> {
  const cfg = await channelConfig();
  return (
    cfg.deposit_channel_id?.trim() ||
    process.env.DISCORD_DEPOSIT_CHANNEL_ID?.trim() ||
    process.env.DISCORD_ECON_CHANNEL_ID?.trim() ||
    ""
  );
}

async function grantChannelId(): Promise<string> {
  const cfg = await channelConfig();
  return (
    cfg.grant_channel_id?.trim() ||
    process.env.DISCORD_GRANT_CHANNEL_ID?.trim() ||
    process.env.DISCORD_ECON_CHANNEL_ID?.trim() ||
    ""
  );
}

async function roleId(): Promise<string> {
  const cfg = await channelConfig();
  return (
    cfg.econ_role_id?.trim() ||
    process.env.DISCORD_ECON_ROLE_ID?.trim() ||
    ""
  );
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
    console.error("discordNotify botFetch failed", path, res.status, text.slice(0, 300));
    return { ok: false as const, error: `Discord ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true as const, json: text ? JSON.parse(text) : null };
}

function amountLines(amounts: Record<string, number>) {
  return RESOURCES.filter((r) => Number(amounts[r]) > 0)
    .map((r) => `**${r}:** ${Number(amounts[r]).toLocaleString()}`)
    .join("\n");
}

async function amountsBlock(amounts: Record<string, number>) {
  const lines = amountLines(amounts);
  const w = await marketWorth(amounts);
  if (w) return `${lines}\n**Approx. worth:** ${w.label}`;
  return lines;
}

export async function notifyDepositChannel(opts: {
  label: string;
  nationId: number;
  amounts: Record<string, number>;
  scope: "main" | "offshore";
  note?: string;
}) {
  const ch = await depositChannelId();
  if (!ch) {
    const err = "DISCORD_DEPOSIT_CHANNEL_ID not set (Vercel env or Gov setting discord_channels.deposit_channel_id)";
    console.error("notifyDepositChannel:", err);
    return { ok: false as const, error: err };
  }
  const worth = await marketWorth(opts.amounts);
  const worthTag = worth ? ` (worth ~${worth.label})` : "";
  const result = await botFetch(`/channels/${ch}/messages`, {
    method: "POST",
    body: JSON.stringify({
      embeds: [
        {
          title:
            (opts.scope === "main"
              ? "📥 Main bank deposit credited"
              : "📥 Offshore deposit credited") + worthTag,
          description: [
            `**Member:** ${opts.label} (#${opts.nationId})`,
            await amountsBlock(opts.amounts),
            opts.note ? `**Note:** ${opts.note}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
          color: opts.scope === "main" ? 0x22c55e : 0x3b82f6,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
  if (!result.ok) console.error("notifyDepositChannel post failed:", result.error);
  else console.log("notifyDepositChannel ok", ch, opts.nationId);
  return result;
}

export async function notifyGrantRequestChannel(opts: {
  content: string;
  embeds: unknown[];
  components?: unknown[];
}) {
  const ch = await grantChannelId();
  if (!ch) {
    const err = "DISCORD_GRANT_CHANNEL_ID not set";
    console.error("notifyGrantRequestChannel:", err);
    return { ok: false as const, error: err };
  }
  const role = await roleId();
  const content = role ? `<@&${role}> ${opts.content}` : opts.content;
  return botFetch(`/channels/${ch}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      embeds: opts.embeds,
      components: opts.components ?? [],
      allowed_mentions: role ? { roles: [role] } : undefined,
    }),
  });
}

/** Status for gov diagnostics */
export async function discordNotifyStatus() {
  return {
    depositChannelId: await depositChannelId(),
    grantChannelId: await grantChannelId(),
    econRoleId: await roleId(),
    botToken: !!(await getDiscordBotToken()),
  };
}
