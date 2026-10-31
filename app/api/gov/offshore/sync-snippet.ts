// Add to POST handler in app/api/gov/offshore/route.ts:
//
// import { syncBankDeposits } from "@/lib/bankDeposits";
//
// if (action === "sync_deposits") {
//   if (!staff.can("balances") && !staff.can("withdrawals")) return err("No permission");
//   try {
//     const result = await syncBankDeposits();
//     return NextResponse.json({ ok: true, ...result });
//   } catch (e) {
//     return err(e instanceof Error ? e.message : "Sync failed", 502);
//   }
// }
