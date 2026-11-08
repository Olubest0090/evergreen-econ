"use client";

import { useCallback, useEffect, useState } from "react";
import { RESOURCES, LABEL } from "@/lib/resources";

type Mem = {
  id: string;
  nation_id: number;
  leader_name: string | null;
  discord_username: string;
  status: string;
};

type HistRow = {
  id: string;
  actor_discord_id: string | null;
  action: string;
  details: {
    from?: string;
    receiver?: number;
    receiverType?: string;
    amounts?: Record<string, number>;
    note?: string;
    memberId?: string | null;
    memberNation?: number | null;
    bankRecord?: string | number | null;
    depositDebited?: boolean;
    error?: string;
  } | null;
  created_at: string;
};

function fmtAmt(amounts?: Record<string, number> | null) {
  if (!amounts) return "—";
  return Object.entries(amounts)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${LABEL[k as keyof typeof LABEL] || k} ${Number(v).toLocaleString()}`)
    .join(", ");
}

export default function SendClient() {
  const [members, setMembers] = useState<Mem[]>([]);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [from, setFrom] = useState<"offshore" | "main">("offshore");
  const [receiverType, setReceiverType] = useState<"nation" | "alliance">("nation");
  const [receiverId, setReceiverId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [note, setNote] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/gov/send", { cache: "no-store" });
      const j = await r.json();
      if (j.error) setMsg(j.error);
      else {
        setMembers(j.members || []);
        setHistory(j.history || []);
      }
    } catch {
      setMsg("Could not load");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    setMsg("");
    const amounts: Record<string, number> = {};
    for (const [k, v] of Object.entries(vals)) {
      const n = Number(String(v).replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) amounts[k] = n;
    }
    if (!Object.keys(amounts).length) {
      setMsg("Enter at least one amount");
      return;
    }
    if (!receiverId.trim()) {
      setMsg("Enter the receiver nation or alliance ID");
      return;
    }
    const typed = window.prompt(
      memberId
        ? "This will send from the alliance bank AND deduct the chosen member's deposit. Type SEND to confirm."
        : "This will send from the alliance bank only (no member deposit touched). Type SEND to confirm."
    );
    if (typed !== "SEND") {
      setMsg("Cancelled");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/gov/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          receiverType,
          receiverId: Number(receiverId),
          memberId: memberId || null,
          note,
          amounts,
          confirm: "SEND",
        }),
      });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "Send failed");
      setMsg(
        j.warning
          ? j.warning
          : `Sent. Bank record #${j.record ?? "?"}${j.debited ? " · deposit debited" : ""}`
      );
      setVals({});
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-3 px-3 pb-24 pt-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">
          <span className="grad-text">Send</span> funds
        </h1>
        <a href="/gov" className="text-xs text-[var(--muted)]">
          ← Gov
        </a>
      </div>

      <p className="text-xs text-[var(--muted)]">
        Send from the main or offshore alliance bank to any nation or alliance.
        Optionally pick a member whose <strong>site deposit</strong> is reduced by the same amounts.
        Leave member empty to only move alliance bank funds (no deposit change).
      </p>

      {msg && <p className="card !p-2.5 text-xs">{msg}</p>}

      <div className="card space-y-3">
        <label className="block text-xs text-[var(--muted)]">
          From bank
          <select
            className="input mt-1"
            value={from}
            onChange={(e) => setFrom(e.target.value as "offshore" | "main")}
          >
            <option value="offshore">Offshore</option>
            <option value="main">Main (Evergreen)</option>
          </select>
        </label>

        <label className="block text-xs text-[var(--muted)]">
          Receiver type
          <select
            className="input mt-1"
            value={receiverType}
            onChange={(e) => setReceiverType(e.target.value as "nation" | "alliance")}
          >
            <option value="nation">Nation</option>
            <option value="alliance">Alliance</option>
          </select>
        </label>

        <label className="block text-xs text-[var(--muted)]">
          Receiver ID
          <input
            className="input mt-1"
            inputMode="numeric"
            placeholder={receiverType === "nation" ? "Nation ID" : "Alliance ID"}
            value={receiverId}
            onChange={(e) => setReceiverId(e.target.value)}
          />
        </label>

        <label className="block text-xs text-[var(--muted)]">
          Debit member deposit (optional)
          <select
            className="input mt-1"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
          >
            <option value="">— None (alliance bank only) —</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.leader_name || m.discord_username} (#{m.nation_id})
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs text-[var(--muted)]">
          Note
          <input
            className="input mt-1"
            maxLength={50}
            placeholder="Optional note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {RESOURCES.map((r) => (
            <label key={r} className="block text-[11px] text-[var(--muted)]">
              {LABEL[r] || r}
              <input
                className="input mt-1"
                inputMode="decimal"
                placeholder="0"
                value={vals[r] || ""}
                onChange={(e) => setVals((prev) => ({ ...prev, [r]: e.target.value }))}
              />
            </label>
          ))}
        </div>

        <button type="button" className="btn w-full" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>

      {/* History of all Send-page transactions */}
      <div className="card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Send history</h2>
          <button
            type="button"
            className="text-[11px] text-[var(--muted)] underline"
            disabled={busy}
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          Last 50 sends from this tool (success and failed).
        </p>

        {history.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">No sends recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((h) => {
              const d = h.details || {};
              const ok = h.action === "gov_send";
              const failed = h.action !== "gov_send";
              return (
                <li
                  key={h.id}
                  className="rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2 text-[11px] leading-relaxed"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={ok ? "font-semibold text-[var(--accent)]" : "font-semibold text-[var(--danger)]"}>
                      {ok ? "Sent" : h.action === "gov_send_ledger_failed" ? "Sent · ledger fail" : "Failed"}
                    </span>
                    <span className="text-[var(--muted)]">
                      {new Date(h.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    {(d.from === "source" ? "Main" : "Offshore")} →{" "}
                    {d.receiverType || "?"} #{d.receiver ?? "?"}
                    {d.bankRecord != null ? ` · bank #${d.bankRecord}` : ""}
                  </div>
                  <div className="text-[var(--text)]">{fmtAmt(d.amounts)}</div>
                  {d.note ? <div className="text-[var(--muted)]">Note: {d.note}</div> : null}
                  {d.depositDebited || d.memberNation ? (
                    <div className="text-[var(--muted)]">
                      Deposit debit: nation #{d.memberNation ?? "?"}
                    </div>
                  ) : (
                    <div className="text-[var(--muted)]">Alliance bank only (no deposit debit)</div>
                  )}
                  {failed && d.error ? (
                    <div className="text-[var(--danger)]">Error: {d.error}</div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
