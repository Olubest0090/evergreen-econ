export const RESOURCES = [
  "money", "food", "coal", "oil", "uranium", "lead",
  "iron", "bauxite", "gasoline", "munitions", "steel", "aluminum",
] as const;

export type Resource = (typeof RESOURCES)[number];

export const LABEL: Record<string, string> = {
  money: "Money", food: "Food", coal: "Coal", oil: "Oil", uranium: "Uranium", lead: "Lead",
  iron: "Iron", bauxite: "Bauxite", gasoline: "Gasoline", munitions: "Munitions",
  steel: "Steel", aluminum: "Aluminum",
};

export const isResource = (k: string): k is Resource => (RESOURCES as readonly string[]).includes(k);

/** "5m" "250k" "1.2b" "1000000" -> number (null if invalid). */
export function parseAmount(input: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmb])?\s*$/i.exec(String(input).replace(/[$,]/g, ""));
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || "").toLowerCase() as "k" | "m" | "b"] ?? 1;
  const v = Math.round(Number(m[1]) * mult * 100) / 100;
  return Number.isFinite(v) ? v : null;
}

/** Validates {resource: amount}. Returns null if invalid. allowEmpty lets rules be cleared. */
export function cleanAmounts(input: unknown, allowEmpty = false): Record<string, number> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!isResource(k)) return null;
    if (raw === "" || raw === null || raw === undefined) continue;
    const v = Math.round(Number(raw) * 100) / 100;
    if (!Number.isFinite(v) || v < 0 || v > 1e15) return null;
    if (v === 0) continue;
    out[k] = v;
  }
  if (!allowEmpty && Object.keys(out).length === 0) return null;
  return out;
}

export const fmt = (n: number | string) =>
  Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function describe(amounts: Record<string, number | string> | null | undefined) {
  const e = Object.entries(amounts || {});
  if (!e.length) return "-";
  return e.map(([k, v]) => `${fmt(v)} ${(LABEL[k] || k).toLowerCase()}`).join(", ");
}
