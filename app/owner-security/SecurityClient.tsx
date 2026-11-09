"use client";

import { useCallback, useEffect, useState } from "react";

type Alert = { level: "critical" | "warning" | "info"; text: string };
type Lockdown = {
  withdrawals: boolean;
  balance_adjust: boolean;
  grants: boolean;
  staff_manage: boolean;
  gov_send: boolean;
  disburse: boolean;
};
type EventRow = {
  id: number;
  kind: string;
  ip_address: string | null;
  discord_id: string | null;
  path: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};
type FailRow = {
  id: number;
  ip_address: string | null;
  discord_id: string | null;
  reason: string | null;
  created_at: string;
};
type LogRow = {
  id: string;
  ip_address: string | null;
  method: string;
  path: string;
  user_agent: string | null;
  created_at: string;
};
type AdminRow = {
  id: number;
  actor_discord_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

type Payload = {
  status: "Healthy" | "Warning" | "Critical";
  alerts: Alert[];
  lockdown: Lockdown;
  checks: { cronSecretSet: boolean; authSecretSet: boolean; ownerSet: boolean };
  today: { requests: number; failedLogins: number; okLogins: number };
  week: { cronDenied: number; lockdownBlocks: number; permDenied: number };
  suspiciousIps: { ip: string; fails: number }[];
  recentEvents: EventRow[];
  recentFails: FailRow[];
  recentLogs: LogRow[];
  adminActions: AdminRow[];
  financial?: {
    thresholds: {
      large_withdrawal_money: number;
      large_adjust_money: number;
      max_pending_withdrawals_per_member: number;
    };
    integrity: {
      negativeBalances: { member_id: string; resource: string; balance: number }[];
      openWithdrawals: number;
      recentAlerts: number;
      ledgerOrphans: number;
    };
    alerts: {
      id: number;
      severity: string;
      kind: string;
      member_id: string | null;
      nation_id: number | null;
      detail: Record<string, unknown>;
      created_at: string;
    }[];
  };
};

type Tab =
  | "overview"
  | "logins"
  | "events"
  | "access"
  | "admin"
  | "financial"
  | "lockdown";

const TABS: [Tab, string][] = [
  ["overview", "Overview"],
  ["logins", "Login security"],
  ["events", "Events"],
  ["access", "Access logs"],
  ["admin", "Admin trail"],
  ["financial", "Financial"],
  ["lockdown", "Emergency"],
];

const LOCK_LABELS: { key: keyof Lockdown; label: string }[] = [
  { key: "withdrawals", label: "Withdrawals" },
  { key: "balance_adjust", label: "Balance adjustments / imports" },
  { key: "grants", label: "Grant decisions" },
  { key: "gov_send", label: "Gov send" },
  { key: "disburse", label: "Disburse" },
  { key: "staff_manage", label: "Staff management" },
];

function when(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusColor(s: string) {
  if (s === "Healthy") return "#34d399";
  if (s === "Warning") return "#fbbf24";
  return "#fb7185";
}

export default function SecurityClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch("/api/owner/security", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Forbidden");
      setData(j as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setFlag(key: keyof Lockdown, value: boolean) {
    if (!data) return;
    setBusy(true);
    setMsg("");
    try {
      const flags = { ...data.lockdown, [key]: value };
      const r = await fetch("/api/owner/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_lockdown", flags }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setMsg(value ? `${key} locked` : `${key} unlocked`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    if (!window.confirm("Clear all emergency lockdown flags?")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/owner/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_lockdown" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setMsg("Lockdown cleared");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (err) {
    return (
      <main className="mx-auto max-w-3xl px-3 py-10 text-sm">
        <p className="text-[var(--danger)]">{err}</p>
        <p className="mt-2 text-[var(--muted)]">Owner session required. Path stays hidden (404) for everyone else.</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-3 py-10 text-sm text-[var(--muted)]">
        Loading security center…
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl space-y-3 px-3 pb-16 pt-4 text-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--accent)]">
            EVERGREEN ECON · OWNER ONLY
          </p>
          <h1 className="text-xl font-bold">Security Center</h1>
          <p className="text-xs text-[var(--muted)]">
            Phase 2 monitoring — access, logins, events, emergency controls.
          </p>
        </div>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void load()}>
          Refresh
        </button>
      </header>

      <div className="card flex flex-wrap items-center gap-3 !py-3">
        <span className="text-xs text-[var(--muted)]">System status</span>
        <span className="text-lg font-extrabold" style={{ color: statusColor(data.status) }}>
          {data.status}
        </span>
        <span className="text-[11px] text-[var(--muted)]">
          Cron secret {data.checks.cronSecretSet ? "✓" : "✗"} · Auth secret{" "}
          {data.checks.authSecretSet ? "✓" : "✗"} · Owner id {data.checks.ownerSet ? "✓" : "✗"}
        </span>
      </div>

      {msg && <p className="card !p-2.5 text-xs">{msg}</p>}

      <div className="flex gap-1 overflow-x-auto no-scrollbar">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`pill whitespace-nowrap ${tab === k ? "!border-[var(--accent)] !text-[var(--accent)]" : ""}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="card !p-3">
              <p className="text-[11px] text-[var(--muted)]">Requests today</p>
              <p className="text-2xl font-bold">{data.today.requests}</p>
            </div>
            <div className="card !p-3">
              <p className="text-[11px] text-[var(--muted)]">Failed logins</p>
              <p className="text-2xl font-bold">{data.today.failedLogins}</p>
            </div>
            <div className="card !p-3">
              <p className="text-[11px] text-[var(--muted)]">OK logins</p>
              <p className="text-2xl font-bold">{data.today.okLogins}</p>
            </div>
            <div className="card !p-3">
              <p className="text-[11px] text-[var(--muted)]">Cron denied (7d)</p>
              <p className="text-2xl font-bold">{data.week.cronDenied}</p>
            </div>
          </div>

          <div className="card space-y-2">
            <h2 className="font-semibold">Alerts</h2>
            <ul className="space-y-1 text-xs">
              {data.alerts.map((a, i) => (
                <li key={i}>
                  <span
                    className={
                      a.level === "critical"
                        ? "text-[var(--danger)]"
                        : a.level === "warning"
                          ? "text-[var(--gold)]"
                          : "text-[var(--muted)]"
                    }
                  >
                    [{a.level}]
                  </span>{" "}
                  {a.text}
                </li>
              ))}
            </ul>
          </div>

          {data.suspiciousIps.length > 0 && (
            <div className="card space-y-2">
              <h2 className="font-semibold">Suspicious IPs (failed logins, 24h)</h2>
              <ul className="space-y-1 text-xs">
                {data.suspiciousIps.map((x) => (
                  <li key={x.ip}>
                    <span className="font-mono">{x.ip}</span> · {x.fails} fails
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "logins" && (
        <div className="card space-y-2">
          <h2 className="font-semibold">Recent failed logins</h2>
          <p className="text-[11px] text-[var(--muted)]">
            Rate limit: 8 failures / 15 minutes per IP or Discord id (Phase 1).
          </p>
          {data.recentFails.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">None recorded.</p>
          ) : (
            <ul className="max-h-[28rem] space-y-2 overflow-y-auto text-[11px]">
              {data.recentFails.map((f) => (
                <li key={f.id} className="rounded-lg border border-[var(--border)] bg-black/20 px-2 py-1.5">
                  <div className="flex justify-between gap-2">
                    <span className="text-[var(--danger)]">{f.reason || "fail"}</span>
                    <span className="text-[var(--muted)]">{when(f.created_at)}</span>
                  </div>
                  <div className="font-mono text-[var(--muted)]">
                    IP {f.ip_address || "—"} · Discord {f.discord_id || "—"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "events" && (
        <div className="card space-y-2">
          <h2 className="font-semibold">Security events</h2>
          <p className="text-[11px] text-[var(--muted)]">
            login_ok / login_fail / cron_denied / lockdown_block / admin_action …
          </p>
          {data.recentEvents.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">No events yet (tables empty or Phase 1 SQL not run).</p>
          ) : (
            <ul className="max-h-[28rem] space-y-2 overflow-y-auto text-[11px]">
              {data.recentEvents.map((e) => (
                <li key={e.id} className="rounded-lg border border-[var(--border)] bg-black/20 px-2 py-1.5">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{e.kind}</span>
                    <span className="text-[var(--muted)]">{when(e.created_at)}</span>
                  </div>
                  <div className="text-[var(--muted)]">
                    {e.path || "—"} · IP {e.ip_address || "—"} · {e.discord_id || ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "access" && (
        <div className="card space-y-2">
          <h2 className="font-semibold">Access logs</h2>
          <p className="text-[11px] text-[var(--muted)]">
            Path + IP only — no query strings, bodies, or cookies stored.
          </p>
          <ul className="max-h-[28rem] space-y-1 overflow-y-auto text-[11px]">
            {data.recentLogs.map((l) => (
              <li key={l.id} className="border-b border-[var(--border)]/40 py-1">
                <span className="text-[var(--muted)]">{when(l.created_at)}</span>{" "}
                <span className="font-mono">{l.method}</span> {l.path}{" "}
                <span className="text-[var(--muted)]">{l.ip_address || ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "admin" && (
        <div className="card space-y-2">
          <h2 className="font-semibold">Admin / econ audit trail</h2>
          <p className="text-[11px] text-[var(--muted)]">Recent rows from econ_audit_log.</p>
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto text-[11px]">
            {data.adminActions.map((a) => (
              <li key={a.id} className="rounded-lg border border-[var(--border)] bg-black/20 px-2 py-1.5">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">{a.action.replaceAll("_", " ")}</span>
                  <span className="text-[var(--muted)]">{when(a.created_at)}</span>
                </div>
                <div className="text-[var(--muted)]">by {a.actor_discord_id || "?"}</div>
              </li>
            ))}
          </ul>
        </div>
      )}


      {tab === "financial" && data.financial && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="card !p-3">
              <p className="text-[11px] text-[var(--muted)]">Open withdrawals</p>
              <p className="text-2xl font-bold">{data.financial.integrity.openWithdrawals}</p>
            </div>
            <div className="card !p-3">
              <p className="text-[11px] text-[var(--muted)]">Neg. balances</p>
              <p className="text-2xl font-bold">{data.financial.integrity.negativeBalances.length}</p>
            </div>
            <div className="card !p-3">
              <p className="text-[11px] text-[var(--muted)]">Alerts (24h)</p>
              <p className="text-2xl font-bold">{data.financial.integrity.recentAlerts}</p>
            </div>
            <div className="card !p-3">
              <p className="text-[11px] text-[var(--muted)]">Ledger orphans</p>
              <p className="text-2xl font-bold">{data.financial.integrity.ledgerOrphans}</p>
            </div>
          </div>
          <div className="card space-y-1 text-xs">
            <h2 className="font-semibold">Thresholds</h2>
            <p>Large withdrawal ≥ ${data.financial.thresholds.large_withdrawal_money.toLocaleString()}</p>
            <p>Large adjust ≥ ${data.financial.thresholds.large_adjust_money.toLocaleString()}</p>
            <p>Max open withdrawals / member: {data.financial.thresholds.max_pending_withdrawals_per_member}</p>
            <button
              type="button"
              className="btn-ghost mt-2"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await fetch("/api/owner/security", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "run_integrity_scan" }),
                  });
                  const j = await r.json();
                  if (!r.ok) throw new Error(j.error || "Scan failed");
                  setMsg("Integrity scan complete");
                  await load();
                } catch (e) {
                  setMsg(e instanceof Error ? e.message : "Scan failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Run integrity scan now
            </button>
          </div>
          {data.financial.integrity.negativeBalances.length > 0 && (
            <div className="card space-y-1 text-xs">
              <h2 className="font-semibold text-[var(--danger)]">Negative balances</h2>
              <ul className="space-y-1">
                {data.financial.integrity.negativeBalances.slice(0, 30).map((n, i) => (
                  <li key={i} className="font-mono">
                    {n.member_id.slice(0, 8)}… · {n.resource} · {n.balance}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="card space-y-2">
            <h2 className="font-semibold">Financial alerts</h2>
            {data.financial.alerts.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">None yet.</p>
            ) : (
              <ul className="max-h-[24rem] space-y-2 overflow-y-auto text-[11px]">
                {data.financial.alerts.map((a) => (
                  <li key={a.id} className="rounded-lg border border-[var(--border)] bg-black/20 px-2 py-1.5">
                    <div className="flex justify-between gap-2">
                      <span className={a.severity === "critical" ? "text-[var(--danger)]" : a.severity === "warning" ? "text-[var(--gold)]" : ""}>
                        {a.severity} · {a.kind}
                      </span>
                      <span className="text-[var(--muted)]">{when(a.created_at)}</span>
                    </div>
                    <div className="text-[var(--muted)]">
                      member {a.member_id ? a.member_id.slice(0, 8) + "…" : "—"}
                      {a.nation_id ? ` · nation #${a.nation_id}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "lockdown" && (
        <div className="card space-y-3">
          <h2 className="font-semibold">Emergency lockdown</h2>
          <p className="text-[11px] text-[var(--muted)]">
            Freezes sensitive staff operations. Member login and viewing balances stay available.
          </p>
          <ul className="space-y-2">
            {LOCK_LABELS.map(({ key, label }) => (
              <li key={key} className="flex items-center justify-between gap-2 text-xs">
                <span>{label}</span>
                <button
                  type="button"
                  className={`btn-ghost !py-1 ${data.lockdown[key] ? "!text-[var(--danger)]" : ""}`}
                  disabled={busy}
                  onClick={() => void setFlag(key, !data.lockdown[key])}
                >
                  {data.lockdown[key] ? "LOCKED" : "Open"}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn w-full" disabled={busy} onClick={() => void clearAll()}>
            Clear all lockdown flags
          </button>
        </div>
      )}

      <p className="pt-2 text-center text-[10px] text-[var(--muted)]">
        <a href="/gov" className="underline">
          ← Gov
        </a>
        {" · "}
        Phase 2 monitoring · Phase 3 financial integrity next
      </p>
    </main>
  );
}
