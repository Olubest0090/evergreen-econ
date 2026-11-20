"use client";

import { useEffect, useState } from "react";

export default function GrantRepayPanel() {
  const [taxId, setTaxId] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/gov/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "repay_status" }),
      });
      const j = await r.json();
      if (j.settings?.tax_id) {
        setCurrent(Number(j.settings.tax_id));
        setTaxId(String(j.settings.tax_id));
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/gov/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_repay_tax", tax_id: Number(taxId) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setMsg(`Repayment tax ID set to ${j.tax_id}`);
      setCurrent(Number(j.tax_id));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function migrate() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/gov/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "migrate_repay" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setMsg(`Migrated ${j.updated ?? 0} active grants into repayment tracking`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function backfill() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/gov/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backfill_request_grants" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Backfill failed");
      setMsg(`Imported ${j.created ?? 0} paid grants for the progress bar (${j.skipped ?? 0} already tracked)`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/gov/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_repay_sync", resetCursor: true }),
      });
      const j = await r.json();
      if (j.ok === false) throw new Error(j.error || j.errors?.[0] || "Sync failed");
      setMsg(
        `Sync: on-tax ${j.onTax ?? 0}, bankrecs ${j.bankrecsSeen ?? 0}, applied ${j.applied ?? 0}, value ~$${Number(j.valueApplied || 0).toLocaleString()}, grants ${j.grantsTouched ?? 0}`
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">Grant repayment tax</h2>
      <p className="text-xs text-[var(--muted)]">
        Members only pay down grants while they are on this in-game tax ID (your 50/50 bracket).
        If they are moved off it, their progress bar freezes.
      </p>
      {current != null && (
        <p className="text-xs">
          Current tax ID: <span className="font-mono font-bold">{current}</span>
        </p>
      )}
      <input
        className="input"
        inputMode="numeric"
        placeholder="In-game tax ID"
        value={taxId}
        onChange={(e) => setTaxId(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={busy || !taxId.trim()} onClick={() => void save()}>
          Save tax ID
        </button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void migrate()}>
          Migrate all active grants
        </button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void syncNow()}>
          Run repay sync now
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={() => void backfill()}
        >
          Import paid grants → bar
        </button>
      </div>
      {msg && <p className="text-xs">{msg}</p>}
    </div>
  );
}
