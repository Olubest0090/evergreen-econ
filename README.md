# Evergreen Econ

Economic department site for the Evergreen alliance: members see their bank balance, warchest target and tax rates, and can request withdrawals, grants and warchest support. Econ staff (Discord role) approve requests, keep the warchest list, tax rates and balances, and see an audit log.

- Login: Discord. The Discord name must match the one set on the player's Politics & War nation.
- Database: Supabase (tables prefixed `econ_`). Nothing here touches the MILCOM bot's tables.
- Staff: anyone holding the configured econ role in the Evergreen Discord server.

## Environment variables (Vercel)
See `.env.example`. Mark the secrets (service key, auth secret, Discord secret, API key) as Sensitive.

## Discord application
Create it at https://discord.com/developers/applications, add the redirect `https://YOUR-SITE/api/auth/callback`, and copy the client ID and secret.
