"use client";

import { useCallback, useEffect, useState } from "react";

type Cfg = {
  offshore_alliance_id?: number;
  banker_nation_id?: number;
  source_alliance_id?: number;
  label?: string;
};

export default function OffshorePanel() {
  const [cfg, setCfg] = useState<Cfg>({});
  const [offshoreA, setOffshoreA] = useState("");
  const [sourceA, setSourceA] = useState("");
  const [banker, setBanker] = useState("");
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
    const o = j.offshore || {};
    setCfg(o);
    // migrate old shape if any
    setOffshoreA(
      o.offshore_alliance_id
        ? String(o.offshore_alliance_id)
        : o.receiver_nation_id
          ? ""
          : ""
    );
    setSourceA(o.source_alliance_id ? String(o.source_alliance_id) : "");
    setBanker(
      o.banker_nation_id
        ? String(o.banker_nation_id)
        : o.receiver_nation_id
          ? String(o.receiver_nation_id)
          : ""
    );
    setLabel(o.label || "");
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
          offshore_alliance_id: Number(offshoreA),
          source_alliance_id: sourceA ? Number(sourceA) : null,
          banker_nation_id: banker ? Number(banker) : null,
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
        "Send ALL resources from the SOURCE alliance bank to a nation in the OFFSHORE alliance? This cannot be undone from the site."
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
      setMsg(
        `Sent. Receiver nation #${j.receiver}. Amounts: ${JSON.stringify(j.amounts)}`
      );
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
        Offshore is an <strong>alliance</strong>. P&amp;W still delivers bank withdrawals to a{" "}
        <strong>nation</strong> in that alliance (banker). Keys: VERIFIED_BOT_KEY {bot ? "✓" : "✗"} ·
        PNW_API_KEY {api ? "✓" : "✗"}
      </p>
      <label className="block text-xs text-[var(--muted)]">
        Offshore alliance ID
        <input
          className="input mt-1 w-full"
          value={offshoreA}
          onChange={(e) => setOffshoreA(e.target.value)}
          placeholder="Offshore alliance ID"
          inputMode="numeric"
        />
      </label>
      <label className="block text-xs text-[var(--muted)]">
        Source alliance ID (main bank to empty)
        <input
          className="input mt-1 w-full"
          value={sourceA}
          onChange={(e) => setSourceA(e.target.value)}
          placeholder="e.g. 15590"
          inputMode="numeric"
        />
      </label>
      <label className="block text-xs text-[var(--muted)]">
        Banker nation ID in offshore (recommended)
        <input
          className="input mt-1 w-full"
          value={banker}
          onChange={(e) => setBanker(e.target.value)}
          placeholder="Nation that receives the resources"
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
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
          Save offshore
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || !cfg.offshore_alliance_id}
          onClick={() => void sendAll()}
        >
          Send everything to offshore
        </button>
      </div>
      {msg && <p className="text-xs whitespace-pre-wrap text-[var(--muted)]">{msg}</p>}
    </div>
  );
}
