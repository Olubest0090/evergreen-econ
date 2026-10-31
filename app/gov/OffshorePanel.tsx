"use client";

import { useCallback, useEffect, useState } from "react";
import { describe } from "@/lib/resources";

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
