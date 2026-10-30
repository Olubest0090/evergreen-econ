import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import Nav from "@/app/components/Nav";
import TransactionsPanel from "@/app/gov/TransactionsPanel";

export default async function GovTransactionsPage() {
  const staff = await requireStaff();
  if (!staff) redirect("/login");

  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-3 px-3 pb-24 pt-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">
          <span className="grad-text">Econ</span> transactions
        </h1>
        <a href="/gov" className="text-xs text-[var(--muted)]">
          ← Gov
        </a>
      </div>
      <TransactionsPanel />
      <Nav staff={true} />
    </main>
  );
}
