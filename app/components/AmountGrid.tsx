"use client";

import { RESOURCES, LABEL, parseAmount } from "@/lib/resources";

export type AmountText = Record<string, string>;

/** Turns what the person typed (5m, 250k, 1b) into numbers. */
export function toAmounts(v: AmountText): { amounts: Record<string, number> } | { error: string } {
  const out: Record<string, number> = {};
  for (const [k, s] of Object.entries(v)) {
    if (!s.trim()) continue;
    const n = parseAmount(s);
    if (n === null) return { error: `Check the ${LABEL[k]?.toLowerCase() ?? k} amount. Use numbers like 5m, 250k or 1b.` };
    if (n > 0) out[k] = n;
  }
  if (Object.keys(out).length === 0) return { error: "Enter at least one amount." };
  return { amounts: out };
}

export default function AmountGrid({ value, onChange }: { value: AmountText; onChange: (v: AmountText) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {RESOURCES.map((k) => (
        <label key={k} className="block text-[11px] text-[var(--muted)]">
          {LABEL[k]}
          <input
            className="input mt-0.5 !py-2 text-sm"
            inputMode="text"
            placeholder="0"
            value={value[k] ?? ""}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}
