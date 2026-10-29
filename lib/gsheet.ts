// Downloads a Google Sheet that is shared as "Anyone with the link can view", as CSV.
const NOT_PUBLIC =
  'I couldn\'t open that sheet. In Google Sheets tap Share, set General access to "Anyone with the link" (Viewer), then try again.';

export async function fetchSheetCsv(link: string): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return { ok: false, error: "That doesn't look like a link." };
  }
  const id = /^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(u.pathname)?.[1];
  if (u.hostname !== "docs.google.com" || !id) {
    return { ok: false, error: "Use a Google Sheets link (it starts with docs.google.com/spreadsheets)." };
  }
  const gid = /[#?&]gid=(\d+)/.exec(link)?.[1];
  // Only this fixed address is ever requested, built from the sheet ID.
  const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
  try {
    const res = await fetch(exportUrl, { redirect: "follow", cache: "no-store" });
    if (!res.ok) return { ok: false, error: NOT_PUBLIC };
    const type = res.headers.get("content-type") || "";
    const csv = await res.text();
    if (type.includes("text/html") || /^\s*<(!doctype|html)/i.test(csv)) return { ok: false, error: NOT_PUBLIC };
    if (csv.length > 1_000_000) return { ok: false, error: "That sheet is too big. Use a smaller tab." };
    return { ok: true, csv };
  } catch {
    return { ok: false, error: "Could not reach Google Sheets. Try again in a minute." };
  }
}
