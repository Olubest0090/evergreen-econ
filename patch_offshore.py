#!/usr/bin/env python3
"""Adds the 'Send from offshore' button to the Gov dashboard and lets the API show the new 'sending' state.
Run from the repo root:  python3 patch_offshore.py
It only changes the exact lines it expects, and says so if something is already applied or missing."""
import pathlib, sys

def patch(path, pairs):
    p = pathlib.Path(path)
    if not p.exists():
        print(f"MISSING FILE: {path}")
        return False
    s = p.read_text()
    ok = True
    for name, old, new, marker in pairs:
        if marker in s:
            print(f"already applied: {name}")
        elif old in s:
            s = s.replace(old, new, 1)
            print(f"patched: {name}")
        else:
            print(f"NOT FOUND (file changed?): {name}")
            ok = False
    p.write_text(s)
    return ok

OLD_BLOCK = '''              {w.status === "approved" && (
                <div className="mt-2 flex gap-2">
                  <button className="btn-ghost" onClick={() => run({ action: "withdrawal", id: w.id, op: "sent", ref: askNote("Bank reference or note (optional):") }, "Marked as sent")}>Mark sent</button>
                  <button className="btn-ghost btn-danger" onClick={() => run({ action: "withdrawal", id: w.id, op: "failed", note: askNote("What went wrong?") }, "Marked failed and returned to the balance")}>Failed</button>
                </div>
              )}'''
NEW_BLOCK = '''              {w.status === "approved" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="btn" onClick={() => sendFromOffshore(w.id)}>Send from offshore</button>
                  <button className="btn-ghost" onClick={() => run({ action: "withdrawal", id: w.id, op: "sent", ref: askNote("Bank reference or note (optional):") }, "Marked as sent")}>Mark sent</button>
                  <button className="btn-ghost btn-danger" onClick={() => run({ action: "withdrawal", id: w.id, op: "failed", note: askNote("What went wrong?") }, "Marked failed and returned to the balance")}>Failed</button>
                </div>
              )}
              {w.status === "sending" && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-[var(--gold)]">Being sent now. If this stays here, check the bank records before choosing.</p>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-ghost" onClick={() => run({ action: "withdrawal", id: w.id, op: "sent", ref: askNote("Bank reference or note (optional):") }, "Marked as sent")}>It was sent</button>
                    <button className="btn-ghost" onClick={() => run({ action: "withdrawal", id: w.id, op: "release" }, "Released. You can send it again.")}>Not sent, release</button>
                    <button className="btn-ghost btn-danger" onClick={() => run({ action: "withdrawal", id: w.id, op: "failed", note: askNote("What went wrong?") }, "Marked failed and returned to the balance")}>Failed</button>
                  </div>
                </div>
              )}'''

FN_ANCHOR = '  const askNote = (label: string) => window.prompt(label) ?? "";'
FN_NEW = '''  async function sendFromOffshore(id: string) {
    if (!window.confirm("Send this withdrawal now from the offshore bank?")) return;
    setMsg("Sending…");
    try {
      const res = await fetch("/api/gov/offshore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_withdrawal", id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not send");
      setMsg(j.record ? `Sent. Bank record #${j.record}.` : "Sent.");
    } catch (e) {
      fail(e);
    }
    await load();
  }

''' + FN_ANCHOR

a = patch("app/gov/GovClient.tsx", [
    ("send button + sending state", OLD_BLOCK, NEW_BLOCK, "sendFromOffshore(w.id)"),
    ("send function", FN_ANCHOR, FN_NEW, "async function sendFromOffshore"),
])
b = patch("app/api/gov/route.ts", [
    ("to-send tab shows 'sending'",
     'status === "approved" ? ["approved"] : ["pending_approval"];',
     'status === "approved" ? ["approved", "sending"] : ["pending_approval"];',
     '["approved", "sending"]'),
    ("allow 'release'",
     '["approve", "deny", "sent", "failed"].includes(op)',
     '["approve", "deny", "sent", "failed", "release"].includes(op)',
     '"failed", "release"'),
])
sys.exit(0 if (a and b) else 1)
