import { notFound } from "next/navigation";
import { isOwnerSession } from "@/lib/ownerSecurity";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SecurityLog = {
  id: string;
  ip_address: string | null;
  method: string;
  path: string;
  user_agent: string | null;
  created_at: string;
};

function dateLabel(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
  }) + " UTC";
}

export default async function OwnerSecurityPage() {
  // 404 conceals the route. Staff permissions do not grant access.
  if (!(await isOwnerSession())) notFound();

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const supabase = db();
  const [{ data, error }, { count }] = await Promise.all([
    supabase.from("econ_security_logs")
      .select("id, ip_address, method, path, user_agent, created_at")
      .gte("created_at", cutoff).order("created_at", { ascending: false }).limit(200),
    supabase.from("econ_security_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.UTC(
        new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()
      )).toISOString()),
  ]);

  const logs = (data ?? []) as SecurityLog[];

  return (
    <main style={{ minHeight: "100vh", padding: "28px 16px 56px", maxWidth: 1180, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 24 }}>
        <div>
          <div style={{ color: "#34d399", fontSize: 12, letterSpacing: 2, fontWeight: 800 }}>EVERGREEN ECON · OWNER ONLY</div>
          <h1 style={{ fontSize: 30, fontWeight: 800, marginTop: 8 }}>Private Security Center</h1>
          <p style={{ color: "#8db3a1", marginTop: 6 }}>Access activity from the last 30 days. No public navigation link is created.</p>
        </div>
        <a href="/owner-security" style={{ border: "1px solid rgba(110,200,160,.25)", borderRadius: 12, padding: "10px 14px", color: "#e9f6ef", textDecoration: "none" }}>Refresh</a>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 18 }}>
        <div className="card"><div style={{ color: "#8db3a1", fontSize: 13 }}>Requests today (UTC)</div><div style={{ fontSize: 30, fontWeight: 800, marginTop: 8 }}>{count ?? 0}</div></div>
        <div className="card"><div style={{ color: "#8db3a1", fontSize: 13 }}>Recent requests shown</div><div style={{ fontSize: 30, fontWeight: 800, marginTop: 8 }}>{logs.length}</div></div>
        <div className="card"><div style={{ color: "#8db3a1", fontSize: 13 }}>Dashboard window</div><div style={{ fontSize: 30, fontWeight: 800, marginTop: 8 }}>30 days</div></div>
      </section>

      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: 16, borderBottom: "1px solid rgba(110,200,160,.2)" }}>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>Recent access log</h2>
          <p style={{ color: "#8db3a1", fontSize: 12, marginTop: 4 }}>IP, method, path and browser user-agent. Query strings, cookies, passwords and request bodies are not collected.</p>
        </div>
        {error ? <p style={{ padding: 18, color: "#fb7185" }}>Could not load security records. Check the Supabase migration.</p> :
          logs.length === 0 ? <p style={{ padding: 18, color: "#8db3a1" }}>No requests recorded yet.</p> :
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760, fontSize: 13 }}>
              <thead><tr style={{ textAlign: "left", color: "#8db3a1", background: "rgba(0,0,0,.18)" }}>
                {["Time (UTC)", "IP address", "Method", "Requested path", "Browser / user-agent"].map(x => <th key={x} style={{ padding: "12px 14px", fontWeight: 600 }}>{x}</th>)}
              </tr></thead>
              <tbody>{logs.map(log => <tr key={log.id} style={{ borderTop: "1px solid rgba(110,200,160,.12)" }}>
                <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>{dateLabel(log.created_at)}</td>
                <td style={{ padding: "12px 14px", fontFamily: "monospace" }}>{log.ip_address || "Unavailable"}</td>
                <td style={{ padding: "12px 14px" }}><span className="chip">{log.method}</span></td>
                <td style={{ padding: "12px 14px", overflowWrap: "anywhere" }}>{log.path}</td>
                <td style={{ padding: "12px 14px", color: "#8db3a1", maxWidth: 260, overflowWrap: "anywhere" }}>{log.user_agent || "Unavailable"}</td>
              </tr>)}</tbody>
            </table>
          </div>}
      </section>
      <p style={{ color: "#8db3a1", fontSize: 12, marginTop: 14 }}>Owner access is checked against OWNER_DISCORD_ID on the server. Staff roles do not grant access.</p>
    </main>
  );
}
