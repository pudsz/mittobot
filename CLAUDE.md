# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Bot

```bash
npm install
node index.js
```

Requires a `.env` file with at minimum `BOT_TOKEN=<your_discord_bot_token>`.

Optional env vars:
- `DASHBOARD_PASSWORD` — enables the web dashboard (disabled if unset)
- `DASHBOARD_PORT` — dashboard port (default: 3000)
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
| `src/data.js` | Flat-file data stores (load/save/helpers) |
| `src/settings.js` | Runtime-mutable global bot settings (settings.json) |
| `src/config.js` | Per-guild, per-command config: enable, permission, channels, cooldown, settings (commandconfig.json) |
| `src/features.js` | Toggleable command-category registry (fun/info/fakemod) |
| `src/automod.js` | Per-guild automod rules + message scanner (automod.json) |
| `src/greet.js` | Welcome/leave messages + member/message audit logs (greet.json) |
| `src/roles.js` | Autoroles + reaction-role mappings + event handlers (roles.json) |
| `src/utils.js` | Shared helpers: `isOwner`, `isAuthorized`, `parseDuration`, embed factories |
| `src/ai.js` | AI message routing, provider dispatch, settings read/write |
| `src/ai/providers/` | One file per AI provider (groq, openai, claude, gemini, custom) |
| `src/commands/` | Built-in command modules (incl. `fun.js`, `info.js`, `mod.js`) |
| `src/dashboard/server.js` | Express dashboard (started on `ready`) |
| `modules/` | Hot-loaded dynamic command modules (created via `$modules create`) |

### Data Persistence

JSON flat files in the project root, loaded at startup, written on change:
- `stickies.json` — per-channel sticky messages
- `warnings.json` — user warning records
- `reactionlogs.json` — channels configured for reaction logging
- `afk.json` — active AFK statuses
- `customroles.json` — user-created custom roles
- `settings.json` — runtime bot settings (prefix, fake-mod messages, AI config)

Mutate `data.<store>` directly and call `data.save<Store>()` to persist.

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

### Web Dashboard

Started automatically on `ready` if `DASHBOARD_PASSWORD` is set. Serves `src/dashboard/public/index.html` and a REST API at `/api/*` (auth via session cookie). Exposes: status, presence, settings, AI config, module CRUD, and read-only data store views.

### Sticky Messages

1500ms debounce per channel — when any non-sticky message is sent in a channel that has a sticky, the old sticky is deleted and reposted. Implemented in `src/commands/sticky.js` / `handleStickyRepost`.
