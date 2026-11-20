import { LABEL } from "@/lib/resources";

export type GrantRepayCardProps = {
  onRepayTax: boolean | null;
  taxId: number | null;
  grants: {
    grantId: string;
    grantType: string;
    pct: number;
    remaining: Record<string, number>;
    original: Record<string, number>;
    remainingValue?: number;
    originalValue?: number;
    note: string | null;
  }[];
  totalPct: number;
};

function fmt(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function GrantRepayCard({
  onRepayTax,
  taxId,
  grants,
  totalPct,
}: GrantRepayCardProps) {
  if (!grants.length) return null;

  return (
    <section className="card space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--muted)]">Grants to repay</h2>
          <p className="text-[11px] text-[var(--muted)]">
            Not part of your deposit. Paid down by the <strong>estimated value</strong> of tax
            collected while you are on the grant tax
            {taxId ? ` (tax #${taxId})` : ""}. Any taxed resources count — not only matching ones.
          </p>
        </div>
        <span className="text-lg font-bold tabular-nums">{totalPct}%</span>
      </div>

      <div className="h-3 w-full overflow-hidden rounded-full bg-black/40">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-400 transition-all"
          style={{ width: `${Math.min(100, Math.max(0, totalPct))}%` }}
        />
      </div>

      {onRepayTax === false && (
        <p className="text-xs text-amber-400">
          You are not on the grant repayment tax bracket — this bar will not move until econ puts
          you on that tax ID.
        </p>
      )}
      {onRepayTax === true && (
        <p className="text-xs text-emerald-400">
          You are on the repayment tax — tax value collected counts toward these grants.
        </p>
      )}

      <ul className="space-y-2 text-xs">
        {grants.map((g) => (
          <li
            key={g.grantId}
            className="rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2"
          >
            <div className="flex justify-between gap-2">
              <span className="font-semibold capitalize">{g.grantType.replace(/_/g, " ")}</span>
              <span>{g.pct}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/40">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${g.pct}%` }}
              />
            </div>
            <p className="mt-1 text-[var(--muted)]">
              {g.remainingValue != null ? (
                <>
                  Still owed (est.): <strong>${fmt(g.remainingValue)}</strong>
                  {g.originalValue != null ? ` of $${fmt(g.originalValue)}` : ""}
                </>
              ) : (
                <>
                  Still owed:{" "}
                  {Object.keys(g.remaining).length === 0
                    ? "—"
                    : Object.entries(g.remaining)
                        .map(
                          ([k, v]) =>
                            `${k === "money" ? "$" : ""}${fmt(v)} ${
                              LABEL[k as keyof typeof LABEL] || k
                            }`
                        )
                        .join(", ")}
                </>
              )}
            </p>
            {g.note ? <p className="text-[10px] text-[var(--muted)]">{g.note}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
