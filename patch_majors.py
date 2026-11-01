#!/usr/bin/env python3
"""Small, safe edits to files that other people also change. Run from the repo root: python3 patch_majors.py
Each edit says 'patched', 'already applied', or 'NOT FOUND' (then nothing is changed for that edit)."""
import pathlib, sys

def edit(path, name, fn):
    p = pathlib.Path(path)
    if not p.exists():
        print(f"MISSING FILE: {path}"); return False
    s = p.read_text()
    new, status = fn(s)
    if status == "patched": p.write_text(new)
    print(f"{status}: {name}")
    return status != "NOT FOUND"

# 1) the site pings the server so in-game deposits show up within minutes
def layout(s):
    if "DepositSync" in s: return s, "already applied"
    a = '<body className="antialiased">{children}</body>'
    b = 'import "./translate.css";'
    if a not in s or b not in s: return s, "NOT FOUND"
    s = s.replace(b, b + '\nimport DepositSync from "@/app/components/DepositSync";', 1)
    s = s.replace(a, '<body className="antialiased">{children}<DepositSync /></body>', 1)
    return s, "patched"

# 2) withdrawals "from the offshore" must never fall back to another bank's key
def bank(s):
    old1 = '''    if (off) return { key: off, name: "OFFSHORE_API_KEY" };
    const bank = await getBankApiKey();
    if (bank) return { key: bank, name: "BANK_API_KEY" };
  } else {'''
    new1 = '''    if (off) return { key: off, name: "OFFSHORE_API_KEY" };
    // Never fall back to another bank's key: that would pay from the wrong bank.
    throw new Error("The offshore API key is not set. Add OFFSHORE_API_KEY on /gov/keys (or Vercel).");
  } else {'''
    old2 = "offshoreKey: !!(await getOffshoreApiKey()) || !!(await getBankApiKey()),"
    new2 = "offshoreKey: !!(await getOffshoreApiKey()),"
    if "Never fall back to another bank" in s and old2 not in s: return s, "already applied"
    if old1 not in s or old2 not in s: return s, "NOT FOUND"
    return s.replace(old1, new1, 1).replace(old2, new2, 1), "patched"

# 3) a failed DEPOSIT send is refunded by the database (exactly what was held), not by a hand-written ledger row
def refund(s):
    start = "/** Credit site balance back when in-game send fails after deduct. */"
    end = "/**\n * After a DEPOSIT withdrawal is created"
    if 'p_action: "failed"' in s and "system:auto_refund" not in s: return s, "already applied"
    if start not in s or end not in s or s.index(start) > s.index(end): return s, "NOT FOUND"
    new = '''/** Give the held balance back when the in-game send fails (the database returns exactly what was held). */
async function refundDepositWithdrawal(
  memberId: string,
  amounts: Record<string, number>,
  withdrawalId: string,
  reason: string
) {
  void memberId;
  const supa = db();
  const { error } = await supa.rpc("econ_resolve_withdrawal", {
    p_id: withdrawalId,
    p_action: "failed",
    p_actor: "system",
    p_ref: null,
    p_note: `Refunded on site. ${reason}`.slice(0, 250),
  });
  if (error) {
    console.error("refund failed:", error.message, withdrawalId);
    return { ok: false as const, error: error.message };
  }
  await supa.from("econ_audit_log").insert({
    actor_discord_id: "system",
    action: "withdrawal_auto_refund",
    details: { withdrawal: withdrawalId, amounts, reason: reason.slice(0, 200) },
  });
  return { ok: true as const };
}


'''
    i, j = s.index(start), s.index(end)
    return s[:i] + new + s[j:], "patched"

results = [
    edit("app/layout.tsx", "deposit sync in the layout", layout),
    edit("lib/pnwBank.ts", "offshore never uses another bank's key", bank),
    edit("app/api/withdrawals/route.ts", "refund through the database", refund),
]
sys.exit(0 if all(results) else 1)
