"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const icons: Record<string, React.ReactNode> = {
  Home: (
    <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />
  ),
  Bank: (
    <>
      <path d="M3 9h18L12 3 3 9Z" />
      <path d="M4 10h16M5 10v9m4-9v9m6-9v9m4-9v9M3 20h18" />
    </>
  ),
  Requests: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6m-6 4h6m-6 4h4" />
    </>
  ),
  Gov: (
    <>
      <path d="M12 3 4 6v5c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  "Log out": (
    <>
      <path d="M10 17l5-5-5-5m5 5H3" />
      <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />
    </>
  ),
};

function Icon({ name, active }: { name: string; active?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={active ? "scale-110" : ""}
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
}

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
    <nav className="fixed bottom-0 left-0 right-0 z-20 flex h-[70px] border-t border-[var(--border)] bg-[rgba(6,18,13,0.96)] text-[10px] backdrop-blur-xl">
      {tabs.map(([href, label]) => {
        const on = href === "/" ? pathname === "/" : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            className={`relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors ${
              on
                ? "font-semibold text-[var(--accent)]"
                : "text-[var(--muted)]"
            }`}
          >
            {on && (
              <span className="absolute top-0 h-[2px] w-8 rounded-full bg-[var(--accent)] shadow-[0_0_10px_var(--accent)]" />
            )}

            <Icon name={label} active={on} />

            <span>{label}</span>
          </Link>
        );
      })}

      <button
        type="button"
        onClick={logout}
        className="flex flex-1 flex-col items-center justify-center gap-1 text-[var(--muted)] transition-colors hover:text-[var(--danger)]"
      >
        <Icon name="Log out" />
        <span>Log out</span>
      </button>
    </nav>
  );
}
