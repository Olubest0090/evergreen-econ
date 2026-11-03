"use client";

import { useEffect, useState } from "react";
import { RESOURCES, LABEL } from "@/lib/resources";

type Mem = {
  id: string;
  nation_id: number;
  leader_name: string | null;
  discord_username: string;
  status: string;
};

export default function SendClient() {
  const [members, setMembers] = useState<Mem[]>([]);
  const [from, setFrom] = useState<"offshore" | "main">("offshore");
  const [receiverType, setReceiverType] = useState<"nation" | "alliance">("nation");
  const [receiverId, setReceiverId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [note, setNote] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/gov/send", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setMsg(j.error);
        else setMembers(j.members || []);
      })
      .catch(() => setMsg("Could not load"));
  }, []);

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
          amounts,
          note: note || "Gov send",
          confirm: "SEND",
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Send failed");
      setMsg(
        j.warning
          ? j.warning
          : `Sent. Bank record #${j.record ?? "?"}${j.debited ? " · deposit debited" : " · no deposit debited"}`
      );
      setVals({});
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
          Note (in-game, max 50)
          <input
            className="input mt-1"
            maxLength={50}
            placeholder="Gov send"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          {RESOURCES.map((r) => (
            <label key={r} className="block text-[11px] text-[var(--muted)]">
              {LABEL[r] || r}
              <input
                className="input mt-1"
                inputMode="decimal"
                placeholder="0"
                value={vals[r] || ""}
                onChange={(e) => setVals((v) => ({ ...v, [r]: e.target.value }))}
              />
            </label>
          ))}
        </div>

        <button type="button" className="btn w-full" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </main>
  );
}
