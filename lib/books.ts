/**
 * "Evergreen net at offshore" = baseline + money moved IN for Evergreen - money paid OUT of the offshore.
 * It is NOT the offshore alliance's bank balance (that holds other alliances' money too) and never includes
 * anyone's personal stockpile. It is worked out from the audit log, so every line is traceable.
 */
import { db } from "@/lib/supabase";
import { getSetting } from "@/lib/settings";

const CREDIT_ACTIONS = ["offshore_send_all", "offshore_evergreen_credit", "offshore_deposit_credit"];
const DEBIT_ACTIONS = ["offshore_evergreen_debit", "withdrawal_sent_offshore", "withdrawal_auto_sent_offshore", "withdrawal_grant_auto_sent"];

type Amounts = Record<string, number>;
const add = (t: Amounts, k: string, v: number) => { t[k] = Math.round(((t[k] ?? 0) + v) * 100) / 100; };
const clean = (o: unknown): Amounts => {
  const out: Amounts = {};
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) out[k] = n;
  }
  return out;
};

export async function computeNet() {
  const supa = db();
  const books = await getSetting<{ baseline?: Amounts }>("offshore_books", {});
  const { data: rows } = await supa
    .from("econ_audit_log")
    .select("action, details")
    .in("action", [...CREDIT_ACTIONS, ...DEBIT_ACTIONS])
    .order("created_at", { ascending: true })
    .limit(20000);

  const credits: Amounts = {};
  const debits: Amounts = {};
  const needLookup: { id: string }[] = [];
  for (const r of rows ?? []) {
    const d = (r.details ?? {}) as { amounts?: unknown; withdrawal?: string };
    if (CREDIT_ACTIONS.includes(r.action)) {
      for (const [k, v] of Object.entries(clean(d.amounts))) add(credits, k, v);
    } else if (d.amounts && Object.keys(clean(d.amounts)).length) {
      for (const [k, v] of Object.entries(clean(d.amounts))) add(debits, k, v);
    } else if (d.withdrawal) {
      needLookup.push({ id: String(d.withdrawal) });
    }
  }
  // Payouts logged without their amounts: read them from the withdrawal itself.
  const ids = Array.from(new Set(needLookup.map((x) => x.id)));
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supa.from("econ_withdrawals").select("amounts").in("id", ids.slice(i, i + 200));
    for (const w of data ?? []) for (const [k, v] of Object.entries(clean(w.amounts))) add(debits, k, v);
  }

  const baseline = clean(books.baseline);
  const net: Amounts = {};
  for (const k of new Set([...Object.keys(baseline), ...Object.keys(credits), ...Object.keys(debits)])) {
    net[k] = Math.round(((baseline[k] ?? 0) + (credits[k] ?? 0) - (debits[k] ?? 0)) * 100) / 100;
  }
  return { baseline, credits, debits, net };
}
