import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { fetchCities } from "@/lib/pnw";
import { RESOURCES, LABEL, fmt, describe } from "@/lib/resources";
import Nav from "@/app/components/Nav";

type Rule = { base: Record<string, number>; per_city: Record<string, number>; active: boolean };

export default async function HomePage() {
  const me = await getMe();
  if (!me) redirect("/login");
  const supa = db();

  const [{ data: bal }, { data: ledger }, { data: rule }, { data: override }, { data: taxes }, cities] = await Promise.all([
    supa.from("econ_balances").select("resource, balance").eq("member_id", me.id),
    supa.from("econ_ledger").select("id, resource, amount, kind, note, created_at").eq("member_id", me.id).order("created_at", { ascending: false }).limit(15),
    supa.from("econ_warchest_rules").select("base, per_city, active").eq("name", "Default").maybeSingle(),
    supa.from("econ_warchest_overrides").select("targets, note").eq("nation_id", me.nationId).maybeSingle(),
    supa.from("econ_tax_rates").select("name, money_pct, resource_pct, note").order("sort").order("name"),
    fetchCities(me.nationId),
  ]);

  const balances = new Map<string, number>(
    (bal ?? []).map((b): [string, number] => [String(b.resource), Number(b.balance)])
  );
  const owned = RESOURCES.filter((r) => (balances.get(r) ?? 0) !== 0);

  let target: Record<string, number> | null = null;
  let targetNote = "";
  const r = rule as Rule | null;
  if (override?.targets) {
    target = override.targets as Record<string, number>;
    targetNote = override.note || "Set for your nation by econ staff";
  } else if (r?.active) {
    const t: Record<string, number> = {};
    for (const k of RESOURCES) {
      const v = Number(r.base?.[k] ?? 0) + Number(r.per_city?.[k] ?? 0) * (cities ?? 0);
      if (v > 0) t[k] = Math.round(v * 100) / 100;
    }
    target = t;
    targetNote = cities ? `Based on your ${cities} cities` : "City count unavailable right now";
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg space-y-4 px-4 pb-24 pt-5">
      <header>
        <p className="text-sm text-[var(--muted)]">Welcome back</p>
        <h1 className="text-2xl font-bold">{me.leaderName ?? me.username}</h1>
        <p className="text-xs text-[var(--muted)]">
          {me.nationName} · Nation #{me.nationId}
          {me.staff && <span className="chip chip-gold ml-2">econ staff</span>}
        </p>
      </header>

      <section className="card">
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Your bank balance</h2>
        {owned.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nothing here yet. Deposit to the alliance bank and you will be credited automatically.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {owned.map((k) => (
              <div key={k} className="rounded-xl bg-black/25 p-2.5">
                <p className="text-[10.5px] text-[var(--muted)]">{LABEL[k]}</p>
                <p className="font-bold">{k === "money" ? "$" : ""}{fmt(balances.get(k) ?? 0)}</p>
              </div>
            ))}
          </div>
        )}
        <a href="/bank" className="btn mt-3 w-full">Deposit or withdraw</a>
      </section>

      <section className="card">
        <h2 className="mb-1 text-sm font-semibold text-[var(--muted)]">Your warchest target</h2>
        {target && Object.keys(target).length > 0 ? (
          <>
            <p className="font-semibold">{describe(target)}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{targetNote}</p>
            <a href="/requests" className="btn-ghost mt-3">Request warchest support</a>
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">Econ staff haven&apos;t published the warchest list yet.</p>
        )}
      </section>

      {taxes && taxes.length > 0 && (
        <section className="card">
          <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Alliance tax rates</h2>
          <ul className="space-y-1 text-sm">
            {taxes.map((t) => (
              <li key={t.name} className="flex justify-between gap-2">
                <span>{t.name}</span>
                <span className="text-[var(--muted)]">{Number(t.money_pct)}% money · {Number(t.resource_pct)}% resources</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">Recent activity</h2>
        {(ledger ?? []).length === 0 && <p className="text-sm text-[var(--muted)]">No transactions yet.</p>}
        <ul className="divide-y divide-[var(--border)]">
          {ledger?.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate capitalize">{String(l.kind).replace("_", " ")}</p>
                <p className="text-[10.5px] text-[var(--muted)]">{new Date(l.created_at).toLocaleString()}</p>
              </div>
              <span className={Number(l.amount) >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                {Number(l.amount) >= 0 ? "+" : ""}{fmt(l.amount)} {String(LABEL[l.resource] || l.resource).toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Nav staff={me.staff} />
    </main>
  );
}
