"use client";

import { useCallback, useEffect, useState } from "react";
import AmountGrid, { toAmounts, type AmountText } from "@/app/components/AmountGrid";
import { describe } from "@/lib/resources";

type R = {
  id: string;
  kind: "grant" | "warchest";
  status: string;
  amounts: Record<string, number>;
  purpose: string | null;
  decision_note: string | null;
  created_at: string;
};

const chipFor = (s: string) =>
  s === "paid" ? "chip-ok" : s === "denied" || s === "cancelled" ? "chip-bad" : "chip-gold";

export default function RequestsClient() {
  const [kind, setKind] = useState<"grant" | "warchest">("warchest");
  const [amounts, setAmounts] = useState<AmountText>({});
  const [purpose, setPurpose] = useState("");
  const [list, setList] = useState<R[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/requests", { cache: "no-store" });
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok) setList(json.requests);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    setMsg("");
    const parsed = toAmounts(amounts);
    if ("error" in parsed) {
      setMsg(parsed.error);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, amounts: parsed.amounts, purpose }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json.error || "Could not send request");
        return;
      }
      setAmounts({});
      setPurpose("");
      setMsg("Request sent. Econ staff will review it.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", id }),
    });
    await load();
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg space-y-4 px-4 pb-24 pt-5">
      <h1 className="text-xl font-bold">Requests</h1>

      <section className="card">
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">New request</h2>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(["warchest", "grant"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`pill justify-center ${kind === k ? "pill-on" : ""}`}
            >
              {k === "warchest" ? "Warchest support" : "Grant"}
            </button>
          ))}
        </div>
        <AmountGrid value={amounts} onChange={setAmounts} />
        <label className="mt-3 block text-[11px] text-[var(--muted)]">
          What is it for?
          <textarea
            className="input mt-0.5"
            rows={3}
            maxLength={400}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Short reason for econ staff"
          />
        </label>
        {msg && <p className="mt-2 text-sm text-[var(--accent)]">{msg}</p>}
        <button type="button" disabled={busy} onClick={submit} className="btn mt-3 w-full">
          {busy ? "Sending…" : "Send request"}
        </button>
      </section>

      <section className="card">
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Your requests</h2>
        {!list && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {list && list.length === 0 && <p className="text-sm text-[var(--muted)]">None yet.</p>}
        <ul className="divide-y divide-[var(--border)]">
          {list?.map((r) => (
            <li key={r.id} className="py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium capitalize">{r.kind}</span>
                <span className={`chip ${chipFor(r.status)}`}>{r.status}</span>
              </div>
              <p>{describe(r.amounts)}</p>
              {r.purpose && <p className="text-xs text-[var(--muted)]">{r.purpose}</p>}
              {r.decision_note && <p className="text-xs text-[var(--gold)]">Staff note: {r.decision_note}</p>}
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10.5px] text-[var(--muted)]">{new Date(r.created_at).toLocaleString()}</span>
                {r.status === "pending" && (
                  <button type="button" className="btn-ghost" onClick={() => cancel(r.id)}>
                    Cancel
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
