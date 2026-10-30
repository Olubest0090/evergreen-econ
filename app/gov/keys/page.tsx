import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import Nav from "@/app/components/Nav";
import SecretsPanel from "@/app/gov/SecretsPanel";

export default async function GovKeysPage() {
  const staff = await requireStaff();
  if (!staff) redirect("/login");
  if (!staff.isHead && staff.perms !== null) redirect("/gov");

  return (
    <main className="mx-auto min-h-screen max-w-lg space-y-3 px-3 pb-24 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">
          <span className="grad-text">Econ</span> keys
        </h1>
        <a href="/gov" className="text-xs text-[var(--muted)]">
          ← Gov
        </a>
      </div>
      <SecretsPanel />
      <Nav staff={true} />
    </main>
  );
}
