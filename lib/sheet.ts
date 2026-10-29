// Reads a deposit sheet exported from Locutus (CSV, or cells copied from Google Sheets).
import { isResource } from "@/lib/resources";

const ALIASES: Record<string, string> = {
  money: "money", cash: "money", dollars: "money", $: "money",
  food: "food", coal: "coal", oil: "oil", uranium: "uranium", lead: "lead", iron: "iron",
  bauxite: "bauxite", gasoline: "gasoline", gas: "gasoline", munitions: "munitions", munis: "munitions",
  steel: "steel", aluminum: "aluminum", aluminium: "aluminum",
};

const ID_HEADERS = new Set(["nationid", "id", "nid"]);
const NAME_HEADERS = new Set(["nation", "nationname", "name", "leader", "leadername"]);

export function parseTable(text: string): string[][] {
  const clean = text.replace(/\r/g, "").trim();
  if (!clean) return [];
  const first = clean.split("\n", 1)[0];
  const delim = first.includes("\t") ? "\t" : first.includes(",") ? "," : ";";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell.trim()); cell = ""; }
    else if (c === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell.trim());
  rows.push(row);
  return rows.filter((r) => r.some((c) => c !== ""));
}

/** "$1,234.50" -> 1234.5, "(500)" -> -500, "" -> null (blank), "abc" -> NaN. */
export function parseNumber(s: string): number | null {
  const t = s.trim();
  if (t === "" || t === "-") return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Number(t.replace(/[()$,\s-]/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return Math.round((neg ? -n : n) * 100) / 100;
}

export type Sheet = {
  idCol: number;
  nameCol: number;
  resCols: { col: number; resource: string }[];
  rows: string[][];
};

export function readSheet(text: string): { ok: true; sheet: Sheet } | { ok: false; error: string } {
  if (text.length > 1_000_000) return { ok: false, error: "That sheet is too big. Import it in parts." };
  const table = parseTable(text);
  if (table.length < 2) return { ok: false, error: "The sheet needs a first row of column names and at least one row of data." };

  // The column names are usually on row 1, but allow a few title rows above them.
  for (let h = 0; h < Math.min(table.length - 1, 10); h++) {
    const header = table[h].map((c) => c.toLowerCase().replace(/[^a-z$]/g, ""));
    const idCol = header.findIndex((c) => ID_HEADERS.has(c));
    const nameCol = header.findIndex((c) => NAME_HEADERS.has(c));
    if (idCol < 0 && nameCol < 0) continue;
    const resCols: { col: number; resource: string }[] = [];
    header.forEach((c, col) => {
      const r = ALIASES[c];
      if (r && isResource(r) && !resCols.some((x) => x.resource === r)) resCols.push({ col, resource: r });
    });
    if (resCols.length === 0) continue;
    const rows = table.slice(h + 1);
    if (rows.length > 1000) return { ok: false, error: "Too many rows (max 1000 at a time)." };
    return { ok: true, sheet: { idCol, nameCol, resCols, rows } };
  }
  return {
    ok: false,
    error: "I couldn't find the column names. The sheet needs a row with Nation (or Nation ID) and money or resource columns such as Money, Food, Steel.",
  };
}
