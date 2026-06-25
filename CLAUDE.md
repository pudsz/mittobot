# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Bot

```bash
npm install
npm start               # full local stack: SQLite + bot + API + dashboard
```

`npm start` runs `scripts/dev.js`, a dependency-free launcher that:
1. Initializes the SQLite database (creates `ggboi.sqlite` if not exists)
2. Starts the **bot + API** (`node index.js`).
3. Starts the **dashboard** Vite dev server on `:5173`, pointed at the local API (`VITE_BOT_API_URL=http://localhost:3001`).

Ctrl+C stops the bot and dashboard. Flags: `--no-dashboard`. Other scripts: `npm run bot` (bot only), `npm run dashboard` (dashboard only).

Requires a `.env` file (see `.env.example`) with at minimum:
- `BOT_TOKEN` — Discord bot token

On startup the bot initializes the SQLite schema and hydrates **all** state into
memory **before** connecting to Discord.

The bot and the web dashboard are **separate deployables** (see Web Dashboard
below). The bot process exposes a public HTTP API; the dashboard is a Vite SPA
in `dashboard/` hosted independently (e.g. Vercel).

Optional env vars (dashboard API + AI) — full list in `.env.example`:
- `DASHBOARD_PASSWORD` — enables the dashboard API (disabled if unset)
- `DASHBOARD_JWT_SECRET` — signs dashboard login JWTs (use a stable value across instances)
- `DASHBOARD_ORIGIN` — comma-separated CORS allowlist (your dashboard's URL)
- `API_PORT` — public API port (default 3001)
- `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` — AI provider keys (can also be set via the dashboard)

## Architecture

`index.js` is the entry point only — it loads command files, wires Discord events, and registers slash commands. All logic lives under `src/`.

### Context Object (`ctx`)

Every command handler receives a shared `ctx` object:
```js
{ client, data, utils, commandMap, slashMap }
```
`commandMap` is a `Map<name, commandDef>` covering both built-in and dynamic module commands.

### Command Definition Format

Each command file exports an array of command definition objects (or a single object):
```js
{
  name: "cmdname",
  description: "...",
  prefix: async (message, args, ctx) => { ... },   // prefix command handler
  slash:   new SlashCommandBuilder()...,            // slash command definition
  execute: async (interaction, ctx) => { ... },    // slash command handler
  category: "fun",            // optional: ties command to a toggleable feature group
  defaultPermission: "mod",   // optional: everyone|booster|mod|admin|owner (default everyone)
  defaultSettings: { ... },   // optional: command-specific config defaults (e.g. warn ladder)
}
```
Both `prefix` and `slash`/`execute` are optional — a command can be prefix-only or slash-only.

**Permissions are enforced centrally** by the router in `index.js` (see `checkAccess`), not in handlers. Do not re-add `isAuthorized`/`isOwner` guards to routed command handlers — set `defaultPermission` instead. (Exceptions: button/modal handlers in `settings.js`, and nuanced in-handler sub-checks like `customrole`'s self-vs-others logic.)

### Source Layout

| File | Role |
|---|---|
| `src/db.js` | SQLite connection, schema (`init()`), and all SQL (async) |
| `src/data.js` | In-memory data stores backed by SQLite (async `load`, background persist) |
| `src/settings.js` | Runtime-mutable global bot settings (settings.json) |
| `src/config.js` | Per-guild, per-command config: enable, permission, channels, cooldown, settings (commandconfig.json) |
| `src/features.js` | Toggleable command-category registry (fun/info/fakemod) |
| `src/automod.js` | Per-guild automod rules + message scanner (automod.json) |
| `src/greet.js` | Welcome/leave messages + member/message audit logs (greet.json) |
| `src/roles.js` | Autoroles + reaction-role mappings + event handlers (roles.json) |
| `src/dangerzone.js` | Per-guild dangerzone trap channels — auto-punish on message (dangerzone_config) |
| `src/utils.js` | Shared helpers: `isOwner`, `isAuthorized`, `parseDuration`, embed factories |
| `src/ai.js` | AI message routing, provider dispatch, settings read/write |
| `src/ai/providers/` | One file per AI provider (groq, openai, claude, gemini, custom) |
| `src/commands/` | Built-in command modules (incl. `fun.js`, `info.js`, `mod.js`) |
| `src/api/server.js` | Public HTTP API (JWT auth + CORS) the dashboard consumes; started on `ready` |
| `dashboard/` | Standalone Vite + React dashboard SPA (its own package; deploy to Vercel) |
| `scripts/migrate-sqlite-to-postgres.js` | One-time legacy `bot.db` → Postgres migration (`npm run migrate`) |
| `modules/` | Hot-loaded dynamic command modules (created via `$modules create`) |

### Data Persistence

All persistent state lives in **SQLite** (`src/db.js`), configured via
`SQLITE_DB_PATH` (defaults to `ggboi.sqlite`). Each domain module (`settings`, `data`, `config`, `automod`,
`greet`, `roles`) keeps an **in-memory cache** that is authoritative at runtime:
reads are synchronous (the message hot path never hits the DB), `load()` is
**async** and awaited once during startup, and writes update the cache
synchronously then persist to SQLite in the background (best-effort; errors are
logged). This keeps the bot fast and lets it scale to multiple instances sharing
one database.

Tables (created by `db.init()`): `global_settings`, `command_config`,
`automod_config`, `greet_config`, `roles_config`, `dangerzone_config`, `stickies`, `warnings`,
`reaction_logs`, `afk_users`, `custom_roles`. JSON-shaped columns are stored as
TEXT (modules `JSON.parse` them); booleans as `INTEGER` 0/1.

For data stores, mutate `data.<store>` directly and call `data.save<Store>()`
(stickies / afk / reactionlogs / customRoles persist via a transactional
full-replace; warnings persist per-row via `addWarning` / `clearWarnings`).

### Settings System

`src/settings.js` wraps `settings.json` with `get(key)` / `set(key, value)`. All keys and their defaults are in the `DEFAULTS` object. The prefix is read dynamically at runtime (not hardcoded), so `utils.PREFIX` is a getter.

Owners can configure via `$settings` / `/settings` (interactive button+modal GUI) or the web dashboard.

### AI System

`src/ai.js` handles `handleAiMessage` — fires when the bot is @mentioned or someone replies to a bot message. Routes to the active provider via `src/ai/providers/`. Providers expose:
- `chat(messages, { apiKey, model, ... })` — send messages, return reply string
- `listModels(apiKey, opts)` — optional, fetches model list for the dashboard
- `resolveModel(model)` — optional, normalizes model IDs (Groq only currently)

Adding a new provider: create `src/ai/providers/myprovider.js` following the existing pattern and register it in `src/ai/providers/index.js`.

### Dynamic Modules

`modules/` contains hot-loadable command files created via `$modules create <name>` (in-chat JS code block) or the dashboard. They are loaded at startup and can be reloaded/deleted without restarting. Each module must export `{ name, prefix?, slash?, execute? }`.

### Command Categories (toggleable features)

`src/features.js` defines toggleable command groups: `fun`, `info`, `fakemod`. A command opts into a category by setting `category: "<id>"` on its definition object. The router in `index.js` skips a command (prefix: silently; slash: ephemeral notice) when `features.isEnabled(category)` is false. Commands with no `category` (core utility, real moderation, modules, settings) are always on.

Each category is backed by a boolean settings key (`funEnabled`, `infoEnabled`, `fakeModEnabled`, all default `true`) and is toggled from the dashboard **Commands** tab (`GET`/`POST /api/features`).

To add a new togglable category: add it to `CATEGORIES` in `src/features.js`, add its `*Enabled` default in `src/settings.js`, and tag commands with `category`.

### Per-Command Configuration (`src/config.js`)

Per-guild, per-command overrides persisted to `commandconfig.json`. Shape: `{ [guildId]: { [command]: { enabled, permission, allowedRoles[], allowedChannels[], blockedChannels[], cooldown, settings{} } } }`. `config.resolve(guildId, name, def)` merges stored overrides over the command def's defaults. `config.evaluate({...})` is the single access decision (enabled → channel → permission/roles → cooldown), called by the router's `checkAccess`.

Permission ladder (ascending): `everyone < booster < mod < admin < owner`. `mod` = ManageMessages, `admin` = Administrator, computed in `config.memberLevel`. Edit via `$config` (`src/commands/config.js`) or the dashboard **Commands** tab → Per-Command Settings (`GET /api/commands`, `POST /api/commands/:name`).

**Command-specific settings** live in the `settings` bag. Flagship: `realwarn`'s escalation `ladder` (`[{count, action, duration}]`) — `src/commands/mod.js` `applyEscalation` auto-mutes/kicks/bans based on warning count. The dashboard renders a ladder editor for any command whose config has a `settings.ladder`.

### Automod (`src/automod.js`)

Per-guild rules persisted to `automod.json`: `invites`, `bannedWords`, `spam`, `massMention`, `caps`, each with `enabled` + `action` (`delete`/`warn`/`mute`). `checkMessage(message)` runs first in `messageCreate` and returns `true` if it acted (short-circuiting command processing). Exempts owners, ManageMessages holders, and configured ignored channels/roles. Dashboard **Automod** tab (`GET`/`POST /api/automod`).

### Welcome / Leave / Logs (`src/greet.js`)

Per-guild config in `greet.json`: `welcome`, `leave` (each `{enabled, channelId, message}` with `{user}/{tag}/{username}/{server}/{count}` placeholders), and `logs` (`{enabled, channelId, memberEvents, messageEvents}`). Wired to `guildMemberAdd`/`guildMemberRemove`/`messageDelete`/`messageUpdate`. Dashboard **Welcome & Logs** tab (`GET`/`POST /api/greet`).

### Autorole + Reaction Roles (`src/roles.js`)

`roles.json`: `{ autoroles[], reactionRoles{ [messageId]: { [emojiKey]: roleId } } }`. Autoroles assigned in `guildMemberAdd`; reaction roles handled in `messageReactionAdd`/`Remove` via `roles.onReaction`. Emoji key = custom emoji id or unicode char. Managed via `$autorole` / `$reactionrole` commands or the dashboard **Roles** tab (`GET /api/roles`, `POST /api/roles/autoroles`, `POST /api/roles/reaction/remove`). All role assignments respect the bot's role hierarchy position.

### Dangerzone (`src/dangerzone.js`)

Per-guild "trap channel" system designed to catch hacked accounts posting scam links. Admins designate channels as dangerzones; any message sent in one by a non-exempt user triggers an automatic punishment (kick, ban, or timeout) and is deleted. The idea is to create an invisible honeypot channel that legitimate users never post in.

Config shape: `{ [guildId]: { channels: { [channelId]: { action, timeoutMs, logChannelId, exemptRoles[], reason } } } }`. Persisted to SQLite table `dangerzone_config`. Exempt users: bot owners, ManageGuild holders, and roles in the per-channel `exemptRoles` list.

Managed via `$dangerzone` / `/dangerzone` (subcommands: `set`, `remove`, `list`, `info`, `log`, `exempt`, `unexempt`, `reason`). The `checkMessage()` hook runs in `messageCreate` right after automod and before all other processing.

### Fake vs Real Moderation

`src/commands/mod.js` contains both:
- **Fake** (`$warn`, `$kick`, `$ban`, `$mute`, `$timeout`, `$softban`, `$tempban`, `$lock`, `$slowmode`, …) — category `fakemod`. Produces output that **looks identical to the real commands** (same green ✅ embeds and wording, via `fakeModLine`) but performs no Discord actions and persists nothing. Note: the legacy `fake*Msg` template settings are no longer used by the fake commands.
- **Real** (`$realwarn`, `$realkick`, etc.) — actual timeouts/kicks/bans; duration format `30s`, `5m`, `2h`, `1d` (max 28d for timeouts).

### Fun Commands

`src/commands/fun.js` (category `fun`). Offline commands (8ball, roll, rps, ship, etc.) need no network. Networked commands (meme, joke, dadjoke, cat, dog) call free keyless public APIs via the `fetchJson` helper (global `fetch` + AbortController timeout) and fall back to an error embed if the API is unreachable.

### Permissions

- **Owner-only** — `utils.isOwner(userId)`: hardcoded set of 4 IDs in `src/utils.js`
- **Admin** — `utils.isAuthorized(message)`: owners + Discord Administrator permission
- **Custom roles** — `utils.canCreateCustomRole(member)`: owners, admins, or Nitro boosters (`member.premiumSince`)

### Key Constants

- `PREFIX` — read from settings (default `$`), runtime-changeable
- `MAX_PURGE` = 100
- `ANCHOR_ROLE_ID` = `1511836977912217781` — custom roles are positioned below this role
- `OWNER_IDS` — Set of 4 hardcoded Discord user ID strings in `src/utils.js`

### Web Dashboard (separate deployable)

The dashboard is split from the bot into two independently deployable pieces:

- **Bot side** — `src/api/server.js` starts on `ready` (only if `DASHBOARD_PASSWORD`
  is set) and serves the public REST API at `/api/*` plus `/login`. Auth is a
  stateless **JWT bearer** token signed with `DASHBOARD_JWT_SECRET` (not a cookie),
  so it works cross-origin and across scaled instances. CORS is restricted to
  `DASHBOARD_ORIGIN`. The bot is the single source of truth: every dashboard write
  goes through this API and updates the bot's live in-memory state **and** SQLite,
  so changes apply immediately without a restart.
- **Dashboard side** — `dashboard/` is a standalone **Vite + React** SPA with its
  own `package.json`, deployed independently (e.g. Vercel with root dir `dashboard/`).
  It is a pure client — it never imports bot code or touches the database. The
  bot's public URL is configured via `VITE_BOT_API_URL`. Login posts the password
  to `/login`, stores the returned JWT in `localStorage`, and sends it as
  `Authorization: Bearer` on every request.

Endpoints: status, presence, settings, AI config, feature toggles, per-command
config, automod, welcome/leave/logs, roles, dynamic-module CRUD, and read-only
data-store views.

**Security note:** `POST /api/modules` lets an authenticated client write JS that
the bot executes. Keep `DASHBOARD_PASSWORD` strong and `DASHBOARD_ORIGIN` locked
to your dashboard origin.

### Security Model (Vercel + VPS)

The dashboard is a pure static SPA on Vercel — it never touches the database.
The bot API is behind JWT auth, CORS, rate limiting (300 req/min per IP), and
login rate limiting (10 attempts/min). Always serve the bot API over HTTPS
using a reverse proxy (Caddy, nginx). See `scripts/deploy.md` for the full
deployment guide.

### Sticky Messages

1500ms debounce per channel — when any non-sticky message is sent in a channel that has a sticky, the old sticky is deleted and reposted. Implemented in `src/commands/sticky.js` / `handleStickyRepost`.
