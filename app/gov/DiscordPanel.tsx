"use client";

import { useState } from "react";

/**
 * Post the econ control embed (Offshore / Offshore balance / Deposits value)
 * into a Discord channel — phone-friendly, no browser console.
 */
export default function DiscordPanel() {
  const [channelId, setChannelId] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function post() {
    setBusy(true);
    setMsg("");
    try {
      const body: Record<string, string> = {};
      if (channelId.trim()) body.channel_id = channelId.trim();
      const r = await fetch("/api/gov/discord-panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to post");
      setMsg(
        `Posted. Channel ${j.channelId} · message ${j.messageId}. Check Discord (pin it if you want).`
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Discord control panel</h2>
      <p className="text-xs text-[var(--muted)]">
        Posts an embed in Discord with buttons: <strong>Offshore now</strong>,{" "}
        <strong>Offshore balance</strong>, <strong>Member deposits value</strong>.
      </p>
      <ol className="list-decimal space-y-1 pl-4 text-xs text-[var(--muted)]">
        <li>Discord → Settings → Advanced → turn on Developer Mode</li>
        <li>Long-press the channel → Copy Channel ID</li>
        <li>Paste below and tap Post</li>
      </ol>
      <input
        className="input"
        inputMode="numeric"
        placeholder="Discord channel ID"
        value={channelId}
        onChange={(e) => setChannelId(e.target.value)}
      />
      <button type="button" className="btn w-full" disabled={busy} onClick={() => void post()}>
        {busy ? "Posting…" : "Post panel to Discord"}
      </button>
      {msg && <p className="text-xs whitespace-pre-wrap">{msg}</p>}
    </div>
  );
}
