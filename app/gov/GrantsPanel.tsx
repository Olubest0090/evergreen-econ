"use client";

import GrowthGrantPanel from "./GrowthGrantPanel";

import { useCallback, useEffect, useState } from "react";
import { RESOURCES, LABEL, fmt } from "@/lib/resources";

type Grant = {
  id: string;
  nation_id: number;
  leader_name: string | null;
  nation_name: string | null;
  grant_type: string;
  amounts: Record<string, number>;
  status: string;
  note: string | null;
  issued_at: string;
  issued_by: string | null;
  approved_by: string | null;
  collected_at: string | null;
  collected_by: string | null;
  collected_amounts: Record<string, number> | null;
  collect_note: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  converted_negative: "Converted negative",
  city: "City",
  infra: "Infra",
  land: "Land",
  project: "Project",
  other: "Other",
};

function amountsLine(a: Record<string, number> | null | undefined): string {
  if (!a) return "—";
  return Object.entries(a)
    .filter(([, v]) => v)
    .map(([k, v]) => `${LABEL[k] || k} ${k === "money" ? "$" : ""}${fmt(v)}`)
    .join(" · ");
}

export default function GrantsPanel({
  post,
  canConvert,
}: {
  post: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  canConvert: boolean;
}) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [status, setStatus] = useState("active");
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState<{
    members: { memberId: string; nationId: number; label: string; negatives: Record<string, number> }[];
    totals: Record<string, number>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setMsg("");
    try {
      const res = await fetch(`/api/gov?a=grants&status=${encodeURIComponent(status)}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Load failed");
      setGrants(data.grants || []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Load failed");
      setGrants([]);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runPreview() {
    setBusy(true);
    setMsg("");
    try {
      const r = (await post({ action: "grants_convert_preview" })) as {
        members?: typeof preview extends null ? never : NonNullable<typeof preview>["members"];
        totals?: Record<string, number>;
      };
      setPreview({ members: r.members || [], totals: r.totals || {} });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function runConvert() {
    if (
      !window.confirm(
        "Convert ALL negative deposits to grants?\n\nDeposit balances will be zeroed on those resources. Grants stay on file even if they leave. Nothing is collected now."
      )
    )
      return;
    setBusy(true);
    setMsg("");
    try {
      const r = (await post({ action: "grants_convert_apply" })) as {
        converted?: number;
        errors?: string[];
      };
      setMsg(
        `Converted ${r.converted ?? 0} member(s).` +
          (r.errors?.length ? ` Issues: ${r.errors.slice(0, 3).join("; ")}` : "")
      );
      setPreview(null);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Convert failed");
    } finally {
      setBusy(false);
    }
  }

  async function collect(id: string, waive: boolean) {
    const note = window.prompt(waive ? "Waive note (optional)" : "Collect note (optional)") ?? "";
    if (!waive && !window.confirm("Mark this grant as fully collected?")) return;
    if (waive && !window.confirm("Waive this grant entirely?")) return;
    setBusy(true);
    try {
      await post({ action: "grant_collect", grantId: id, waive, note: note || undefined });
      setMsg(waive ? "Grant waived" : "Grant marked collected");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <GrowthGrantPanel />
      <p className="text-xs text-[var(--muted)]">
        Grants are not deposit balances. They are not collected while the member stays in the
        alliance. When they leave, gov can collect or waive. Records stay here either way.
      </p>

      {canConvert && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Convert negative deposits → grants</h2>
          <p className="text-xs text-[var(--muted)]">
            Zeros each negative resource on deposit and opens a matching active grant. Approved by
            the staff who runs this.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void runPreview()}>
              Preview negatives
            </button>
            {preview && preview.members.length > 0 && (
              <button type="button" className="btn" disabled={busy} onClick={() => void runConvert()}>
                Convert {preview.members.length} member(s)
              </button>
            )}
          </div>
          {preview && (
            <div className="text-xs space-y-1">
              <p>
                {preview.members.length} member(s) · totals: {amountsLine(preview.totals)}
              </p>
              {preview.members.slice(0, 30).map((m) => (
                <p key={m.memberId} className="text-[var(--muted)]">
                  {m.label}: {amountsLine(m.negatives)}
                </p>
              ))}
              {preview.members.length === 0 && <p>No negative deposits found.</p>}
            </div>
          )}
        </section>
      )}

      <div className="flex gap-2 flex-wrap">
        {(["active", "collected", "waived", "partial", ""] as const).map((s) => (
          <button
            key={s || "all"}
            type="button"
            className={`pill ${status === s ? "pill-on" : ""}`}
            onClick={() => setStatus(s)}
          >
            {s || "all"}
          </button>
        ))}
        <button type="button" className="btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {msg && <p className="text-sm text-[var(--muted)]">{msg}</p>}

      {grants === null ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : grants.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No grants in this filter.</p>
      ) : (
        grants.map((g) => (
          <div key={g.id} className="card space-y-1 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">
                {g.leader_name || g.nation_name || "Nation"}{" "}
                <span className="text-[var(--muted)] font-normal">#{g.nation_id}</span>
              </p>
              <span className="chip">{TYPE_LABEL[g.grant_type] || g.grant_type}</span>
            </div>
            <p className="text-xs text-[var(--muted)]">
              {g.status} · issued {new Date(g.issued_at).toLocaleString()}
              {g.approved_by ? ` · approved by ${g.approved_by}` : ""}
            </p>
            <p>{amountsLine(g.amounts)}</p>
            {g.note && <p className="text-xs text-[var(--muted)]">{g.note}</p>}
            {g.collected_at && (
              <p className="text-xs text-[var(--muted)]">
                Collected {new Date(g.collected_at).toLocaleString()}
                {g.collected_by ? ` by ${g.collected_by}` : ""}
                {g.collected_amounts ? ` · ${amountsLine(g.collected_amounts)}` : ""}
                {g.collect_note ? ` · ${g.collect_note}` : ""}
              </p>
            )}
            {(g.status === "active" || g.status === "partial") && (
              <div className="flex gap-2 pt-1">
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => void collect(g.id, false)}>
                  Collect full
                </button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => void collect(g.id, true)}>
                  Waive
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}