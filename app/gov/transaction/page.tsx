"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { fmt } from "@/lib/resources";

type Payload = {
  member: {
    id: string;
    leader_name: string | null;
    nation_name: string | null;
    nation_id: number;
    discord_username: string;
    status: string;
  };
  deposit: Record<string, number>;
  stockpile: Record<string, number> | null;
  stockpileNote: string;
  lastAdjustment: {
    at: string;
    resource: string;
    amount: number;
    note: string | null;
    by: string;
  } | null;
  grantsTotal: Record<string, number>;
  rows: {
    id: string;
    at: string;
    type: string;
    description: string;
    resource: string;
    amount: number;
    tag?: string | null;
  }[];
};

function Inner() {
  const sp = useSearchParams();
  const id = sp.get("id") || "";
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setErr("Missing member id");
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/gov/member-tx?id=${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "Failed");
        setData(j);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  function grid(title: string, obj: Record<string, number> | null | undefined, empty: string) {
    const entries = Object.entries(obj || {}).filter(([, v]) => Number(v) !== 0);
    return (
      <section className="card space-y-2">
        <h2 className="text-sm font-semibold text-[var(--muted)]">{title}</h2>
        {!entries.length ? (
          <p className="text-xs text-[var(--muted)]">{empty}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {entries.map(([k, v]) => (
              <div key={k} className="rounded-xl bg-black/25 p-2.5">
                <p className="text-[10.5px] text-[var(--muted)]">{k}</p>
                <p className="font-bold">
                  {k === "money" ? "$" : ""}
                  {fmt(v)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  function downloadCsv() {
    if (!data?.rows?.length) return;
    const lines = ["When_UTC,Type,Description,Resource,Amount,Tag"];
    for (const r of data.rows) {
      const cells = [
        new Date(r.at).toISOString(),
        r.type,
        `"${(r.description || "").replace(/"/g, '""')}"`,
        r.resource,
        r.amount,
        r.tag || "",
      ];
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `member-${data.member.nation_id}-tx.csv`;
    a.click();
  }

  if (loading) {
    return <p className="p-4 text-sm text-[var(--muted)]">Loading…</p>;
  }
  if (err || !data) {
    return (
      <main className="p-4">
        <a href="/gov" className="text-xs text-[var(--muted)]">
          ← Gov
        </a>
        <p className="mt-3 text-sm text-[var(--danger)]">{err || "Not found"}</p>
      </main>
    );
  }

  const m = data.member;

  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-3 px-3 pb-24 pt-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <a href="/gov" className="text-xs text-[var(--muted)]">
          ← Gov
        </a>
        <button type="button" className="btn-ghost text-xs" onClick={downloadCsv}>
          Download CSV
        </button>
      </div>
      <h1 className="text-lg font-bold">
        {m.leader_name || m.discord_username}{" "}
        <span className="text-sm font-normal text-[var(--muted)]">
          #{m.nation_id} · {m.nation_name}
        </span>
      </h1>
      <p className="text-xs text-[var(--muted)]">
        Status: {m.status} · Discord: {m.discord_username}
      </p>

      {grid("Site deposit (balance)", data.deposit, "No site balance")}
      <section className="card space-y-2">
        <h2 className="text-sm font-semibold text-[var(--muted)]">In-game stockpile</h2>
        <p className="text-[10.5px] text-[var(--muted)]">{data.stockpileNote}</p>
        {data.stockpile && Object.keys(data.stockpile).length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(data.stockpile)
              .filter(([, v]) => Number(v) !== 0)
              .map(([k, v]) => (
                <div key={k} className="rounded-xl bg-black/25 p-2.5">
                  <p className="text-[10.5px] text-[var(--muted)]">{k}</p>
                  <p className="font-bold">
                    {k === "money" ? "$" : ""}
                    {fmt(v)}
                  </p>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">No stockpile data</p>
        )}
      </section>

      <section className="card space-y-1 text-xs">
        <h2 className="text-sm font-semibold text-[var(--muted)]">Last deposit adjustment</h2>
        {data.lastAdjustment ? (
          <>
            <p>
              {data.lastAdjustment.amount >= 0 ? "+" : ""}
              {fmt(data.lastAdjustment.amount)} {data.lastAdjustment.resource}
            </p>
            <p className="text-[var(--muted)]">
              By <strong>{data.lastAdjustment.by}</strong> ·{" "}
              {new Date(data.lastAdjustment.at).toLocaleString()}
            </p>
            {data.lastAdjustment.note && <p>Note: {data.lastAdjustment.note}</p>}
          </>
        ) : (
          <p className="text-[var(--muted)]">No staff adjustments yet</p>
        )}
      </section>

      {grid("Grants received (paid)", data.grantsTotal, "No grants recorded")}

      <section className="card !p-0 overflow-x-auto">
        <h2 className="p-3 text-sm font-semibold text-[var(--muted)]">Full history</h2>
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-y border-[var(--border)] text-[var(--muted)]">
              <th className="p-2">When</th>
              <th className="p-2">Type</th>
              <th className="p-2">Description</th>
              <th className="p-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--border)]/50">
                <td className="p-2 whitespace-nowrap text-[var(--muted)]">
                  {r.at ? new Date(r.at).toLocaleString() : "—"}
                </td>
                <td className="p-2 capitalize">{r.type}</td>
                <td className="p-2 max-w-[14rem] truncate">{r.description}</td>
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
        {!data.rows.length && <p className="p-3 text-[var(--muted)]">No rows</p>}
      </section>
    </main>
  );
}

export default function MemberTransactionPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-[var(--muted)]">Loading…</p>}>
      <Inner />
    </Suspense>
  );
}
