# DASHBOARD_SPEC.md — The Ultimate ggboi Dashboard (dashboard-v2)

> Implementation blueprint for the **dashboard-v2** rewrite: a Vercel-hosted,
> guild-scoped "mission control" SPA for the bot specced in `BOT_SPEC.md`.
> The scaffold already exists in `dashboard-v2/` (created 2026-07-02); this document
> is the contract for finishing it. Endpoint names and table names match BOT_SPEC
> exactly — if the two files disagree, BOT_SPEC wins for the API and this file wins
> for UX.

---

## 0. What Already Exists (do not re-scaffold)

`dashboard-v2/` currently contains:

- **Stack**: Vite 6 + React 19 + TypeScript (strict) + Tailwind v4 (`@tailwindcss/vite`,
  CSS-first `@theme` tokens in `src/index.css`) + tw-animate-css.
- **Deps installed**: TanStack Query v5, react-router-dom v7, Radix primitives
  (dialog, alert-dialog, dropdown, select, switch, tabs, tooltip, popover, scroll-area,
  separator, slot, label), cmdk, sonner, motion, recharts, lucide-react, cva,
  clsx + tailwind-merge.
- **Vendored `src/components/ui/`**: button, input, textarea, label, switch, card,
  badge, skeleton, dialog, alert-dialog, select, tabs, tooltip, dropdown-menu, sheet,
  separator, scroll-area, popover, table, command.
- **`src/components/app/`**: PageHeader, StatCard, EmptyState, ErrorRetry,
  SaveBar (motion slide-in unsaved-changes bar), ChannelSelect, MultiSelect,
  ErrorBoundary.
- **`src/lib/`**: `api.ts` (same contract as v1 — `VITE_BOT_API_URL` base, Bearer JWT in
  localStorage `ggboi_token`, 401 → onUnauthorized, `guildPath()` helper),
  `query.ts` (QueryClient, 30s staleTime), `types.ts`, `utils.ts` (cn, avatarUrl,
  guildIconUrl, formatUptime, timeAgo…).
- **`src/hooks/`**: `useAuth.tsx` (AuthProvider — `/api/me`, OAuth `#token=`/`#error=`
  hash consumption with history cleanup, login/logout), `useGuild.ts` (route guild,
  `useBotStatus` poll, `useGuildMeta` shared channels/roles).
- **Config**: `vite.config.ts` (port **5174**, `/api` + `/login` proxy to
  `VITE_BOT_API_URL` or `:3432`), strict tsconfigs, `index.html` (dark class).

Missing: `src/main.tsx`, router, shell, all pages — that is what this spec defines.

---

## 1. Deployment: Vercel (frontend) + Pterodactyl (bot API)

- **Vercel project root**: `dashboard-v2/`. Build `npm run build`, output `dist/`.
- **`dashboard-v2/vercel.json`**:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```
- **Env on Vercel**: `VITE_BOT_API_URL=https://bot.yourdomain.com` (the Pterodactyl
  bot's public URL — must be HTTPS; Caddy/nginx in front of `PORT`).
- **Bot side** (`.env` on Pterodactyl): `DASHBOARD_ORIGIN=https://<app>.vercel.app`
  (CORS allowlist) and, for OAuth, `DISCORD_REDIRECT_URI=https://bot.yourdomain.com/api/auth/discord/callback`.
- The bot **also** serves whichever `dist/` exists locally (single-port Pterodactyl
  mode) — Vercel is the premium path, local serving is the fallback. Cutover:
  `src/api/server.js` prefers `dashboard-v2/dist` over `dashboard/dist` when present.
- Auth flow (already implemented in scaffold): password → `POST /login` → JWT;
  Discord OAuth → redirect → callback → `{dashOrigin}#token=<jwt>` → hash consumed,
  stored under `ggboi_token` (v1-compatible: existing sessions carry over).

---

## 2. Design Identity — "Ops Console"

Not stock-shadcn. The subject is a **bot operations console**: the aesthetic reference
is flight-deck telemetry, not SaaS settings.

- **Palette** (tokenized in `index.css` already): near-black zinc base (`#09090b`),
  indigo signal (`#6366f1`), success `#22c55e`, warning `#f59e0b`, destructive
  `#ef4444`. Semantic tokens only — no raw hex in components.
- **Type**: system sans for UI; **mono for all live data** — IDs, counts, timestamps,
  event lines render in `--font-mono`. The mono-for-telemetry rule is the visual
  signature that separates this from generic admin panels.
- **Signature element**: the **live activity console** (Overview) — a mono-typeset,
  auto-scrolling event stream with type-colored severity dots and a pulsing LIVE
  indicator, fed by SSE. Everything else stays quiet and disciplined around it.
- **Motion**: one orchestrated moment per page (route content fade/4px-rise via
  `motion/react`, 150ms); SaveBar spring; live-feed rows slide in. Nothing else moves.
  `prefers-reduced-motion` respected (tw-animate-css + motion both honor it).
- **Density**: compact tables (13px), 8px grid, cards `p-4/p-5`. Status pill always
  visible in the sidebar: pulsing green dot + `tag · ping ms` in mono.
- **Copy rules**: sentence case; buttons say what they do ("Save automod", not
  "Submit"); empty states are invitations ("No tickets yet — post a panel to get
  started"); errors say what happened + the fix.

---

## 3. Information Architecture & Routes

```
/                         Landing (public, marketing)
/docs                     Docs (public)
/login                    Password + Discord OAuth
/servers                  Server picker (guild grid, search)
/g/:guildId               → redirect to overview
/g/:guildId/overview      ★ Mission control (signature page)
/g/:guildId/moderation    hub → sub-routes:
    /automod  /antiraid  /dangerzone  /cases  /modlog  /notes  /rules(autoexec)
/g/:guildId/community     hub →
    /greet  /roles  /members  /channels  /levels  /tickets  /giveaways
    /starboard  /suggestions  /birthdays  /invites  /social  /schedule  /backups
/g/:guildId/engagement    hub →
    /economy  /tags  /music
/g/:guildId/ai            hub →
    /config  /chat  /memory  /analytics  /conversations
/g/:guildId/commands      feature toggles + per-command config + embed builder
/system                   (owner-only) →
    /status  /settings  /modules  /data  /experiments
```

- Guild in the URL → deep-linkable; guild switcher swaps the `:guildId` segment in place.
- Hubs render horizontal sub-nav (`Tabs` styling, but router `NavLink`s) under a shared
  `PageHeader`.
- Route-level code splitting: `React.lazy` per hub.
- Owner-only System section hidden for non-owners (guard on `user.isOwner`); server
  returns 403 anyway.
- v1's "Server/Admin mode" toggle is **removed** — replaced by the System section.

### 3.1 Shell

- **Sidebar** (desktop ≥900px): brand, status pill (`useBotStatus`), guild switcher
  (dropdown w/ icons), nav sections (Overview / Moderation / Community / Engagement /
  AI / Commands / System), user card (avatar, tag, logout) at bottom.
- **Mobile**: top bar (hamburger → `Sheet` with the same sidebar) + guild name.
- **⌘K palette** (cmdk): navigate to any page, fuzzy; also "actions" group (Refresh
  page data, Copy guild ID, Log out). Alt+1–7 jumps hubs.
- **Toasts**: sonner, bottom-right; success = quiet, errors = descriptive + retry
  action where applicable.

---

## 4. Data Layer Conventions

- **Query keys**: `["status"]`, `["guild", guildId, resource]`,
  `["guild", guildId, resource, params]`. Guild switch = different keys = automatic
  isolation.
- **Mutations**: optimistic where the shape is local (toggles, single fields):
  `onMutate` cache patch → rollback `onError` → `invalidateQueries` on settle.
  Form-heavy pages instead use **dirty-state + SaveBar** (scaffolded) with explicit
  save; no optimistic write.
- **SSE** — `src/hooks/useEvents.ts`:
  ```ts
  useEvents(guildId, onEvent?)  // EventSource(`${BASE}/api/events?guildId&token=`)
  ```
  Pushes into `["guild", guildId, "activity"]` cache (prepend, cap 200), exposes
  `connected` for the LIVE indicator, exponential-backoff reconnect (1s→30s).
- **Types**: every endpoint gets an interface in `lib/types.ts`, matching BOT_SPEC
  response shapes.

---

## 5. Page-by-Page Contract

Format: **Page — endpoints — key UI**. "(new)" = endpoint from BOT_SPEC that doesn't
exist yet; everything else exists today in `src/api/server.js`.

### 5.1 Overview ★ (signature page)

- `GET /api/overview?guildId` (new), `GET /api/activity?guildId&limit=50` (new),
  SSE `/api/events` (new), `GET /api/features`, `POST /api/features`.
- UI: 4–6 `StatCard`s (members, mod actions 7d, AI calls today, active warnings,
  economy users, tickets open); **live activity console** (§2 signature; type filter
  chips: mod/automod/ai/joins/…); **quick toggles** rail (feature categories as
  Switches, optimistic); **needs-attention** list (from overview payload `attention[]`,
  each item deep-links to its fix page).

### 5.2 Moderation hub

| Page | Endpoints | Key UI |
|---|---|---|
| Automod | `GET/POST /api/automod`, `GET /api/automod/stats` (new), `POST /api/automod/test` (new) | Master switch, rule cards (all §3.1 BOT_SPEC rule types incl. regex/links/attachments/duplicates), **heat system** panel (threshold ladder editor), per-rule trigger sparkline from stats, **test-a-message** drawer |
| Anti-raid | `GET/POST /api/automod/extended` (extend) | Join-rate + account-age gates, raid action select, alert channel, lockdown status banner w/ manual unlock |
| Dangerzone | `GET/POST /api/dangerzone`, `POST /api/dangerzone/remove` | Trap-channel list, per-channel action/exempts/log editor |
| Cases | `GET /api/cases` (new; falls back to `/api/modlog` until B2 ships), `POST /api/cases/:n` (new) | Searchable/filterable table (user, mod, action, date range), case detail slide-over (`Sheet` right) with evidence, status workflow, linked cases; CSV export (client-side) |
| Mod log | `GET /api/modlog`, `GET /api/modlog/:userId` | Timeline view, per-mod stats bar chart |
| User notes | `GET/POST/DELETE /api/modnotes/:userId` | Per-user note list |
| Auto rules | `GET/POST /api/autoexec`, `DELETE /api/autoexec/:id` | Rule builder (trigger → conditions → actions incl. new §8 BOT_SPEC triggers/actions), per-rule enable toggle, execution log panel |

### 5.3 Community hub

| Page | Endpoints | Key UI |
|---|---|---|
| Greet & logs | `GET/POST /api/greet` | Welcome/leave editors with **live Discord-style preview** (EmbedPreview), placeholder insert palette, per-event-type log channel matrix (§10 BOT_SPEC) |
| Roles | `GET /api/roles`, `POST /api/roles/autoroles`, `POST /api/roles/reaction/remove`, `GET/POST /api/role-panels` (new) | Autoroles, reaction roles, **button/menu role panel builder** with live preview + publish |
| Members | `GET /api/roles/members` | Tracked-role member table, search |
| Channels | `GET /api/channels`, `POST /api/channels/sync` | Category tree, batch permission sync |
| Levels | `GET/POST /api/leveling` (new), `POST /api/leveling/user|reset` (new) | Config (XP rates, multipliers, role-reward ladder editor), top-100 leaderboard, per-user XP adjust |
| Tickets | `GET/POST /api/tickets/config` (new), `GET /api/tickets` (new), `POST /api/tickets/:id/close` (new) | Panel/category builder, support roles, open-ticket table w/ transcript viewer |
| Giveaways | `GET/POST /api/giveaways` (new), `POST /api/giveaways/:id/end|reroll` (new) | Create form (duration/winners/prize/requirements), active list w/ entry counts, end/reroll |
| Starboard | `GET/POST /api/starboard` (new) | Channel, emoji, threshold, recent starboard posts grid |
| Suggestions | `GET/POST /api/suggestions` (new) | Status board (open/approved/denied columns), staff comment actions |
| Birthdays | `GET/POST /api/birthdays` (new) | Config + upcoming-birthdays list |
| Invites | `GET /api/invites` (new) | Inviter leaderboard, per-user stats |
| Social | `GET/POST/DELETE /api/social` (new) | Subscription list (YouTube/Twitch/RSS), template editor per sub |
| Schedule | `GET/POST/DELETE /api/schedule` | Recurring/cron editor, embed payload picker, run history |
| Backups | `GET/POST /api/backup`, `/api/backup/:id/restore`, `GET /api/backup/:id/diff` (new) | Snapshot list, **restore preview diff** modal before commit, auto-backup config |

### 5.4 Engagement hub

| Page | Endpoints | Key UI |
|---|---|---|
| Economy | `GET/POST /api/economy/config`, `GET /api/economy/leaderboard|stats|shop`, `POST/DELETE /api/economy/shop` | Payout knobs, shop item editor (role/badge/custom types), leaderboard, circulation stats |
| Tags | `GET/POST/DELETE /api/tags` (new) | Tag CRUD table, content editor w/ placeholder palette + embed JSON support, use counts |
| Music | `GET /api/music/status` (new), `POST /api/music/control` (new), `GET/POST /api/music/config`, `GET /api/music/library` (new) | **Now-playing card** (progress, volume slider, transport buttons), queue list (drag-reorder deferred; up/down buttons), radio presets, library browser, DJ-role config |

### 5.5 AI hub

| Page | Endpoints | Key UI |
|---|---|---|
| Config | `GET/POST /api/ai`, `GET /api/ai/models/:providerId`, `GET/PUT/DELETE /api/ai/prompts`, `GET/POST/DELETE /api/ai/personalities` | Split v1's 1.2k-line monolith into sections: Provider (+fallback chain ordering), Behavior (temp/tokens/prompt library), Tools (permission matrix per tool: all/mod/admin/owner), Channels, Quotas |
| Chat | `POST /api/ai/chat` | Test-chat console (mono, streaming-style reveal) |
| Memory | `GET/POST/DELETE /api/ai/memories`, `POST /api/ai/memories/clear` | Scope browser (user/server/DM), search, delete |
| Analytics | `GET /api/ai/analytics?days=` | Provider table + charts (recharts: calls/day, tokens/day, latency) |
| Conversations | `GET /api/ai/conversations`, `/logs`, `/diag` | Per-user conversation inspector |

### 5.6 Commands + System

- **Commands**: `GET /api/commands`, `POST /api/commands/:name`, `GET/POST /api/features` —
  category groups w/ bulk toggle, per-command drawer (enable, permission ladder select,
  role/channel restrictions via MultiSelect, cooldown, settings bag editor incl. warn-ladder
  UI), search. **Embed builder**: `GET/POST/DELETE /api/embeds`, `POST /api/embeds/send` —
  form ↔ live preview split, template library, JSON import/export.
- **System/Status**: `GET /api/status` + SSE heartbeat, `POST /api/presence` — stat grid,
  process health, presence editor. **Settings**: `GET/POST /api/settings`,
  `POST /api/settings/reset` — grouped global settings incl. prefix. **Modules**:
  module CRUD + reload (code editor = plain `Textarea` mono; CodeMirror deferred),
  with the existing security warning surfaced prominently. **Data**: `GET /api/data/:store`
  — store picker + tree/JSON view. **Experiments**: alpha codes/telemetry endpoints.

### 5.7 Public pages

Landing (feature grid from BOT_SPEC systems, hero = animated activity-console mock),
Docs (static content, sidebar TOC), Login (scaffolded flow), Servers picker (guild grid
w/ icons, search, member counts).

---

## 6. Build Phases

| Phase | Scope | Verify |
|---|---|---|
| **D0** ✅ | Scaffold (done — §0) | `npm run build` green |
| **D1** | `main.tsx`, router, AppShell, Login, Servers, palette, toasts, ErrorBoundary wiring | Login (both modes) against local bot on :3432; navigate all stub routes |
| **D2** | Overview page against B1 endpoints (graceful-degrade if endpoints 404: hide feed, show stats from existing endpoints) | Live feed updates when events fire |
| **D3** | Moderation hub (7 pages) | Parity with v1 automod/dangerzone/modlog/notes/autoexec + new cases/antiraid |
| **D4** | Community hub part 1 (greet, roles+panels, members, channels, schedule, backups) | v1 parity |
| **D5** | Community hub part 2 (levels, tickets, giveaways, starboard, suggestions, birthdays, invites, social) — ships alongside bot phases B4–B6 | Each page functional against its endpoints |
| **D6** | AI hub | v1 parity + memory browser |
| **D7** | Engagement hub (economy, tags, music) | Music transport controls live |
| **D8** | Commands + System + public pages | Full v1 parity checklist below |
| **D9** | Polish (motion, shortcuts, skeletons everywhere, mobile QA) + **cutover** (server.js prefers `dashboard-v2/dist`, `scripts/dev.js` launches v2, CLAUDE.md updated, Vercel project created) | Lighthouse pass, tsc clean, Vercel preview deployed |

## 7. v1 Parity Checklist (gate for cutover)

Status, Commands, Automod, ExtAutomod, Dangerzone, ModLog, UserNotes, AutoRules, Cases,
Greet, Roles, RoleMembers, Channels, Schedule, Backups, Economy, DmTemplates (folded
into embed templates), EmbedBuilder, Settings, AI Config/Chat/Analytics/Conversations,
Modules, Data, Experiments, Landing, Docs, Server picker, Login (password + OAuth),
Command palette, Mobile nav. Each must exist and save successfully in v2 before the
bot's static serving switches.
