import Link from "next/link";

export const metadata = {
  title: "Privacy Policy · Evergreen Econ",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 py-8 pb-24 text-sm leading-relaxed">
      <p className="text-xs text-[var(--muted)]">
        <Link href="/login" className="underline">
          ← Login
        </Link>
      </p>
      <h1 className="mt-3 text-xl font-bold">Privacy Policy</h1>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Evergreen Econ · Last updated 30 October 2026
      </p>

      <div className="mt-6 space-y-4 text-[var(--text)]">
        <p>
          Evergreen Econ is a website for the Evergreen alliance economic department in the
          browser game Politics &amp; War. It is not a real-money bank. Balances, requests and
          withdrawals are records for in-game resources only.
        </p>

        <h2 className="text-base font-semibold">1. What we collect</h2>
        <p>
          <strong>From Discord</strong> when you sign in: Discord user id, display name, avatar
          URL, and whether you have the roles we use to decide member or econ staff access. We use
          Discord OAuth; we do not keep your Discord password. The access token is used during
          sign-in and is not stored long-term as a reusable login secret beyond our session cookie.
        </p>
        <p>
          <strong>From Politics &amp; War</strong>: nation id, nation name, leader name, city count
          and related public/alliance data needed to match your Discord name to your nation and to
          show warchest and tax information. If bank tools are enabled, an alliance or offshore API
          key and verified bot key are stored only on the host (e.g. Vercel environment variables),
          not in the browser.
        </p>
        <p>
          <strong>From your use of the site</strong>: account balances, ledger entries, withdrawal
          and grant requests, staff decisions, audit log actions, and sign-in session data. Server
          logs may include IP address and pages requested for security and debugging.
        </p>

        <h2 className="text-base font-semibold">2. Why we use it</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>To sign you in and show the correct member or staff screens</li>
          <li>To keep the alliance econ books (deposits, withdrawals, grants, warchest)</li>
          <li>To prevent abuse and fix mistakes</li>
          <li>To operate optional in-game bank sends when staff or automation is enabled</li>
        </ul>
        <p>We do not sell your data or use it for advertising.</p>

        <h2 className="text-base font-semibold">3. Who can see it</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>You: your own balances, requests and activity</li>
          <li>Econ staff / heads: what they need to run the department, subject to role permissions</li>
          <li>Hosting providers (e.g. Vercel, Supabase) that run the site and database</li>
          <li>Discord and Politics &amp; War, when we call their services to sign in or move in-game resources</li>
        </ul>

        <h2 className="text-base font-semibold">4. Cookies</h2>
        <p>
          We use a session cookie to keep you signed in. If you use the language tool, your browser
          may also store a preference for the selected language (including cookies used by Google
          Translate if you pick a language other than English).
        </p>

        <h2 className="text-base font-semibold">5. How long we keep it</h2>
        <p>
          Account and bookkeeping records are kept while the alliance runs this service. Session
          cookies expire when you log out or when the session ends. Server logs are kept only as
          long as needed for security and operations.
        </p>

        <h2 className="text-base font-semibold">6. Children</h2>
        <p>
          Politics &amp; War and this site follow the game’s age rules. Do not use the site if you
          are below the minimum age required by Discord or the game.
        </p>

        <h2 className="text-base font-semibold">7. Changes</h2>
        <p>
          We may update this policy. The date at the top will change; continued use after an update
          means you accept the new version.
        </p>

        <h2 className="text-base font-semibold">8. Contact</h2>
        <p>
          Questions: contact Evergreen econ staff on the alliance Discord.
        </p>
      </div>

      <p className="mt-8 text-xs text-[var(--muted)]">
        Related:{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
