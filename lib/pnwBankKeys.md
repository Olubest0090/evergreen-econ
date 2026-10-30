Claude: any remaining process.env.PNW_API_KEY / VERIFIED_BOT_KEY / DISCORD_BOT_TOKEN
in pnwBank.ts, depositNotify.ts, bankDeposits.ts should call:
  getPnwApiKey(), getVerifiedBotKey(), getDiscordBotToken() from @/lib/secrets
so site overrides apply everywhere.
