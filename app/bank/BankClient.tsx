"use client";

import { useCallback, useEffect, useState } from "react";
import AmountGrid, { toAmounts, type AmountText } from "@/app/components/AmountGrid";
import { RESOURCES, LABEL, describe, fmt } from "@/lib/resources";

type W = {
  id: string;
  amounts: Record<string, number>;
  status: string;
  requested_at: string;
  error: string | null;
  recipient_nation_id: number | null;
  recipient_is_self: boolean;
  tag?: string | null;
};

const STATUS_TEXT: Record<string, string> = {
  pending_approval: "waiting for approval",
  approved: "approved, being sent",
  sent: "sent",
  failed: "failed (returned to balance)",
  denied: "denied (returned to balance)",
};
const chipFor = (s: string) =>
  s === "sent" ? "chip-ok" : s === "failed" || s === "denied" ? "chip-bad" : "chip-gold";

export default function BankClient({ balances, staff }: { balances: Record<string, number>; staff: boolean }) {
  const [amounts, setAmounts] = useState<AmountText>({});
  const [list, setList] = useState<W[] | null>(null);
  const [recipient, setRecipient] = useState("");
  const [tag, setTag] = useState<"DEPOSIT" | "GRANT" | "IGNORE" | "">("");
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
    if (!tag) {
      setMsg("Choose a tag: DEPOSIT, GRANT, or IGNORE");
      return;
    }
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
        body: JSON.stringify({
          amounts: parsed.amounts,
          recipient: recipient.trim(),
          tag,
        }),
      });
      const json = await res.json().catch(() => ({}));
      // DEPOSIT may return 422 when send fails but refunded
      if (!res.ok) {
        setMsg(
          json.message ||
            json.error ||
            "Could not complete withdrawal"
        );
        await load();
        return;
      }
      setAmounts({});
      setRecipient("");
      setTag("");
      if (tag === "DEPOSIT") {
        if (json.auto_send && json.status === "sent") {
          setMsg(
            json.message ||
              "Sent from offshore. Check in-game bank / nation resources."
          );
        } else if (json.auto_send === false && json.status === "failed") {
          setMsg(
            json.message ||
              json.error ||
              "Could not send in-game. Site balance was refunded if possible."
          );
        } else {
          setMsg(json.message || "DEPOSIT processed.");
        }
        await load();
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setMsg(
          "GRANT queued for staff. When they approve, it sends from offshore automatically (does not deduct your deposit balance)."
        );
        await load();
      }
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
                <p className="font-bold">
                  {k === "money" ? "$" : ""}
                  {fmt(balances[k])}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="mb-1 text-sm font-semibold text-[var(--muted)]">Deposit</h2>
        <p className="text-sm">
          Deposit your money/resources here:{" "}
          <a
            href="https://politicsandwar.com/alliance/id=15590&display=bank"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[var(--accent)] underline underline-offset-2"
          >
            Evergreen Bank
          </a>
          . Your balance will be updated automatically once your deposit appears in the
          alliance bank records.
        </p>
      </section>

      <section className="card">
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Withdraw / transfer</h2>
        <p className="mb-2 text-[11px] text-[var(--muted)]">
          <strong>DEPOSIT</strong> deducts your site balance and pays from offshore automatically.
          <strong> GRANT</strong> does not deduct your deposit balance — staff approve the request,
          then it is automatically sent from offshore.
          {staff ? " IGNORE is available to Econ staff." : ""}
        </p>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(["DEPOSIT", "GRANT", ...(staff ? ["IGNORE" as const] : [])] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`btn-ghost text-xs ${tag === t ? "!border-[var(--accent)] !text-[var(--accent)]" : ""}`}
              onClick={() => setTag(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="mb-3 block text-[11px] text-[var(--muted)]">
          Send to nation ID (leave empty for your own nation)
          <input
            className="input mt-0.5"
            inputMode="numeric"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Your own nation"
          />
        </label>
        <AmountGrid value={amounts} onChange={setAmounts} />
        {msg && <p className="mt-2 text-sm text-[var(--accent)]">{msg}</p>}
        <button type="button" disabled={busy} onClick={submit} className="btn mt-3 w-full">
          {busy ? "Sending…" : "Request withdrawal"}
        </button>
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
                  {w.tag ? `[${w.tag}] ` : ""}
                  {describe(w.amounts)}
                  {!w.recipient_is_self && w.recipient_nation_id
                    ? ` → #${w.recipient_nation_id}`
                    : ""}
                </span>
                <span className={`chip shrink-0 ${chipFor(w.status)}`}>
                  {STATUS_TEXT[w.status] ?? w.status}
                </span>
              </div>
              {w.error ? (
                <p className="mt-0.5 text-[11px] text-[var(--danger)]">{w.error}</p>
              ) : null}
              <p className="text-[10.5px] text-[var(--muted)]">
                {new Date(w.requested_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
