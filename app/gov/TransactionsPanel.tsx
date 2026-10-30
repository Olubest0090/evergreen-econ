"use client";

import { useCallback, useEffect, useState } from "react";
import { fmt } from "@/lib/resources";

type Row = {
  id: string;
  at: string;
  account: string;
  nationId: number | null;
  type: string;
  description: string;
  resource: string;
  amount: number;
};

type Payload = {
  moneyIn: number;
  moneyOut: number;
  count: number;
  rows: Row[];
};

function csvEscape(s: string) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function TransactionsPanel() {
  const [period, setPeriod] = useState("30");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const params = new URLSearchParams({ period });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/gov/transactions?${params}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Failed to load");
      setData(j as Payload);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, q]);

  useEffect(() => {
    void load();
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps -- search via button

  function downloadCsv() {
    if (!data?.rows?.length) return;
    const header = ["When_UTC", "Account", "NationId", "Type", "Description", "Resource", "Amount"];
    const lines = [header.join(",")];
    for (const r of data.rows) {
      lines.push(
        [
          csvEscape(new Date(r.at).toISOString()),
          csvEscape(r.account),
          r.nationId ?? "",
          csvEscape(r.type),
          csvEscape(r.description),
          csvEscape(r.resource),
          r.amount,
        ].join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evergreen-econ-tx-${period}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const periods: [string, string][] = [
    ["7", "Last 7 days"],
    ["30", "Last 30 days"],
    ["90", "Last 90 days"],
    ["all", "All time"],
  ];

  return (
    <div className="space-y-3 text-sm">
      <div>
        <h2 className="font-semibold">Transactions & spreadsheet</h2>
        <p className="text-xs text-[var(--muted)]">
          Individual ledger, withdrawals and paid requests. Money totals count money only; other
          resources show as rows. Times UTC.
        </p>
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {periods.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`pill ${period === k ? "pill-on" : ""}`}
            onClick={() => setPeriod(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Search leader, nation, discord, or nation id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void load()}
        />
        <button type="button" className="btn-ghost" onClick={() => void load()}>
          Search
        </button>
      </div>

      <button type="button" className="btn-ghost w-full" disabled={!data?.rows?.length} onClick={downloadCsv}>
        Download spreadsheet (CSV)
      </button>

      {msg && <p className="text-xs text-[var(--danger)]">{msg}</p>}
      {loading && <p className="text-[var(--muted)]">Loading…</p>}

      {data && !loading && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="card">
              <p className="text-[11px] text-[var(--muted)]">Money in</p>
              <p className="text-lg font-bold text-[var(--accent)]">${fmt(data.moneyIn)}</p>
            </div>
            <div className="card">
              <p className="text-[11px] text-[var(--muted)]">Money out</p>
              <p className="text-lg font-bold">${fmt(data.moneyOut)}</p>
            </div>
            <div className="card">
              <p className="text-[11px] text-[var(--muted)]">Rows</p>
              <p className="text-lg font-bold">{data.count}</p>
            </div>
          </div>

          <div className="card !p-0 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                  <th className="p-2 font-medium">When</th>
                  <th className="p-2 font-medium">Account</th>
                  <th className="p-2 font-medium">Type</th>
                  <th className="p-2 font-medium">Description</th>
                  <th className="p-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)]/60">
                    <td className="p-2 whitespace-nowrap text-[var(--muted)]">
                      {new Date(r.at).toLocaleString()}
                    </td>
                    <td className="p-2">{r.account}</td>
                    <td className="p-2 capitalize">{r.type}</td>
                    <td className="p-2 max-w-[12rem] truncate">{r.description}</td>
                    <td
                      className={`p-2 text-right whitespace-nowrap ${
                        r.amount >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"
                      }`}
                    >
                      {r.amount >= 0 ? "+" : ""}
                      {r.resource === "money" ? "$" : ""}
                      {fmt(r.amount)}
                      {r.resource !== "money" ? ` ${r.resource}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && (
              <p className="p-3 text-[var(--muted)]">No transactions in this period.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
