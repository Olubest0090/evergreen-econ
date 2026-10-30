"use client";

import { useCallback, useEffect, useState } from "react";
import { RESOURCES, LABEL, describe, fmt } from "@/lib/resources";
import OffshorePanel from "./OffshorePanel";

type Member = { discord_username: string; nation_id: number; leader_name: string | null } | null;
type Req = { id: string; kind: string; status: string; amounts: Record<string, number>; purpose: string | null; decision_note: string | null; created_at: string; econ_members: Member };
type Wd = { id: string; amounts: Record<string, number>; status: string; requested_at: string; bank_ref: string | null; error: string | null; recipient_nation_id: number | null; recipient_is_self: boolean; econ_members: Member };
type Mem = { id: string; discord_username: string; nation_id: number; nation_name: string | null; leader_name: string | null; status: string };
type Bal = { member_id: string; resource: string; balance: number };
type Tax = { id: number; name: string; money_pct: number; resource_pct: number; note: string | null };
type LogRow = { id: number; actor_discord_id: string | null; action: string; details: Record<string, unknown>; created_at: string; econ_members: { leader_name: string | null } | null };

type Preview = {
  mode: string; rows: number; resources: string[];
  matched: { memberId: string; label: string; deltas: Record<string, number> }[]; matchedCount: number;
  unmatched: string[]; unmatchedCount: number; errors: string[];
};

type Detail = {
  balances: Record<string, number>; deposited: Record<string, number>; adjusted: Record<string, number>;
  granted: Record<string, number>; withdrawn: Record<string, number>;
  grants: { id: string; kind: string; amounts: Record<string, number>; purpose: string | null; paid_at: string | null }[];
  ledger: { id: number; resource: string; amount: number; kind: string; note: string | null; created_at: string }[];
};

type Tab = "overview" | "requests" | "withdrawals" | "members" | "import" | "audit" | "warchest" | "taxes" | "roles" | "log" | "offshore";

type Overview = {
  pendingRequests: number; toSendRequests: number; pendingWithdrawals: number; toSendWithdrawals: number; members: number;
  held: Record<string, number>; deposits: Record<string, number>; grants: Record<string, number>; withdrawn: Record<string, number>;
};
type AuditRow = { nationId: number; nation: string; leader: string; cities: number; registered: boolean; known: boolean; missing: Record<string, number> };
type Audit = { targetActive: boolean; holdingsKnown: boolean; total: number; under: AuditRow[]; unknown: number; notRegistered: string[] };
type StaffRow = { discordId: string; leader: string; nationId: number; role: "default" | "staff" | "head"; perms: string[] | null };
type MeInfo = { perms: string[] | null; isHead: boolean; canManageRoles: boolean };

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { cache: "no-store", ...init });
  const json = await res.json().catch(() => ({}));
  if (res.status === 403) {
    window.location.href = "/";
    throw new Error("Forbidden");
  }
  if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
  return json;
}
const post = (body: Record<string, unknown>) =>
  api("/api/gov", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const who = (m: Member) => (m ? `${m.leader_name ?? m.discord_username} (#${m.nation_id})` : "?");
const chipFor = (s: string) => (s === "paid" || s === "sent" ? "chip-ok" : s === "denied" || s === "failed" || s === "cancelled" ? "chip-bad" : "chip-gold");

export default function GovClient() {
  const [tab, setTab] = useState<Tab>("overview");
  const [sub, setSub] = useState("pending");
  const [msg, setMsg] = useState("");
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [wds, setWds] = useState<Wd[] | null>(null);
  const [members, setMembers] = useState<Mem[] | null>(null);
  const [balances, setBalances] = useState<Bal[]>([]);
  const [q, setQ] = useState("");
  const [taxes, setTaxes] = useState<Tax[] | null>(null);
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [base, setBase] = useState<Record<string, string>>({});
  const [perCity, setPerCity] = useState<Record<string, string>>({});
  const [overview, setOverview] = useState<Overview | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [staffList, setStaffList] = useState<StaffRow[] | null>(null);
  const [allPerms, setAllPerms] = useState<string[]>([]);
  const [meInfo, setMeInfo] = useState<MeInfo | null>(null);
  const [csv, setCsv] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<Record<string, Detail>>({});
  const [mode, setMode] = useState<"set" | "add">("set");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [taxForm, setTaxForm] = useState({ name: "", money_pct: "", resource_pct: "", note: "" });

  const fail = (e: unknown) => setMsg(e instanceof Error ? e.message : "Something went wrong");

  const load = useCallback(async () => {
    try {
      if (tab === "overview") setOverview((await api("/api/gov?a=overview")) as Overview);
      if (tab === "audit") {
        setAudit(null);
        setAudit((await api("/api/gov?a=audit")) as Audit);
      }
      if (tab === "roles") {
        const r = await api("/api/gov?a=staff");
        setStaffList(r.staff);
        setAllPerms(r.perms);
      }
      if (tab === "requests") setReqs((await api(`/api/gov?a=requests&status=${sub}`)).requests);
      if (tab === "withdrawals") setWds((await api(`/api/gov?a=withdrawals&status=${sub}`)).withdrawals);
      if (tab === "members") {
        const r = await api(`/api/gov?a=members&q=${encodeURIComponent(q)}`);
        setMembers(r.members);
        setBalances(r.balances);
      }
      if (tab === "taxes") setTaxes((await api("/api/gov?a=taxes")).taxes);
      if (tab === "log") setLog((await api("/api/gov?a=log")).log);
      if (tab === "warchest") {
        const r = (await api("/api/gov?a=warchest")).rule as { base: Record<string, number>; per_city: Record<string, number> };
        const toText = (o: Record<string, number>) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, String(v)]));
        setBase(toText(r.base));
        setPerCity(toText(r.per_city));
      }
    } catch (e) {
      fail(e);
    }
    // q is intentionally not a dependency: members are searched with the button
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sub]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api("/api/gov?a=me").then((r) => setMeInfo(r as MeInfo)).catch(() => {});
  }, []);

  async function run(body: Record<string, unknown>, ok: string) {
    setMsg("");
    try {
      await post(body);
      setMsg(ok);
      await load();
    } catch (e) {
      fail(e);
    }
  }

  async function toggleDetail(id: string) {
    const next = !open[id];
    setOpen((o) => ({ ...o, [id]: next }));
    if (next && !detail[id]) {
      try {
        const d = (await api(`/api/gov?a=member&id=${id}`)) as Detail;
        setDetail((m) => ({ ...m, [id]: d }));
      } catch (e) {
        fail(e);
      }
    }
  }

  const sums = (t: Record<string, number>) => describe(Object.fromEntries(Object.entries(t).filter(([, v]) => Number(v) !== 0)));

  const askNote = (label: string) => window.prompt(label) ?? "";

  const PERM_FOR: Partial<Record<Tab, string>> = {
    requests: "requests", withdrawals: "withdrawals", members: "members", import: "import",
  };
  const allowed = (t: Tab) => {
    if (!meInfo) return true;
    if (t === "roles") return meInfo.canManageRoles;
    const need = PERM_FOR[t];
    return !need || meInfo.perms === null || meInfo.perms.includes(need);
  };
  const TABS = ([
    ["overview", "Overview"], ["requests", "Requests"], ["withdrawals", "Withdrawals"], ["members", "Members"], ["import", "Import"],
    ["audit", "Audit"], ["warchest", "Warchest"], ["taxes", "Taxes"], ["roles", "Roles"], ["log", "Log"], ["offshore", "Offshore"],
  ] as [Tab, string][]).filter(([k]) => allowed(k));
  const showSubs = tab === "requests" || tab === "withdrawals";
  const SUBS: [string, string][] = [["pending", "Pending"], ["approved", "To send"], ["history", "History"]];

  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-3 px-3 pb-24 pt-4 text-sm">
      <h1 className="text-lg font-bold">
        <span className="grad-text">Econ</span> gov
      </h1>

      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => { setTab(k); setSub("pending"); setMsg(""); }} className={`pill ${tab === k ? "pill-on" : ""}`}>
            {label}
          </button>
        ))}
      </div>

      {showSubs && (
        <div className="grid grid-cols-3 gap-2">
          {SUBS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setSub(k)} className={`btn-ghost ${sub === k ? "!border-[var(--accent)] !text-[var(--accent)]" : ""}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {msg && <p className="card !p-2.5 text-xs">{msg}</p>}

      {tab === "overview" && (
        <div className="space-y-3">
          {!overview && <p className="text-[var(--muted)]">Loading…</p>}
          {overview && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["Requests waiting", overview.pendingRequests, "requests"],
                  ["Requests to send", overview.toSendRequests, "requests"],
                  ["Withdrawals waiting", overview.pendingWithdrawals, "withdrawals"],
                  ["Withdrawals to send", overview.toSendWithdrawals, "withdrawals"],
                ] as [string, number, Tab][]).map(([label, n, go]) => (
                  <button key={label} type="button" onClick={() => { setTab(go); setSub(label.includes("send") ? "approved" : "pending"); }} className="card text-left">
                    <p className="text-[11px] text-[var(--muted)]">{label}</p>
                    <p className="text-2xl font-bold">{n}</p>
                  </button>
                ))}
              </div>
              <div className="card space-y-2 text-xs">
                <p><span className="text-[var(--muted)]">Members on the site:</span> {overview.members}</p>
                <p><span className="text-[var(--muted)]">Held in member balances:</span> {describe(overview.held)}</p>
                <p><span className="text-[var(--muted)]">Deposited, last 30 days:</span> {describe(overview.deposits)}</p>
                <p><span className="text-[var(--muted)]">Grants and support paid, last 30 days:</span> {describe(overview.grants)}</p>
                <p><span className="text-[var(--muted)]">Withdrawn, last 30 days:</span> {describe(overview.withdrawn)}</p>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "audit" && (
        <div className="space-y-3">
          {!audit && <p className="text-[var(--muted)]">Checking the alliance… this can take a few seconds.</p>}
          {audit && (
            <>
              <div className="card space-y-1 text-xs">
                <p>{audit.total} nations checked.</p>
                {!audit.targetActive && <p className="text-[var(--gold)]">No warchest list is set yet. Add one in the Warchest tab to see who is short.</p>}
                {audit.targetActive && !audit.holdingsKnown && <p className="text-[var(--gold)]">Politics &amp; War isn&apos;t showing members&apos; holdings to this API key, so shortfalls can&apos;t be worked out.</p>}
                {audit.holdingsKnown && audit.unknown > 0 && <p className="text-[var(--muted)]">{audit.unknown} nations have hidden holdings.</p>}
              </div>
              {audit.under.length > 0 && <h2 className="text-sm font-semibold text-[var(--muted)]">Below warchest target ({audit.under.length})</h2>}
              {audit.under.map((r) => (
                <div key={r.nationId} className="card !p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{r.leader} <span className="font-normal text-[var(--muted)]">#{r.nationId} · {r.cities} cities</span></span>
                    {!r.registered && <span className="chip chip-gold">not on site</span>}
                  </div>
                  <p className="mt-1">Short by {describe(r.missing)}</p>
                </div>
              ))}
              {audit.notRegistered.length > 0 && (
                <div className="card text-xs">
                  <p className="mb-1 font-semibold">Haven&apos;t logged in to this site ({audit.notRegistered.length})</p>
                  <p className="text-[var(--muted)]">{audit.notRegistered.join(", ")}</p>
                </div>
              )}
              <button className="btn-ghost w-full" onClick={() => void load()}>Check again</button>
            </>
          )}
        </div>
      )}

      {tab === "roles" && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--muted)]">
            Everyone with the econ role in Discord is staff with full access, unless you limit them here. Heads can manage this screen. Until a head is set, any staff member can. Staff appear after they log in once.
          </p>
          {!staffList && <p className="text-[var(--muted)]">Loading…</p>}
          {staffList?.map((p) => (
            <div key={p.discordId} className="card space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{p.leader} <span className="text-xs font-normal text-[var(--muted)]">#{p.nationId}</span></span>
                <select
                  className="input !w-auto !py-1.5 text-xs"
                  value={p.role}
                  onChange={(e) => setStaffList((list) => list!.map((x) => (x.discordId === p.discordId ? { ...x, role: e.target.value as StaffRow["role"], perms: x.perms ?? [] } : x)))}
                >
                  <option value="default">Full access</option>
                  <option value="staff">Limited</option>
                  <option value="head">Head</option>
                </select>
              </div>
              {p.role === "staff" && (
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {allPerms.map((perm) => (
                    <label key={perm} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={(p.perms ?? []).includes(perm)}
                        onChange={(e) =>
                          setStaffList((list) => list!.map((x) => x.discordId === p.discordId
                            ? { ...x, perms: e.target.checked ? [...(x.perms ?? []), perm] : (x.perms ?? []).filter((y) => y !== perm) }
                            : x))
                        }
                      />
                      {perm}
                    </label>
                  ))}
                </div>
              )}
              <button className="btn-ghost" onClick={() => void run({ action: "set_staff", discordId: p.discordId, role: p.role, perms: p.perms ?? [] }, "Saved")}>Save</button>
            </div>
          ))}
        </div>
      )}

      {tab === "requests" && (
        <div className="space-y-2">
          {!reqs && <p className="text-[var(--muted)]">Loading…</p>}
          {reqs?.length === 0 && <p className="text-[var(--muted)]">Nothing here.</p>}
          {reqs?.map((r) => (
            <div key={r.id} className="card">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{who(r.econ_members)}</span>
                <span className={`chip ${chipFor(r.status)}`}>{r.kind} · {r.status}</span>
              </div>
              <p className="mt-1">{describe(r.amounts)}</p>
              {r.purpose && <p className="text-xs text-[var(--muted)]">{r.purpose}</p>}
              {r.decision_note && <p className="text-xs text-[var(--gold)]">Note: {r.decision_note}</p>}
              <p className="text-[10.5px] text-[var(--muted)]">{new Date(r.created_at).toLocaleString()}</p>
              {r.status === "pending" && (
                <div className="mt-2 flex gap-2">
                  <button className="btn-ghost" onClick={() => run({ action: "decide", requestId: r.id, decision: "approve", note: askNote("Note for the member (optional):") }, "Approved. Send it in-game, then press Mark paid under To send.")}>Approve</button>
                  <button className="btn-ghost btn-danger" onClick={() => run({ action: "decide", requestId: r.id, decision: "deny", note: askNote("Why is it denied?") }, "Denied")}>Deny</button>
                </div>
              )}
              {r.status === "approved" && (
                <button className="btn-ghost mt-2" onClick={() => run({ action: "paid", requestId: r.id, ref: askNote("Reference or note (optional):") }, "Marked as paid")}>Mark paid</button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "withdrawals" && (
        <div className="space-y-2">
          {!wds && <p className="text-[var(--muted)]">Loading…</p>}
          {wds?.length === 0 && <p className="text-[var(--muted)]">Nothing here.</p>}
          {wds?.map((w) => (
            <div key={w.id} className="card">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{who(w.econ_members)}</span>
                <span className={`chip ${chipFor(w.status)}`}>{w.status.replace("_", " ")}</span>
              </div>
              <p className="mt-1">{describe(w.amounts)}</p>
              {!w.recipient_is_self && w.recipient_nation_id && (
                <p className="text-xs text-[var(--gold)]">Sending to another nation: #{w.recipient_nation_id}</p>
              )}
              {w.error && <p className="text-xs text-[var(--danger)]">{w.error}</p>}
              {w.bank_ref && <p className="text-xs text-[var(--muted)]">Ref: {w.bank_ref}</p>}
              <p className="text-[10.5px] text-[var(--muted)]">{new Date(w.requested_at).toLocaleString()}</p>
              {w.status === "pending_approval" && (
                <div className="mt-2 flex gap-2">
                  <button className="btn-ghost" onClick={() => run({ action: "withdrawal", id: w.id, op: "approve" }, "Approved. Send it in-game, then press Mark sent under To send.")}>Approve</button>
                  <button className="btn-ghost btn-danger" onClick={() => run({ action: "withdrawal", id: w.id, op: "deny", note: askNote("Why is it denied?") }, "Denied and returned to the balance")}>Deny</button>
                </div>
              )}
              {w.status === "approved" && (
                <div className="mt-2 flex gap-2">
                  <button className="btn-ghost" onClick={() => run({ action: "withdrawal", id: w.id, op: "sent", ref: askNote("Bank reference or note (optional):") }, "Marked as sent")}>Mark sent</button>
                  <button className="btn-ghost btn-danger" onClick={() => run({ action: "withdrawal", id: w.id, op: "failed", note: askNote("What went wrong?") }, "Marked failed and returned to the balance")}>Failed</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "members" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void load()} placeholder="Name, nation or Discord" />
            <button className="btn-ghost" onClick={() => void load()}>Search</button>
          </div>
          {!members && <p className="text-[var(--muted)]">Loading…</p>}
          {members?.length === 0 && <p className="text-[var(--muted)]">No members found.</p>}
          {members?.map((m) => {
            const mine = balances.filter((b) => b.member_id === m.id && Number(b.balance) !== 0);
            return (
              <div key={m.id} className="card">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{m.leader_name ?? m.discord_username} <span className="text-xs font-normal text-[var(--muted)]">#{m.nation_id}</span></span>
                  <span className={`chip ${m.status === "active" ? "chip-ok" : "chip-bad"}`}>{m.status === "suspended" ? "frozen" : m.status}</span>
                </div>
                <p className="text-xs text-[var(--muted)]">{m.nation_name} · {m.discord_username}</p>
                <p className="mt-1 text-xs">{mine.length ? mine.map((b) => `${fmt(b.balance)} ${LABEL[b.resource]?.toLowerCase()}`).join(", ") : "No balance"}</p>
                <button type="button" className="btn-ghost mt-2 w-full" onClick={() => void toggleDetail(m.id)}>
                  {open[m.id] ? "Hide details" : "Deposits, grants and history"}
                </button>
                {open[m.id] && (
                  <div className="mt-2 space-y-2 rounded-xl border border-[var(--border)] p-2.5 text-xs">
                    {!detail[m.id] && <p className="text-[var(--muted)]">Loading…</p>}
                    {detail[m.id] && (
                      <>
                        <p><span className="text-[var(--muted)]">Deposited in total:</span> {sums(detail[m.id].deposited)}</p>
                        <p><span className="text-[var(--muted)]">Grants and support received:</span> {sums(detail[m.id].granted)}</p>
                        <p><span className="text-[var(--muted)]">Withdrawn in total:</span> {sums(detail[m.id].withdrawn)}</p>
                        <p><span className="text-[var(--muted)]">Staff and sheet adjustments:</span> {sums(detail[m.id].adjusted)}</p>
                        <div>
                          <p className="mb-1 font-semibold">Grants and warchest support given</p>
                          {detail[m.id].grants.length === 0 && <p className="text-[var(--muted)]">None.</p>}
                          <ul className="space-y-1">
                            {detail[m.id].grants.map((g) => (
                              <li key={g.id}>
                                <span className="capitalize">{g.kind}</span>: {describe(g.amounts)}
                                <span className="text-[10.5px] text-[var(--muted)]"> · {g.paid_at ? new Date(g.paid_at).toLocaleDateString() : ""}{g.purpose ? ` · ${g.purpose}` : ""}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="mb-1 font-semibold">Recent entries</p>
                          {detail[m.id].ledger.length === 0 && <p className="text-[var(--muted)]">None.</p>}
                          <ul className="max-h-48 space-y-1 overflow-y-auto">
                            {detail[m.id].ledger.map((l) => (
                              <li key={l.id}>
                                {Number(l.amount) >= 0 ? "+" : ""}{fmt(l.amount)} {LABEL[l.resource]?.toLowerCase()}
                                <span className="text-[10.5px] text-[var(--muted)]"> · {String(l.kind).replace("_", " ")} · {new Date(l.created_at).toLocaleDateString()}{l.note ? ` · ${l.note}` : ""}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="btn-ghost" onClick={() => {
                    const resource = (window.prompt(`Resource (${RESOURCES.join(", ")}):`, "money") || "").trim().toLowerCase();
                    if (!resource) return;
                    const amount = window.prompt("Amount. Use 5m to add or -250k to remove:");
                    if (!amount) return;
                    void run({ action: "adjust", memberId: m.id, resource, amount, note: askNote("Reason (saved in the log):") }, "Balance updated");
                  }}>+/− Balance</button>
                  <a className="btn-ghost" href={`/gov/transaction?id=${m.id}`}>
                    Transaction history
                  </a>
                  {m.status === "active" ? (
                    <button className="btn-ghost btn-danger" onClick={() => window.confirm(`Freeze ${m.leader_name}? They will not be able to log in.`) && void run({ action: "member_status", memberId: m.id, status: "suspended", note: askNote("Reason:") }, "Frozen")}>Freeze</button>
                  ) : (
                    <button className="btn-ghost" onClick={() => void run({ action: "member_status", memberId: m.id, status: "active" }, "Unfrozen")}>Unfreeze</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "import" && (
        <div className="card space-y-3">
          <p className="text-xs text-[var(--muted)]">
            Send the link of the Locutus deposit sheet. It must be shared as &quot;Anyone with the link can view&quot;. The first row (or a row near the top) needs column names such as Nation or Nation ID, then Money, Food, Steel and so on. Blank cells are ignored. People who have never logged in here are listed as not found.
          </p>
          {!pasteMode ? (
            <input className="input" value={sheetUrl} onChange={(e) => { setSheetUrl(e.target.value); setPreview(null); }} placeholder="https://docs.google.com/spreadsheets/d/..." />
          ) : (
            <textarea className="input font-mono text-xs" rows={8} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} placeholder={"Nation,Money,Food,Steel\nSome Nation,5000000,1200,300"} />
          )}
          <button type="button" className="text-xs text-[var(--muted)] underline" onClick={() => { setPasteMode(!pasteMode); setPreview(null); }}>
            {pasteMode ? "Use a sheet link instead" : "Paste the rows instead"}
          </button>
          <div className="grid grid-cols-2 gap-2">
            {([["set", "Match the sheet"], ["add", "Add on top"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => { setMode(k); setPreview(null); }} className={`btn-ghost ${mode === k ? "!border-[var(--accent)] !text-[var(--accent)]" : ""}`}>{label}</button>
            ))}
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            {mode === "set"
              ? "Match the sheet: each balance becomes the sheet's amount (only for the columns in the sheet). Safe to repeat."
              : "Add on top: the sheet's amounts are added to the current balances as new deposits."}
          </p>
          <button className="btn w-full" onClick={async () => {
            setMsg("");
            try { setPreview(await post({ action: "import_preview", ...(pasteMode ? { csv } : { url: sheetUrl }), mode })); } catch (e) { fail(e); }
          }}>Preview changes</button>

          {preview && (
            <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
              <p className="font-semibold">{preview.matchedCount} members will change · {preview.unmatchedCount} not found · {preview.rows} rows read</p>
              <p className="text-[11px] text-[var(--muted)]">Columns used: {preview.resources.map((r) => LABEL[r]).join(", ")}</p>
              <ul className="max-h-60 space-y-1 overflow-y-auto text-xs">
                {preview.matched.map((m) => (
                  <li key={m.memberId}>
                    <span className="font-medium">{m.label}</span>:{" "}
                    {Object.entries(m.deltas).map(([k, v]) => `${v > 0 ? "+" : ""}${fmt(v)} ${LABEL[k].toLowerCase()}`).join(", ")}
                  </li>
                ))}
              </ul>
              {preview.matchedCount > preview.matched.length && <p className="text-[11px] text-[var(--muted)]">Showing the first {preview.matched.length}.</p>}
              {preview.unmatched.length > 0 && <p className="text-xs text-[var(--gold)]">Not found: {preview.unmatched.join(", ")}{preview.unmatchedCount > preview.unmatched.length ? "…" : ""}</p>}
              {preview.errors.map((e, i) => <p key={i} className="text-xs text-[var(--danger)]">{e}</p>)}
              {preview.matchedCount > 0 && (
                <button className="btn w-full" onClick={async () => {
                  if (!window.confirm(`Apply these changes to ${preview.matchedCount} members?`)) return;
                  setMsg("");
                  try {
                    const r = await post({ action: "import_apply", ...(pasteMode ? { csv } : { url: sheetUrl }), mode });
                    setMsg(`Done. ${r.entries} entries saved for ${r.members} members.`);
                    setPreview(null);
                    setCsv("");
                  } catch (e) { fail(e); }
                }}>Apply to balances</button>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "warchest" && (
        <div className="card space-y-3">
          <p className="text-xs text-[var(--muted)]">
            Each member&apos;s target is the base amount plus the per-city amount times their number of cities. Leave a box empty for no target.
          </p>
          <div className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2 text-[11px] text-[var(--muted)]">
            <span />
            <span>Base</span>
            <span>Per city</span>
            {RESOURCES.map((k) => (
              <div key={k} className="contents">
                <span className="text-sm text-[var(--text)]">{LABEL[k]}</span>
                <input className="input !py-1.5" inputMode="decimal" value={base[k] ?? ""} onChange={(e) => setBase({ ...base, [k]: e.target.value })} placeholder="0" />
                <input className="input !py-1.5" inputMode="decimal" value={perCity[k] ?? ""} onChange={(e) => setPerCity({ ...perCity, [k]: e.target.value })} placeholder="0" />
              </div>
            ))}
          </div>
          <button className="btn w-full" onClick={() => void run({ action: "save_warchest", base, per_city: perCity }, "Warchest list saved. Members see it now.")}>Save warchest list</button>
          <p className="text-[10.5px] text-[var(--muted)]">Type plain numbers here, for example 5000000 for $5m.</p>
        </div>
      )}

      {tab === "taxes" && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--muted)]">These rates are shown to members. Set the real brackets in the game too.</p>
          {taxes?.map((t) => (
            <div key={t.id} className="card flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{t.name}</p>
                <p className="text-xs text-[var(--muted)]">{Number(t.money_pct)}% money · {Number(t.resource_pct)}% resources{t.note ? ` · ${t.note}` : ""}</p>
              </div>
              <button className="btn-ghost btn-danger" onClick={() => window.confirm(`Delete ${t.name}?`) && void run({ action: "delete_tax", id: t.id }, "Deleted")}>Delete</button>
            </div>
          ))}
          <div className="card space-y-2">
            <p className="font-semibold">Add or update a rate</p>
            <input className="input" placeholder="Name (same name updates it)" value={taxForm.name} onChange={(e) => setTaxForm({ ...taxForm, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input" inputMode="decimal" placeholder="Money %" value={taxForm.money_pct} onChange={(e) => setTaxForm({ ...taxForm, money_pct: e.target.value })} />
              <input className="input" inputMode="decimal" placeholder="Resource %" value={taxForm.resource_pct} onChange={(e) => setTaxForm({ ...taxForm, resource_pct: e.target.value })} />
            </div>
            <input className="input" placeholder="Note (optional)" value={taxForm.note} onChange={(e) => setTaxForm({ ...taxForm, note: e.target.value })} />
            <button className="btn w-full" onClick={() => void run({ action: "save_tax", ...taxForm }, "Saved")}>Save rate</button>
          </div>
        </div>
      )}

      {tab === "log" && (
        <div className="space-y-2">
          {!log && <p className="text-[var(--muted)]">Loading…</p>}
          {log?.map((r) => (
            <div key={r.id} className="card !p-3 text-xs">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{r.action.replaceAll("_", " ")}</span>
                <span className="text-[10.5px] text-[var(--muted)]">{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <p className="text-[var(--muted)]">
                by Discord {r.actor_discord_id ?? "?"}{r.econ_members?.leader_name ? ` → ${r.econ_members.leader_name}` : ""}
              </p>
              <p className="mt-1 break-words text-[10.5px] text-[var(--muted)]">
                {Object.entries(r.details || {}).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}
              </p>
            </div>
          ))}
        </div>
      )}
    
      {tab === "offshore" && <OffshorePanel />}
</main>
  );
}
