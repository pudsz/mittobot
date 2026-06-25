# ggboi dashboard

Standalone **Vite + React** web dashboard for the ggboi Discord bot. It is a pure
client of the bot's public HTTP API — it imports no bot code and touches no
database. Auth is a stateless JWT bearer token stored in `localStorage`.

This is a 1:1 port of the original inline dashboard at
`src/dashboard/public/index.html` (kept in the repo as the reference), with two
changes: it's componentized React, and it talks to the bot over an absolute base
URL with bearer-token auth instead of same-origin cookies.

## Run locally

```bash
cd dashboard
npm install
# point it at your running bot's public API:
echo 'VITE_BOT_API_URL=https://your-bot-host.example.com' > .env.local
npm run dev
```

Open the printed local URL. For local development against a bot running on the
same machine you might use e.g. `VITE_BOT_API_URL=http://localhost:3000`.

> The bot's API must allow CORS from the dashboard origin (and send the
> `Authorization` header through), since the dashboard is served from a
> different origin than the bot.

## Build / preview

```bash
npm run build     # outputs to dist/
npm run preview   # serve the production build locally
```

## Deploy on Vercel

1. Import the repo into Vercel.
2. Set the **Root Directory** to `dashboard/`.
3. Add an environment variable **`VITE_BOT_API_URL`** = your bot's public URL
   (e.g. `https://bot.example.com`). It is read at build time.
4. Deploy. `vercel.json` contains a SPA rewrite (`/(.*) → /`) so client-side
   refreshes resolve correctly.

## Auth flow

- `POST ${VITE_BOT_API_URL}/login` with `{ password }` returns `{ ok, token }`.
- The token is saved in `localStorage` and sent as `Authorization: Bearer <token>`
  on every other request.
- On any `401` the token is cleared and the login screen is shown.
- "Log out" just clears the token (there is no `/logout` endpoint).
