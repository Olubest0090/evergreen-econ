/**
 * Phase 1: Cron endpoints fail closed.
 * Missing CRON_SECRET ⇒ unauthorized (never open access).
 */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;

  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const header = (req.headers.get("x-cron-secret") || "").trim();
  const url = new URL(req.url);
  const query = (url.searchParams.get("secret") || "").trim();

  const provided = bearer || header || query;
  if (!provided || provided.length !== secret.length) return false;

  // Constant-time compare
  let ok = true;
  for (let i = 0; i < secret.length; i++) {
    if (provided.charCodeAt(i) !== secret.charCodeAt(i)) ok = false;
  }
  return ok;
}

export function cronUnauthorized() {
  return Response.json(
    { error: "Unauthorized", hint: "Set CRON_SECRET and pass it as Bearer, x-cron-secret, or ?secret=" },
    { status: 401 }
  );
}
