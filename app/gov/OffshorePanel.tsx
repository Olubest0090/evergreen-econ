"use client";

import { useCallback, useEffect, useState } from "react";
import { RESOURCES, describe, parseAmount } from "@/lib/resources";

type Cfg = { offshore_alliance_id?: number; banker_nation_id?: number; source_alliance_id?: number; label?: string };
type Keys = { botKey: boolean; botKeyApiKey: boolean; bankKey: boolean; offshoreKey: boolean };
type Plan = { sourceId: number; receiver: number; receiverType: "nation" | "alliance"; amounts: Record<string, number> };

async function call(body: Record<string, unknown>) {
  const res = await fetch("/api/gov/offshore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Failed (${res.status})`);
  return j;
}


type Books = { net: Record<string, number>; worth?: { total: number; label: string } | null; live?: boolean };

function BooksCard() {
  const [books, setBooks] = useState<Books | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/gov/books", { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { setBooks(j as Books); setMsg(""); }
    else setMsg(j.error || "Could not load the offshore bank");
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="card space-y-2">
      <h3 className="font-semibold">Offshore bank — live total</h3>
      <p className="text-[11px] text-[var(--muted)]">
        Read directly from the offshore alliance&apos;s bank in P&amp;W right now. If the offshore is
        shared with anyone else, their holdings are included too — this is the bank&apos;s real total,
        not just Evergreen&apos;s share.
      </p>

      {!books && !msg && <p className="text-xs text-[var(--muted)]">Loading…</p>}

      {books && (
        <div className="space-y-1 text-xs">
          <p className="text-sm font-semibold">
            {Object.keys(books.net).length ? describe(books.net) : "The offshore bank is empty."}
          </p>
          {books.worth && (
            <p className="text-sm font-semibold text-[var(--accent)]">
              Estimated total value: {books.worth.label}
            </p>
          )}
          {!books.worth && Object.keys(books.net).length > 0 && (
            <p className="text-[11px] text-[var(--muted)]">
              Could not price this against today&apos;s market (prices unavailable right now).
            </p>
          )}
          <p className="text-[10px] text-[var(--muted)]">
            Valued using P&amp;W&apos;s latest daily average market prices, not a live trade price.
          </p>
        </div>
      )}

      {msg && <p className="text-xs text-[var(--accent)]">{msg}</p>}
    </div>
  );
}

type Tracking = {
  cursor: { start?: string; main?: number; offshore?: number };
  lastRun: string | null;
  lastResult: { fetched?: number; credited?: number; pending?: number; ignored?: number; booksCredits?: number; dms?: number; errors?: string[]; skipped?: boolean } | null;
  pendingUnclaimed: number;
  trustedDepositors: number[];
  canConfigure: boolean;
};

function TrackingCard() {
  const [t, setT] = useState<Tracking | null>(null);
  const [depositors, setDepositors] = useState("");
  const [report, setReport] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/gov/bankrecs", { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { setT(j as Tracking); setDepositors((j.trustedDepositors ?? []).join(", ")); }
    else setMsg(j.error || "Could not load deposit tracking");
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/gov/bankrecs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Failed");
    return j;
  }
  async function wrap(fn: () => Promise<void>) {
    setBusy(true); setMsg("");
    try { await fn(); } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(false); }
  }

  const r = t?.lastResult;
  return (
    <div className="card space-y-2">
      <h3 className="font-semibold">In-game deposits to the site</h3>
      <p className="text-[11px] text-[var(--muted)]">
        Deposits made in the game are credited to the member automatically. A deposit from someone who hasn&apos;t joined the site waits and is credited the moment they log in. Notes with #ignore are skipped.
      </p>
      {!t && <p className="text-xs text-[var(--muted)]">Loading…</p>}
      {t && (
        <div className="space-y-1 text-xs">
          <p><span className="text-[var(--muted)]">Counting deposits made after:</span> {t.cursor.start ? new Date(t.cursor.start).toLocaleString() : "not started yet (starts at the first check)"}</p>
          <p><span className="text-[var(--muted)]">Last check:</span> {t.lastRun ? new Date(t.lastRun).toLocaleString() : "never"}</p>
          {r && (
            <p><span className="text-[var(--muted)]">Last result:</span> {r.credited ?? 0} credited · {r.pending ?? 0} waiting for new members · {r.booksCredits ?? 0} offshore top-ups · {r.dms ?? 0} DMs sent · {r.ignored ?? 0} skipped</p>
          )}
          {r?.errors && r.errors.length > 0 && <p className="text-[var(--danger)]">{r.errors.slice(0, 3).join(" | ")}</p>}
          <p><span className="text-[var(--muted)]">Deposits waiting for members to join:</span> {t.pendingUnclaimed}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => wrap(async () => { const j = await post({ action: "sync" }); setMsg(j.result?.errors?.length ? "Checked, with problems (see above)." : "Checked."); await load(); })}>Check now</button>
        {t?.canConfigure && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => wrap(async () => setReport(JSON.stringify((await post({ action: "diagnose", which: "main" })).report, null, 2)))}>Check the game&apos;s bank records</button>
        )}
      </div>
      {report && <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/30 p-2 text-[11px]">{report}</pre>}
      {t?.canConfigure && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] p-2.5">
          <label className="block text-[11px] text-[var(--muted)]">
            Nations whose deposits into the offshore count as Evergreen top-ups (nation IDs, commas between)
            <input className="input mt-1" value={depositors} onChange={(e) => setDepositors(e.target.value)} placeholder="633226" />
          </label>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => wrap(async () => { await post({ action: "set_depositors", nations: depositors }); setMsg("Saved."); await load(); })}>Save top-up nations</button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => wrap(async () => {
            if (!window.confirm("Only deposits made from this moment will be counted. Continue?")) return;
            await post({ action: "set_start", start: "now" }); setMsg("Tracking restarts from now."); await load();
          })}>Start counting from now</button>

          <div className="space-y-2 rounded-xl border border-[var(--border)] p-2.5 mt-2">
            <p className="text-[11px] font-semibold">Backfill one nation from offshore bankrecs</p>
            <p className="text-[11px] text-[var(--muted)]">
              Pulls that nation&apos;s deposits into the offshore and withdrawals out to them since a date,
              nets them, and credits the site balance (e.g. Yema since 1 Nov).
            </p>
            <label className="block text-[11px] text-[var(--muted)]">
              Nation ID
              <input className="input mt-1" inputMode="numeric" id="bf-nation" placeholder="633226" defaultValue="633226" />
            </label>
            <label className="block text-[11px] text-[var(--muted)]">
              Since (ISO date)
              <input className="input mt-1" id="bf-since" defaultValue="2026-11-01T00:00:00.000Z" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => wrap(async () => {
                const nationId = Number((document.getElementById("bf-nation") as HTMLInputElement)?.value);
                const since = (document.getElementById("bf-since") as HTMLInputElement)?.value || "2026-11-01T00:00:00.000Z";
                const j = await post({ action: "offshore_backfill_preview", nationId, since });
                setReport(JSON.stringify(j.preview, null, 2));
                setMsg(`Preview: ${j.preview?.depositCount ?? 0} deposits, ${j.preview?.withdrawalCount ?? 0} withdrawals.`);
              })}>Preview net</button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => wrap(async () => {
                const nationId = Number((document.getElementById("bf-nation") as HTMLInputElement)?.value);
                const since = (document.getElementById("bf-since") as HTMLInputElement)?.value || "2026-11-01T00:00:00.000Z";
                const typed = window.prompt("Credits site balance from offshore bank history. Type CREDIT to confirm:");
                if (typed !== "CREDIT") { setMsg("Cancelled."); return; }
                const j = await post({ action: "offshore_backfill_apply", nationId, since, confirm: "CREDIT" });
                setReport(JSON.stringify(j, null, 2));
                setMsg("Credited.");
              })}>Credit net to site</button>
            </div>
          </div>
        </div>
      )}
      {msg && <p className="text-xs text-[var(--accent)]">{msg}</p>}
    </div>
  );
}

export default function OffshorePanel() {
  const [cfg, setCfg] = useState<Cfg>({});
  const [keys, setKeys] = useState<Keys | null>(null);
  const [can, setCan] = useState(false);
  const [offshoreA, setOffshoreA] = useState("");
  const [sourceA, setSourceA] = useState("");
  const [banker, setBanker] = useState("");
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [report, setReport] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoOff, setAutoOff] = useState(false);
  const [autoMin, setAutoMin] = useState("10");
  const [autoMax, setAutoMax] = useState("25");
  const [autoFire, setAutoFire] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/gov/offshore", { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(j.error || "Could not load the offshore settings");
      return;
    }
    const o = (j.offshore || {}) as Cfg;
    setCfg(o);
    setOffshoreA(o.offshore_alliance_id ? String(o.offshore_alliance_id) : "");
    setSourceA(o.source_alliance_id ? String(o.source_alliance_id) : "");
    setBanker(o.banker_nation_id ? String(o.banker_nation_id) : "");
    setLabel(o.label || "");
    setKeys(j.keys as Keys);
    setCan(!!j.canConfigure);
    setAutoOff(!!j.autoOffshore?.enabled);
    setAutoMin(String(j.autoOffshore?.minMinutes ?? 10));
    setAutoMax(String(j.autoOffshore?.maxMinutes ?? 25));
    setAutoFire(
      j.autoOffshoreState?.fireAtMs
        ? new Date(j.autoOffshoreState.fireAtMs).toLocaleString()
        : null
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function wrap(fn: () => Promise<void>) {
    setBusy(true);
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const tick = (ok: boolean) => (ok ? "✓" : "✗");

  return (
    <div className="space-y-3 text-sm">
      <div className="card space-y-2">
        <h2 className="font-semibold">Offshore bank</h2>
        <p className="text-xs text-[var(--muted)]">
          Member withdrawals are paid from the offshore bank, and the main bank can be emptied into it. Change the offshore here whenever it moves.
        </p>
        {keys && (
          <p className="text-[11px] text-[var(--muted)]">
            Keys in Vercel: VERIFIED_BOT_KEY {tick(keys.botKey)} · main bank key {tick(keys.bankKey)} · offshore key {tick(keys.offshoreKey)} · BOT_KEY_API_KEY {keys.botKeyApiKey ? "✓" : "not set"}
          </p>
        )}
      </div>

      <BooksCard />
      <TrackingCard />

      <div className="card space-y-2">
        <h3 className="font-semibold">Auto offshore (after turn)</h3>
        <p className="text-xs text-[var(--muted)]">
          When on, each P&amp;W turn (every 2 hours) the site waits a <strong>random</strong> delay between
          the minutes you set (default <strong>10–25</strong>), then empties the main bank into the offshore.
          Uses the same 1‑minute deposit cron. Runs at most once per turn.
        </p>
        {autoFire && autoOff && (
          <p className="text-[11px] text-[var(--muted)]">Next planned fire (this turn): {autoFire}</p>
        )}
        {can ? (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoOff}
                disabled={busy}
                onChange={(e) =>
                  wrap(async () => {
                    const on = e.target.checked;
                    await call({
                      action: "set_auto_offshore",
                      enabled: on,
                      minMinutes: Number(autoMin) || 10,
                      maxMinutes: Number(autoMax) || 25,
                    });
                    setAutoOff(on);
                    setMsg(on ? "Auto offshore ON (random delay after each turn)." : "Auto offshore OFF.");
                    await load();
                  })
                }
              />
              Enable auto offshore
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[11px] text-[var(--muted)]">
                Min minutes after turn
                <input className="input mt-1" inputMode="numeric" value={autoMin} onChange={(e) => setAutoMin(e.target.value)} />
              </label>
              <label className="block text-[11px] text-[var(--muted)]">
                Max minutes after turn
                <input className="input mt-1" inputMode="numeric" value={autoMax} onChange={(e) => setAutoMax(e.target.value)} />
              </label>
            </div>
            <button
              type="button"
              className="btn-ghost w-full"
              disabled={busy}
              onClick={() =>
                wrap(async () => {
                  await call({
                    action: "set_auto_offshore",
                    enabled: autoOff,
                    minMinutes: Number(autoMin) || 10,
                    maxMinutes: Number(autoMax) || 25,
                  });
                  setMsg("Saved delay window.");
                  await load();
                })
              }
            >
              Save delay window
            </button>
          </div>
        ) : (
          <p className="text-xs text-[var(--muted)]">Status: {autoOff ? "ON" : "OFF"} · {autoMin}–{autoMax} min after turn</p>
        )}
      </div>

      {can ? (
        <>
          <div className="card space-y-3">
            <h3 className="font-semibold">Offshore setup</h3>
            <label className="block text-xs text-[var(--muted)]">
              Offshore alliance ID
              <input className="input mt-1" inputMode="numeric" value={offshoreA} onChange={(e) => setOffshoreA(e.target.value)} placeholder="Offshore alliance ID" />
            </label>
            <label className="block text-xs text-[var(--muted)]">
              Main alliance ID (the bank to empty)
              <input className="input mt-1" inputMode="numeric" value={sourceA} onChange={(e) => setSourceA(e.target.value)} placeholder="15590" />
            </label>
            <label className="block text-xs text-[var(--muted)]">
              Banker nation ID in the offshore (only needed if the game can&apos;t pay an alliance directly)
              <input className="input mt-1" inputMode="numeric" value={banker} onChange={(e) => setBanker(e.target.value)} placeholder="Optional" />
            </label>
            <label className="block text-xs text-[var(--muted)]">
              Label (optional)
              <input className="input mt-1" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Offshore A" />
            </label>
            <button
              type="button"
              className="btn w-full"
              disabled={busy}
              onClick={() => wrap(async () => {
                await call({ action: "save", offshore_alliance_id: Number(offshoreA), source_alliance_id: sourceA ? Number(sourceA) : null, banker_nation_id: banker ? Number(banker) : null, label });
                setPlan(null);
                setMsg("Offshore saved.");
                await load();
              })}
            >
              Save offshore
            </button>
            {cfg.label && <p className="text-[11px] text-[var(--muted)]">Current: {cfg.label}</p>}
          </div>

          <div className="card space-y-2">
            <h3 className="font-semibold">Check the connection first</h3>
            <p className="text-xs text-[var(--muted)]">
              Tests the keys without moving anything, and shows which bank the key can reach and what the game allows.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => wrap(async () => setReport(JSON.stringify((await call({ action: "diagnose", actor: "source" })).report, null, 2)))}>
                Check main bank
              </button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => wrap(async () => setReport(JSON.stringify((await call({ action: "diagnose", actor: "offshore" })).report, null, 2)))}>
                Check offshore
              </button>
            </div>
            {report && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/30 p-2 text-[11px]">{report}</pre>}
          </div>

          <div className="card space-y-2">
            <h3 className="font-semibold">Send everything to the offshore</h3>
            <button type="button" className="btn-ghost w-full" disabled={busy || !cfg.offshore_alliance_id} onClick={() => wrap(async () => setPlan(await call({ action: "preview_send_all" })))}>
              Show what would be sent
            </button>
            {plan && (
              <div className="space-y-2 rounded-xl border border-[var(--border)] p-2.5 text-xs">
                <p>From alliance #{plan.sourceId} to {plan.receiverType === "alliance" ? `alliance #${plan.receiver}` : `nation #${plan.receiver}`}:</p>
                <p className="font-semibold">{Object.keys(plan.amounts).length ? describe(plan.amounts) : "The main bank is empty."}</p>
                {Object.keys(plan.amounts).length > 0 && (
                  <button
                    type="button"
                    className="btn w-full"
                    disabled={busy}
                    onClick={() => wrap(async () => {
                      const typed = window.prompt("This moves the whole main bank and can't be undone from the site. Type SEND to confirm:");
                      if (typed !== "SEND") {
                        setMsg("Cancelled.");
                        return;
                      }
                      const r = await call({ action: "send_all", confirm: "SEND" });
                      setPlan(null);
                      setMsg(`Sent${r.record ? ` (bank record #${r.record})` : ""}: ${describe(r.amounts)}`);
                    })}
                  >
                    Send everything now
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="card text-xs text-[var(--muted)]">Only the econ head can change the offshore or empty the main bank. You can still send approved withdrawals from the Withdrawals tab.</p>
      )}

      {msg && <p className="card !p-2.5 text-xs whitespace-pre-wrap">{msg}</p>}
    </div>
  );
}
