"use client";

import { useCallback, useEffect, useState } from "react";
import { LABEL, fmt } from "@/lib/resources";

type CityRow = {
  id: number;
  index: number;
  infrastructure: number;
  land: number;
};

type NationInfo = {
  id: number;
  label: string;
  num_cities: number;
  domestic_policy: string | null;
  projects: string[];
  cities: CityRow[];
};

type Quote = {
  ok: true;
  grantType: string;
  nationId: number;
  label: string;
  amounts: Record<string, number>;
  breakdown: string[];
  meta: Record<string, unknown>;
};

function amountsLine(a: Record<string, number>) {
  return Object.entries(a)
    .filter(([, v]) => v)
    .map(([k, v]) => `${LABEL[k] || k} ${k === "money" ? "$" : ""}${fmt(v)}`)
    .join(" · ");
}

export default function GrowthGrantPanel() {
  const [grantType, setGrantType] = useState<"city" | "infra" | "land" | "project">("city");
  const [nationId, setNationId] = useState("");
  const [nation, setNation] = useState<NationInfo | null>(null);
  const [projectList, setProjectList] = useState<string[]>([]);
  const [selectedCityIds, setSelectedCityIds] = useState<number[]>([]);
  const [cityTo, setCityTo] = useState("");
  const [cityCount, setCityCount] = useState("1");
  const [targetInfra, setTargetInfra] = useState("1500");
  const [targetLand, setTargetLand] = useState("2000");
  const [projectName, setProjectName] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const loadNation = useCallback(async (id: number) => {
    if (!id) {
      setNation(null);
      return;
    }
    setBusy(true);
    setMsg("");
    setQuote(null);
    try {
      const res = await fetch(`/api/gov/grants?a=nation&nationId=${id}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load nation");
      const n = data.nation as NationInfo;
      setNation(n);
      setProjectList(data.projects || []);
      setSelectedCityIds(n.cities.map((c) => c.id));
      setCityTo(String(n.num_cities + 1));
      setCityCount("1");
      // default project: first not owned
      const owned = new Set((n.projects || []).map((p) => p.toLowerCase()));
      const first = (data.projects as string[] | undefined)?.find(
        (p) => !owned.has(p.toLowerCase())
      );
      setProjectName(first || (data.projects?.[0] ?? ""));
    } catch (e) {
      setNation(null);
      setMsg(e instanceof Error ? e.message : "Load failed");
    } finally {
      setBusy(false);
    }
  }, []);

  // debounce nation id
  useEffect(() => {
    const id = Number(nationId);
    if (!Number.isFinite(id) || id <= 0) {
      setNation(null);
      return;
    }
    const t = setTimeout(() => void loadNation(id), 450);
    return () => clearTimeout(t);
  }, [nationId, loadNation]);

  function toggleCity(id: number) {
    setSelectedCityIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setQuote(null);
  }

  function selectAllCities() {
    if (!nation) return;
    setSelectedCityIds(nation.cities.map((c) => c.id));
    setQuote(null);
  }

  function selectNoneCities() {
    setSelectedCityIds([]);
    setQuote(null);
  }

  async function doQuote() {
    if (!nation) {
      setMsg("Enter a valid nation ID first");
      return;
    }
    if ((grantType === "infra" || grantType === "land") && selectedCityIds.length === 0) {
      setMsg("Tick at least one city");
      return;
    }
    setBusy(true);
    setMsg("");
    setQuote(null);
    try {
      const res = await fetch("/api/gov/grants", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "quote",
          nationId: nation.id,
          grantType,
          cityCount: Number(cityCount),
          cityTo: cityTo ? Number(cityTo) : undefined,
          cityIds: selectedCityIds,
          targetInfra: Number(targetInfra),
          targetLand: Number(targetLand),
          projectName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Quote failed");
      setQuote(data as Quote);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Quote failed");
    } finally {
      setBusy(false);
    }
  }

  async function doExecute(send: boolean) {
    if (!quote || !nation) return;
    const label = send
      ? `PREVIEW total: ${amountsLine(quote.amounts)}\n\nSend from offshore to ${quote.label} and record grant?`
      : `Record grant only (no bank send) for ${quote.label}?\n${amountsLine(quote.amounts)}`;
    if (!window.confirm(label)) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/gov/grants", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute",
          nationId: nation.id,
          grantType: quote.grantType,
          cityCount: Number(cityCount),
          cityTo: cityTo ? Number(cityTo) : undefined,
          cityIds: selectedCityIds,
          targetInfra: Number(targetInfra),
          targetLand: Number(targetLand),
          projectName,
          send,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMsg(
        data.sent
          ? `Sent from offshore · grant ${data.grantId}${data.bankRecord ? ` · bank #${data.bankRecord}` : ""}`
          : `Grant recorded ${data.grantId} (not sent in-game)`
      );
      setQuote(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const cityToNum = Number(cityTo);
  const citiesToBuy =
    nation && Number.isFinite(cityToNum) && cityToNum > nation.num_cities
      ? cityToNum - nation.num_cities
      : Number(cityCount) || 1;

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold">Growth grant (city / infra / land / project)</h2>
        <p className="text-xs text-[var(--muted)]">
          Always <strong>Quote / preview</strong> first. Send only after you accept the cost.
          Pays from offshore when you choose send.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["city", "infra", "land", "project"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`btn-ghost ${grantType === t ? "!border-[var(--accent)] !text-[var(--accent)]" : ""}`}
            onClick={() => {
              setGrantType(t);
              setQuote(null);
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <input
        className="input"
        inputMode="numeric"
        placeholder="Nation ID"
        value={nationId}
        onChange={(e) => setNationId(e.target.value)}
      />

      {nation && (
        <p className="text-xs text-[var(--muted)]">
          {nation.label} · <strong>{nation.num_cities}</strong> cities
          {nation.domestic_policy ? ` · ${nation.domestic_policy}` : ""}
        </p>
      )}

      {/* CITY: range cN+1 … cTo */}
      {grantType === "city" && nation && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <p className="text-xs text-[var(--muted)]">
            Nation is at <strong>c{nation.num_cities}</strong>. Choose the last city number to
            fund (e.g. c30 → set <strong>35</strong> for c31–c35).
          </p>
          <label className="text-xs text-[var(--muted)]">Grant up to city #</label>
          <input
            className="input"
            inputMode="numeric"
            value={cityTo}
            onChange={(e) => {
              setCityTo(e.target.value);
              setQuote(null);
            }}
          />
          <p className="text-xs">
            Will fund <strong>{Math.max(0, citiesToBuy)}</strong> city purchase(s)
            {citiesToBuy > 0
              ? ` (c${nation.num_cities + 1}–c${nation.num_cities + citiesToBuy})`
              : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {[1, 5, 10].map((n) => (
              <button
                key={n}
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setCityTo(String(nation.num_cities + n));
                  setCityCount(String(n));
                  setQuote(null);
                }}
              >
                +{n} city
              </button>
            ))}
          </div>
        </div>
      )}

      {/* INFRA / LAND: multi-select cities */}
      {(grantType === "infra" || grantType === "land") && nation && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={selectAllCities}>
              Tick all
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={selectNoneCities}>
              Clear
            </button>
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {nation.cities.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  checked={selectedCityIds.includes(c.id)}
                  onChange={() => toggleCity(c.id)}
                />
                <span>
                  City {c.index} <span className="text-[var(--muted)]">#{c.id}</span>
                  {" · "}
                  {grantType === "infra"
                    ? `${c.infrastructure} infra`
                    : `${c.land} land`}
                </span>
              </label>
            ))}
          </div>
          {grantType === "infra" && (
            <input
              className="input"
              inputMode="numeric"
              placeholder="Target infra level"
              value={targetInfra}
              onChange={(e) => {
                setTargetInfra(e.target.value);
                setQuote(null);
              }}
            />
          )}
          {grantType === "land" && (
            <input
              className="input"
              inputMode="numeric"
              placeholder="Target land level"
              value={targetLand}
              onChange={(e) => {
                setTargetLand(e.target.value);
                setQuote(null);
              }}
            />
          )}
        </div>
      )}

      {/* PROJECT dropdown */}
      {grantType === "project" && (
        <div className="space-y-2">
          <select
            className="input"
            value={projectName}
            onChange={(e) => {
              setProjectName(e.target.value);
              setQuote(null);
            }}
          >
            <option value="">Select project…</option>
            {projectList.map((p) => {
              const owned = nation?.projects.some(
                (o) => o.toLowerCase() === p.toLowerCase()
              );
              return (
                <option key={p} value={p} disabled={!!owned}>
                  {p}
                  {owned ? " (owned)" : ""}
                </option>
              );
            })}
          </select>
        </div>
      )}

      <button
        type="button"
        className="btn w-full"
        disabled={busy || !nation}
        onClick={() => void doQuote()}
      >
        {busy ? "Working…" : "Preview cost"}
      </button>

      {quote && (
        <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
            Preview — check before sending
          </p>
          <p className="font-semibold">{quote.label}</p>
          <p className="text-lg font-bold">{amountsLine(quote.amounts)}</p>
          <ul className="list-disc pl-4 text-xs text-[var(--muted)]">
            {quote.breakdown.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 pt-1">
            <button type="button" className="btn" disabled={busy} onClick={() => void doExecute(true)}>
              Accept & send from offshore
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void doExecute(false)}>
              Record only (no send)
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setQuote(null)}>
              Cancel preview
            </button>
          </div>
        </div>
      )}

      {msg && <p className="text-sm text-[var(--muted)]">{msg}</p>}
    </section>
  );
}
