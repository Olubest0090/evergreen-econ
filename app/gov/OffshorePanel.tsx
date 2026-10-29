"use client";

import { useCallback, useEffect, useState } from "react";

type Cfg = {
  receiver_nation_id?: number;
  label?: string;
  source_alliance_id?: number;
};

export default function OffshorePanel() {
  const [cfg, setCfg] = useState<Cfg>({});
  const [receiver, setReceiver] = useState("");
  const [source, setSource] = useState("");
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [bot, setBot] = useState(false);
  const [api, setApi] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/gov/offshore", { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error || "Could not load offshore settings");
      return;
    }
    setCfg(j.offshore || {});
    setReceiver(j.offshore?.receiver_nation_id ? String(j.offshore.receiver_nation_id) : "");
    setSource(j.offshore?.source_alliance_id ? String(j.offshore.source_alliance_id) : "");
    setLabel(j.offshore?.label || "");
    setBot(!!j.botKeyConfigured);
    setApi(!!j.apiKeyConfigured);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/gov/offshore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          receiver_nation_id: Number(receiver),
          source_alliance_id: source ? Number(source) : null,
          label,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Save failed");
      setMsg("Offshore saved");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendAll() {
    if (
      !window.confirm(
        "Send ALL resources from the source alliance bank to the offshore receiver nation? This cannot be undone from the site."
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/gov/offshore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_all" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Send failed");
      setMsg(`Sent to offshore. Amounts: ${JSON.stringify(j.amounts)}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3 text-sm">
      <h2 className="font-semibold">Offshore bank</h2>
      <p className="text-xs text-[var(--muted)]">
        Member withdrawals should be paid from the <strong>offshore</strong> alliance. Configure the
        receiver nation (and optional source alliance for &quot;send everything&quot; from main).
        Keys: VERIFIED_BOT_KEY {bot ? "✓" : "✗"} · PNW_API_KEY {api ? "✓" : "✗"}
      </p>
      <label className="block text-xs text-[var(--muted)]">
        Offshore receiver nation ID
        <input
          className="input mt-1 w-full"
          value={receiver}
          onChange={(e) => setReceiver(e.target.value)}
          placeholder="e.g. 123456"
          inputMode="numeric"
        />
      </label>
      <label className="block text-xs text-[var(--muted)]">
        Label (optional)
        <input
          className="input mt-1 w-full"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Offshore A"
        />
      </label>
      <label className="block text-xs text-[var(--muted)]">
        Source alliance ID (main bank to empty)
        <input
          className="input mt-1 w-full"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Main Evergreen alliance ID"
          inputMode="numeric"
        />
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
          Save offshore
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || !cfg.receiver_nation_id}
          onClick={() => void sendAll()}
        >
          Send everything to offshore
        </button>
      </div>
      {msg && <p className="text-xs text-[var(--muted)]">{msg}</p>}
    </div>
  );
}
