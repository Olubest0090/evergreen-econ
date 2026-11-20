/**
 * Discord econ control panel: post embed + button actions.
 */
import { getDiscordBotToken } from "@/lib/secrets";
import { getSetting } from "@/lib/settings";
import { fetchAllianceBank, type BankAmounts } from "@/lib/pnwBank";
import { marketWorth } from "@/lib/marketWorth";
import { db } from "@/lib/supabase";
import { RESOURCES } from "@/lib/resources";

const API = "https://discord.com/api/v10";

type DiscordChannels = {
  deposit_channel_id?: string;
  grant_channel_id?: string;
  econ_role_id?: string;
  panel_channel_id?: string;
};

async function channelConfig(): Promise<DiscordChannels> {
  try {
    return await getSetting<DiscordChannels>("discord_channels", {});
  } catch {
    return {};
  }
}

export async function panelChannelId(): Promise<string> {
  const cfg = await channelConfig();
  return (
    cfg.panel_channel_id?.trim() ||
    process.env.DISCORD_PANEL_CHANNEL_ID?.trim() ||
    cfg.deposit_channel_id?.trim() ||
    process.env.DISCORD_DEPOSIT_CHANNEL_ID?.trim() ||
    process.env.DISCORD_ECON_CHANNEL_ID?.trim() ||
    ""
  );
}

export async function econRoleId(): Promise<string> {
  const cfg = await channelConfig();
  return cfg.econ_role_id?.trim() || process.env.DISCORD_ECON_ROLE_ID?.trim() || "";
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
    return { ok: false as const, error: `Discord ${res.status}: ${text.slice(0, 240)}` };
  }
  return { ok: true as const, json: text ? JSON.parse(text) : null };
}

function amountLines(amounts: BankAmounts | Record<string, number>, limit = 12) {
  return RESOURCES.filter((r) => Number(amounts[r] || 0) > 0)
    .slice(0, limit)
    .map((r) => `**${r}:** ${Number(amounts[r]).toLocaleString()}`)
    .join("\n");
}

/** Sum all member site balances (deposits on the website). */
export async function sumMemberDeposits(): Promise<{
  amounts: Record<string, number>;
  worth: { total: number; label: string } | null;
  membersWithBalance: number;
}> {
  const supa = db();
  const { data, error } = await supa
    .from("econ_balances")
    .select("member_id, resource, balance")
    .limit(50000);
  if (error) throw new Error(error.message);

  const amounts: Record<string, number> = {};
  const members = new Set<string>();
  for (const row of data ?? []) {
    const bal = Number(row.balance);
    if (!Number.isFinite(bal) || bal === 0) continue;
    members.add(String(row.member_id));
    const k = String(row.resource);
    amounts[k] = Math.round(((amounts[k] || 0) + bal) * 100) / 100;
  }
  const worth = await marketWorth(amounts);
  return { amounts, worth, membersWithBalance: members.size };
}

/** Live offshore alliance bank. */
export async function getOffshoreBankTotal(): Promise<{
  amounts: BankAmounts;
  worth: { total: number; label: string } | null;
  allianceId: number;
}> {
  const cfg = await getSetting<{ offshore_alliance_id?: number } | null>("offshore", null);
  const allianceId = Number(cfg?.offshore_alliance_id || 0);
  if (!allianceId) throw new Error("Offshore alliance ID not set (Gov → Offshore)");
  const amounts = await fetchAllianceBank(allianceId, "offshore");
  const worth = await marketWorth(amounts);
  return { amounts, worth, allianceId };
}

export function panelEmbedComponents() {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 4, // danger red — money movement
          label: "Offshore now",
          custom_id: "econ_panel_offshore",
        },
        {
          type: 2,
          style: 2, // secondary
          label: "Offshore balance",
          custom_id: "econ_panel_offshore_bal",
        },
        {
          type: 2,
          style: 3, // success green
          label: "Member deposits value",
          custom_id: "econ_panel_deposits",
        },
      ],
    },
  ];
}

/** Post (or you can pin) the control panel in the panel channel. */
export async function postEconControlPanel(channelId?: string): Promise<
  { ok: true; messageId: string; channelId: string } | { ok: false; error: string }
> {
  const ch = (channelId || (await panelChannelId())).trim();
  if (!ch) {
    return {
      ok: false,
      error:
        "Set panel channel: env DISCORD_PANEL_CHANNEL_ID or discord_channels.panel_channel_id (or deposit channel)",
    };
  }

  const body = {
    content: null as string | null,
    embeds: [
      {
        title: "Evergreen Econ — Controls",
        description:
          "Staff tools for banking.\n\n" +
          "• **Offshore now** — send main bank → offshore (econ role)\n" +
          "• **Offshore balance** — live total in the offshore alliance bank\n" +
          "• **Member deposits value** — sum of everyone on the site + est. market worth",
        color: 0x22c55e,
        footer: { text: "Evergreen Econ" },
        timestamp: new Date().toISOString(),
      },
    ],
    components: panelEmbedComponents(),
  };

  const res = await botFetch(`/channels/${ch}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: res.error };
  const id = String((res.json as { id?: string })?.id || "");
  return { ok: true, messageId: id, channelId: ch };
}

export async function formatOffshoreBalanceReply(): Promise<string> {
  const { amounts, worth, allianceId } = await getOffshoreBankTotal();
  const lines = amountLines(amounts) || "_Empty_";
  return (
    `**Offshore bank** (AA #${allianceId})\n${lines}\n` +
    (worth ? `**Est. market value:** ${worth.label}` : "**Est. market value:** n/a")
  );
}

export async function formatDepositsValueReply(): Promise<string> {
  const { amounts, worth, membersWithBalance } = await sumMemberDeposits();
  const lines = amountLines(amounts) || "_No balances_";
  return (
    `**Member deposits on site** (${membersWithBalance} members with balance)\n${lines}\n` +
    (worth ? `**Est. market value:** ${worth.label}` : "**Est. market value:** n/a")
  );
}
