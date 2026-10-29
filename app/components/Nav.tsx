"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function Nav({ staff }: { staff: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const tabs: [string, string][] = [
    ["/", "Home"],
    ["/bank", "Bank"],
    ["/requests", "Requests"],
    ...(staff ? ([["/gov", "Gov"]] as [string, string][]) : []),
  ];

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 flex h-14 border-t border-[var(--border)] bg-[rgba(6,18,13,0.92)] text-xs backdrop-blur">
      {tabs.map(([href, label]) => {
        const on = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 items-center justify-center ${on ? "font-semibold text-[var(--accent)]" : "text-[var(--muted)]"}`}
          >
            {label}
          </Link>
        );
      })}
      <button type="button" onClick={logout} className="flex flex-1 items-center justify-center text-[var(--muted)]">
        Log out
      </button>
    </nav>
  );
}
