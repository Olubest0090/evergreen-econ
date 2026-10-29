const MESSAGES: Record<string, string> = {
  state: "That sign-in expired. Please try again.",
  discord: "Discord didn't accept the sign-in. Please try again.",
  setup: "The site isn't fully set up yet. Tell an econ staff member.",
  not_in_server: "You need to be in the Evergreen Discord server to use this site.",
  no_nation:
    "We couldn't find a nation in Evergreen with your Discord name. In Politics & War, open your account settings, set your Discord username there, then try again.",
  ambiguous: "More than one nation uses your Discord name. Ask an econ staff member to help.",
  not_in_alliance: "Your nation is still an applicant in Evergreen. Try again once you are accepted.",
  not_member: "You need the Member role in the Evergreen Discord server to use this site.",
  suspended: "Your account is frozen. Contact econ staff.",
  server: "Something went wrong on our side. Please try again in a minute.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error ? MESSAGES[error] || MESSAGES.server : "";

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-md p-6 text-center">
        <p className="text-2xl font-bold">
          <span className="grad-text">Evergreen</span> Econ
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">Bank, warchest and requests for alliance members</p>

        {message && (
          <p className="mt-5 rounded-xl border border-[var(--border)] bg-black/20 p-3 text-left text-sm text-[var(--danger)]">
            {message}
          </p>
        )}

        <a href="/api/auth/discord" className="btn mt-6 w-full">
          Log in with Discord
        </a>
        <p className="mt-4 text-xs text-[var(--muted)]">
          We match your Discord name with the one set on your Politics &amp; War nation, so make sure it is filled in.
        </p>
      </div>
    </main>
  );
}
