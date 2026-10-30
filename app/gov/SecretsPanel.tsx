"use client";

import { useCallback, useEffect, useState } from "react";

type Mask = { set: boolean; source: string; preview: string };
type Status = {
  pnw_api_key: Mask;
  verified_bot_key: Mask;
  discord_bot_token: Mask;
  updated_at: string | null;
  updated_by: string | null;
};

export default function SecretsPanel() {
  const [st, setSt] = useState<Status | null>(null);
  const [pnw, setPnw] = useState("");
  const [bot, setBot] = useState("");
  const [discord, setDiscord] = useState("");
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
      if (pnw.trim()) body.pnw_api_key = pnw.trim();
      if (bot.trim()) body.verified_bot_key = bot.trim();
      if (discord.trim()) body.discord_bot_token = discord.trim();
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
      setPnw("");
      setBot("");
      setDiscord("");
      setSt(j.status);
      setMsg("Saved. Site overrides Vercel env until cleared.");
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
        {label}:{" "}
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
        Heads only. Keys saved here override Vercel environment variables so the alliance can
        rotate access without the host dashboard. Leave a field blank to keep the current value.
        Full keys are never shown again after save.
      </p>
      {st && (
        <div className="space-y-1 rounded-xl border border-[var(--border)] p-2.5">
          {row("P&W API key", st.pnw_api_key)}
          {row("Verified bot key", st.verified_bot_key)}
          {row("Discord bot token", st.discord_bot_token)}
          {st.updated_at && (
            <p className="text-[10.5px] text-[var(--muted)]">
              Last site update: {new Date(st.updated_at).toLocaleString()}
              {st.updated_by ? ` · by ${st.updated_by}` : ""}
            </p>
          )}
        </div>
      )}
      <label className="block text-xs text-[var(--muted)]">
        New P&amp;W API key
        <input
          className="input mt-1 w-full font-mono text-xs"
          type="password"
          autoComplete="off"
          value={pnw}
          onChange={(e) => setPnw(e.target.value)}
          placeholder="Leave blank to keep current"
        />
      </label>
      <label className="block text-xs text-[var(--muted)]">
        New verified bot key
        <input
          className="input mt-1 w-full font-mono text-xs"
          type="password"
          autoComplete="off"
          value={bot}
          onChange={(e) => setBot(e.target.value)}
          placeholder="Leave blank to keep current"
        />
      </label>
      <label className="block text-xs text-[var(--muted)]">
        New Discord bot token (DMs)
        <input
          className="input mt-1 w-full font-mono text-xs"
          type="password"
          autoComplete="off"
          value={discord}
          onChange={(e) => setDiscord(e.target.value)}
          placeholder="Leave blank to keep current"
        />
      </label>
      <button type="button" className="btn w-full" disabled={busy} onClick={() => void save()}>
        Save keys
      </button>
      {msg && <p className="text-xs text-[var(--muted)]">{msg}</p>}
    </div>
  );
}
