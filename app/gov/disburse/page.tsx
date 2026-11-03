"use client";

import { useState } from "react";
import Link from "next/link";

type Row = {
  nationId: number;
  nationName: string;
  leaderName: string;
  cities: number;
  need: Record<string, number>;
  skipped?: string;
};

function fmtNeed(n: Record<string, number>) {
  return Object.entries(n)
    .map(([k, v]) => `${v.toLocaleString()} ${k}`)
    .join(", ");
}

export default function DisbursePage() {
  const [taxId, setTaxId] = useState("");
  const [days, setDays] = useState("7");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function preview() {
    setMsg("");
    setBusy(true);
    try {
      const res = await fetch(
        `/api/gov/disburse?taxId=${encodeURIComponent(taxId)}&days=${encodeURIComponent(days || "7")}`
      );
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error || "Preview failed");
        setRows(null);
        return;
      }
      setRows(json.rows || []);
      setMsg(`Tax ${json.taxId} · ${json.days}d · ${json.rows?.length ?? 0} nations`);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!confirm("Send from OFFSHORE to all nations with a need? Note will be Grant.")) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/gov/disburse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taxId: Number(taxId),
          days: Number(days) || 7,
          confirm: "SEND",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error || "Send failed");
        return;
      }
      setMsg(
        `Sent ${json.sent?.length ?? 0}, failed ${json.failed?.length ?? 0}, skipped ${json.skipped ?? 0}`
      );
      if (json.failed?.length) {
        setMsg(
          (m) =>
            `${m}\nFails: ` +
            json.failed.map((f: { nationId: number; error: string }) => `#${f.nationId}: ${f.error}`).join("; ")
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg space-y-4 px-4 pb-24 pt-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Disburse (tax bracket)</h1>
        <Link href="/gov" className="text-sm text-[var(--muted)]">
          ← Gov
        </Link>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Pays from <strong>offshore</strong> only. Bank note is always <strong>Grant</strong>.
        Need = warchest target minus current stock (or full target if stock unknown). Default{" "}
        <strong>7 days</strong>.
      </p>
      <section className="card space-y-3">
        <label className="block text-xs text-[var(--muted)]">
          Tax bracket ID (in-game)
          <input
            className="input mt-1"
            inputMode="numeric"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            placeholder="e.g. 12345"
          />
        </label>
        <label className="block text-xs text-[var(--muted)]">
          Days
          <input
            className="input mt-1"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <button type="button" className="btn flex-1" disabled={busy || !taxId} onClick={preview}>
            {busy ? "…" : "Preview"}
          </button>
          <button
            type="button"
            className="btn-ghost flex-1"
            disabled={busy || !rows?.some((r) => Object.keys(r.need || {}).length)}
            onClick={send}
          >
            Send from offshore
          </button>
        </div>
        {msg && <p className="whitespace-pre-wrap text-sm text-[var(--accent)]">{msg}</p>}
      </section>
      {rows && (
        <section className="card">
          <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Nations</h2>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {rows.map((r) => (
              <li key={r.nationId} className="py-2">
                <div className="font-medium">
                  {r.leaderName}{" "}
                  <span className="text-[var(--muted)]">
                    #{r.nationId} · {r.cities}c
                  </span>
                </div>
                {r.skipped ? (
                  <p className="text-xs text-[var(--muted)]">{r.skipped}</p>
                ) : (
                  <p className="text-xs">{fmtNeed(r.need)}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
