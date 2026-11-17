/**
 * Snippets to merge into app/api/gov/grants/route.ts POST handler:
 *
 * if (action === "set_repay_tax") {
 *   const tax_id = Number(body.tax_id);
 *   if (!Number.isInteger(tax_id) || tax_id <= 0) return NextResponse.json({ error: "tax_id required" }, { status: 400 });
 *   await saveGrantRepaySettings({ tax_id, alliance_id: body.alliance_id ? Number(body.alliance_id) : undefined });
 *   return NextResponse.json({ ok: true });
 * }
 * if (action === "migrate_repay") {
 *   const r = await migrateGrantsForRepay();
 *   return NextResponse.json({ ok: true, ...r });
 * }
 * if (action === "run_repay_sync") {
 *   const r = await runGrantRepaySync();
 *   return NextResponse.json(r);
 * }
 * if (action === "repay_status") {
 *   const s = await getGrantRepaySettings();
 *   return NextResponse.json({ settings: s });
 * }
 */
export {};
