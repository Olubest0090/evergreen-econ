"use client";

import { useCallback, useEffect, useState } from "react";

type Mask = { set: boolean; source: string; preview: string };
type Status = {
  pnw_api_key: Mask;
  verified_bot_key: Mask;
  bot_key_api_key: Mask;
  bank_api_key: Mask;
  offshore_api_key: Mask;
  discord_bot_token: Mask;
  updated_at: string | null;
  updated_by: string | null;
};

const FIELDS: {
  key: keyof Status;
  label: string;
  help: string;
  state: "pnw" | "bot" | "botApi" | "bank" | "offshore" | "discord";
}[] = [
  {
    key: "verified_bot_key",
    label: "VERIFIED_BOT_KEY",
    help: "Verified bot key for bank mutations",
    state: "bot",
  },
  {
    key: "bot_key_api_key",
    label: "BOT_KEY_API_KEY",
    help: "API key of the account that owns the bot key (if different from sender)",
    state: "botApi",
  },
  {
    key: "bank_api_key",
    label: "BANK_API_KEY",
    help: "API key of a nation in the main alliance with bank access",
    state: "bank",
  },
  {
    key: "offshore_api_key",
    label: "OFFSHORE_API_KEY",
    help: "API key of a nation in the offshore alliance with bank access (withdrawals from offshore)",
    state: "offshore",
  },
  {
    key: "pnw_api_key",
    label: "PNW_API_KEY (optional / legacy reads)",
    help: "General GraphQL key if you still use one separate from bank keys",
    state: "pnw",
  },
  {
    key: "discord_bot_token",
    label: "DISCORD_BOT_TOKEN",
    help: "Bot token for deposit confirmation DMs",
    state: "discord",
  },
];

export default function SecretsPanel() {
  const [st, setSt] = useState<Status | null>(null);
  const [vals, setVals] = useState({
    pnw: "",
    bot: "",
    botApi: "",
    bank: "",
    offshore: "",
    discord: "",
  });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/gov/secrets", { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error || "Cannot load");
      return;
    }
    setSt(j);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const body: Record<string, string> = {};
      if (vals.bot.trim()) body.verified_bot_key = vals.bot.trim();
      if (vals.botApi.trim()) body.bot_key_api_key = vals.botApi.trim();
      if (vals.bank.trim()) body.bank_api_key = vals.bank.trim();
      if (vals.offshore.trim()) body.offshore_api_key = vals.offshore.trim();
      if (vals.pnw.trim()) body.pnw_api_key = vals.pnw.trim();
      if (vals.discord.trim()) body.discord_bot_token = vals.discord.trim();
      if (!Object.keys(body).length) {
        setMsg("Paste at least one new key to save");
        return;
      }
      const res = await fetch("/api/gov/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Save failed");
      setVals({ pnw: "", bot: "", botApi: "", bank: "", offshore: "", discord: "" });
      setSt(j.status);
      setMsg("Saved. Site values override Vercel env for the same key.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function row(label: string, m?: Mask) {
    if (!m) return null;
    return (
      <p className="text-xs text-[var(--muted)]">
        <span className="font-medium text-[var(--text)]">{label}</span>:{" "}
        {m.set ? (
          <>
            set ({m.source}) · <span className="font-mono">{m.preview}</span>
          </>
        ) : (
          "not set"
        )}
      </p>
    );
  }

  return (
    <div className="card space-y-3 text-sm">
      <h2 className="font-semibold">API &amp; bot keys</h2>
      <p className="text-xs text-[var(--muted)]">
        Heads only. Keys saved here override Vercel. Leave a field blank to keep the current
        value. Full keys are never shown after save. Prefer Vercel for highest security; site
        storage is plain in the database unless encryption is added later.
      </p>
      {st && (
        <div className="space-y-1 rounded-xl border border-[var(--border)] p-2.5">
          {row("VERIFIED_BOT_KEY", st.verified_bot_key)}
          {row("BOT_KEY_API_KEY", st.bot_key_api_key)}
          {row("BANK_API_KEY", st.bank_api_key)}
          {row("OFFSHORE_API_KEY", st.offshore_api_key)}
          {row("PNW_API_KEY", st.pnw_api_key)}
          {row("DISCORD_BOT_TOKEN", st.discord_bot_token)}
          {st.updated_at && (
            <p className="text-[10.5px] text-[var(--muted)]">
              Last site update: {new Date(st.updated_at).toLocaleString()}
              {st.updated_by ? ` · by ${st.updated_by}` : ""}
            </p>
          )}
        </div>
      )}

      {FIELDS.map((f) => (
        <label key={f.key} className="block text-xs text-[var(--muted)]">
          <span className="font-medium text-[var(--text)]">{f.label}</span>
          <span className="mt-0.5 block text-[10.5px]">{f.help}</span>
          <input
            className="input mt-1 w-full font-mono text-xs"
            type="password"
            autoComplete="off"
            value={vals[f.state]}
            onChange={(e) => setVals((v) => ({ ...v, [f.state]: e.target.value }))}
            placeholder="Leave blank to keep current"
          />
        </label>
      ))}

      <button type="button" className="btn w-full" disabled={busy} onClick={() => void save()}>
        Save keys
      </button>
      {msg && <p className="text-xs text-[var(--muted)]">{msg}</p>}
    </div>
  );
}
