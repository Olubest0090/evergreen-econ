"use client";

import { useCallback, useEffect, useState } from "react";
import AmountGrid, { toAmounts, type AmountText } from "@/app/components/AmountGrid";
import { RESOURCES, LABEL, describe, fmt } from "@/lib/resources";

type W = { id: string; amounts: Record<string, number>; status: string; requested_at: string; error: string | null; recipient_nation_id: number | null; recipient_is_self: boolean };

const STATUS_TEXT: Record<string, string> = {
  pending_approval: "waiting for approval",
  approved: "approved, being sent",
  sent: "sent",
  failed: "failed (returned to balance)",
  denied: "denied (returned to balance)",
};
const chipFor = (s: string) => (s === "sent" ? "chip-ok" : s === "failed" || s === "denied" ? "chip-bad" : "chip-gold");

export default function BankClient({ balances }: { balances: Record<string, number> }) {
  const [amounts, setAmounts] = useState<AmountText>({});
  const [list, setList] = useState<W[] | null>(null);
  const [recipient, setRecipient] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/withdrawals", { cache: "no-store" });
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok) setList(json.withdrawals);
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
      const res = await fetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amounts: parsed.amounts, recipient: recipient.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json.error || "Could not request withdrawal");
        return;
      }
      setAmounts({});
      setRecipient("");
      setMsg(json.status === "approved" ? "Requested. It is approved and will be sent shortly." : "Requested. Econ staff will review it.");
      await load();
      setTimeout(() => window.location.reload(), 1200);
    } finally {
      setBusy(false);
    }
  }

  const owned = RESOURCES.filter((r) => (balances[r] ?? 0) !== 0);

  return (
    <main className="mx-auto min-h-screen max-w-lg space-y-4 px-4 pb-24 pt-5">
      <h1 className="text-xl font-bold">Bank</h1>

      <section className="card">
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Your balance</h2>
        {owned.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Empty for now.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {owned.map((k) => (
              <div key={k} className="rounded-xl bg-black/25 p-2.5">
                <p className="text-[10.5px] text-[var(--muted)]">{LABEL[k]}</p>
                <p className="font-bold">{k === "money" ? "$" : ""}{fmt(balances[k])}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="mb-1 text-sm font-semibold text-[var(--muted)]">Deposit</h2>
        <p className="text-sm">
          Send money or resources to the Evergreen alliance bank in the game. Once it shows in the bank records, econ staff credit your balance here.
        </p>
      </section>

      <section className="card">
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Withdraw</h2>
        <label className="mb-3 block text-[11px] text-[var(--muted)]">
          Send to nation ID (leave empty to send to your own nation)
          <input className="input mt-0.5" inputMode="numeric" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Your own nation" />
        </label>
        <AmountGrid value={amounts} onChange={setAmounts} />
        {msg && <p className="mt-2 text-sm text-[var(--accent)]">{msg}</p>}
        <button type="button" disabled={busy} onClick={submit} className="btn mt-3 w-full">
          {busy ? "Sending…" : "Request withdrawal"}
        </button>
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          The amount is held from your balance straight away and returned if it is denied. Withdrawals to another nation always need econ staff approval.
        </p>
      </section>

      <section className="card">
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Your withdrawals</h2>
        {!list && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {list && list.length === 0 && <p className="text-sm text-[var(--muted)]">None yet.</p>}
        <ul className="divide-y divide-[var(--border)]">
          {list?.map((w) => (
            <li key={w.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {describe(w.amounts)}
                  {!w.recipient_is_self && w.recipient_nation_id ? ` → nation #${w.recipient_nation_id}` : ""}
                </span>
                <span className={`chip shrink-0 ${chipFor(w.status)}`}>{STATUS_TEXT[w.status] ?? w.status}</span>
              </div>
              <p className="text-[10.5px] text-[var(--muted)]">{new Date(w.requested_at).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
