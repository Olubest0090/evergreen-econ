"use client";

import { useState } from "react";
import { LABEL, fmt } from "@/lib/resources";

type Quote = {
  ok: true;
  grantType: string;
  nationId: number;
  label: string;
  amounts: Record<string, number>;
  breakdown: string[];
  meta: Record<string, unknown>;
};

function amountsLine(a: Record<string, number>) {
  return Object.entries(a)
    .filter(([, v]) => v)
    .map(([k, v]) => `${LABEL[k] || k} ${k === "money" ? "$" : ""}${fmt(v)}`)
    .join(" · ");
}

export default function GrowthGrantPanel() {
  const [grantType, setGrantType] = useState<"city" | "infra" | "land" | "project">("city");
  const [nationId, setNationId] = useState("");
  const [cityCount, setCityCount] = useState("1");
  const [targetInfra, setTargetInfra] = useState("1500");
  const [targetLand, setTargetLand] = useState("2000");
  const [projectName, setProjectName] = useState("Urban Planning");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function doQuote() {
    setBusy(true);
    setMsg("");
    setQuote(null);
    try {
      const res = await fetch("/api/gov/grants", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "quote",
          nationId: Number(nationId),
          grantType,
          cityCount: Number(cityCount),
          targetInfra: Number(targetInfra),
          targetLand: Number(targetLand),
          projectName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Quote failed");
      setQuote(data as Quote);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Quote failed");
    } finally {
      setBusy(false);
    }
  }

  async function doExecute(send: boolean) {
    if (!quote) return;
    const label = send
      ? `Send ${amountsLine(quote.amounts)} from offshore to ${quote.label} and record grant?`
      : `Record grant only (no bank send) for ${quote.label}?`;
    if (!window.confirm(label)) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/gov/grants", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          nationId: quote.nationId,
          grantType: quote.grantType,
          cityCount: Number(cityCount),
          targetInfra: Number(targetInfra),
          targetLand: Number(targetLand),
          projectName,
          send,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMsg(
        data.sent
          ? `Sent from offshore · grant ${data.grantId}${data.bankRecord ? ` · bank #${data.bankRecord}` : ""}`
          : `Grant recorded ${data.grantId} (not sent in-game)`
      );
      setQuote(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold">Growth grant (city / infra / land / project)</h2>
        <p className="text-xs text-[var(--muted)]">
          Live nation data + P&amp;W formulas (planning projects, CCE, policies). Send pays from
          the offshore bank and records a site grant.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["city", "infra", "land", "project"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`btn-ghost ${grantType === t ? "!border-[var(--accent)] !text-[var(--accent)]" : ""}`}
            onClick={() => {
              setGrantType(t);
              setQuote(null);
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <input
        className="input"
        inputMode="numeric"
        placeholder="Nation ID"
        value={nationId}
        onChange={(e) => setNationId(e.target.value)}
      />

      {grantType === "city" && (
        <input className="input" inputMode="numeric" placeholder="Cities to buy" value={cityCount} onChange={(e) => setCityCount(e.target.value)} />
      )}
      {grantType === "infra" && (
        <input className="input" inputMode="numeric" placeholder="Target infra level" value={targetInfra} onChange={(e) => setTargetInfra(e.target.value)} />
      )}
      {grantType === "land" && (
        <input className="input" inputMode="numeric" placeholder="Target land level" value={targetLand} onChange={(e) => setTargetLand(e.target.value)} />
      )}
      {grantType === "project" && (
        <input className="input" placeholder="Project name (e.g. Urban Planning)" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
      )}

      <button type="button" className="btn w-full" disabled={busy || !nationId} onClick={() => void doQuote()}>
        {busy ? "Working…" : "Quote cost"}
      </button>

      {quote && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3 text-sm">
          <p className="font-semibold">{quote.label}</p>
          <p>{amountsLine(quote.amounts)}</p>
          <ul className="list-disc pl-4 text-xs text-[var(--muted)]">
            {quote.breakdown.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 pt-1">
            <button type="button" className="btn" disabled={busy} onClick={() => void doExecute(true)}>
              Send from offshore + record grant
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void doExecute(false)}>
              Record grant only (no send)
            </button>
          </div>
        </div>
      )}

      {msg && <p className="text-sm text-[var(--muted)]">{msg}</p>}
    </section>
  );
}
