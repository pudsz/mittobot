# ggboi — DeepSeek Implementation Log

> ⚠️ **MANDATE: This file MUST be updated every time a change is made to the project.**
> Any AI agent (DeepSeek, Claude, Codebuff, etc.) that modifies the codebase is required to
> append a new phase entry documenting all changes, files added/modified, and validation results.
> This is the single source of truth for project history. Do not skip this.

> Comprehensive documentation of all AI-assisted changes made to the ggboi Discord bot.
> Spans multiple sessions from initial context analysis through full dashboard + moderation overhaul.

---

## Table of Contents

1. [Phase 1: Analysis & Planning](#phase-1-analysis--planning)
2. [Phase 2: Safe Error Handling (Improvement #2)](#phase-2-safe-error-handling-improvement-2)
3. [Phase 3: Multi-Guild Dashboard (Improvement #4)](#phase-3-multi-guild-dashboard-improvement-4)
4. [Phase 4: Dashboard UI Revamp (Dyno-Style)](#phase-4-dashboard-ui-revamp-dyno-style)
5. [Phase 5: Database Schema Extensions](#phase-5-database-schema-extensions)
6. [Phase 6: Extended Automod Rules](#phase-6-extended-automod-rules)
7. [Phase 7: Weighted Warning System](#phase-7-weighted-warning-system)
8. [Phase 8: DM Templates](#phase-8-dm-templates)
9. [Phase 9: Moderation Log & User Notes](#phase-9-moderation-log--user-notes)
10. [Phase 10: Probation System](#phase-10-probation-system)
11. [Phase 11: Auto-Execute Rules Engine (Schema + API)](#phase-11-auto-execute-rules-engine-schema--api)
12. [Phase 12: New API Endpoints](#phase-12-new-api-endpoints)
13. [Phase 13: Startup/Shutdown Wiring](#phase-13-startupshutdown-wiring)
14. [Phase 14: Dashboard Tab Components (5 New Tabs)](#phase-14-dashboard-tab-components-5-new-tabs)
15. [Phase 15: Vite Proxy & API Connection Fix](#phase-15-vite-proxy--api-connection-fix)
16. [Phase 16: Auto-Execute Rules Runtime Engine](#phase-16-auto-execute-rules-runtime-engine)
17. [Phase 17: Probation Role Removal Fix](#phase-17-probation-role-removal-fix)
18. [Phase 18: Loading/Retry Indicator & dev.js Fix](#phase-18-loadingretry-indicator--devjs-fix)
19. [Phase 19: Dropdown Select Replaces Chip Buttons](#phase-19-dropdown-select-replaces-chip-buttons)
20. [Files Changed Summary](#files-changed-summary)
21. [What's Left Undone](#whats-left-undone)

---

## Phase 1: Analysis & Planning

**Goal:** Understand the full codebase and identify the highest-impact improvements.

### Research Conducted
- Analyzed ~40+ source files across the entire bot
- Researched Dyno, MEE6, Carl-bot dashboards for UX patterns
- Researched common Discord moderation complaints (Reddit, forums)
- Prioritized 15 potential improvements by impact vs effort

### Key Findings
- Bot was well-architected but had ~50+ instances of silent `.catch(() => null)` error swallowing
- Dashboard was single-guild only (always used `cache.first()`)
- Warning system was flat count-based with no severity/decay/probation
- Automod was missing link filtering, repeated text, emoji spam, zalgo detection
- No DM notifications on punishment
- No moderation audit log
- No user mod notes
- Dashboard had "AI aesthetic" with gradients and heavy animations

### Priority Ranking
| Rank | Improvement | Effort | Impact |
|------|-------------|--------|--------|
| 1 | Safe error handling | Small | High |
| 2 | Multi-guild dashboard | Medium | High |
| 3 | Dashboard UI revamp | Large | High |
| 4 | Weighted warning system | Medium | High |
| 5 | Extended automod | Medium | High |
| 6 | DM templates | Medium | Medium |
| 7 | Moderation log | Medium | Medium |
| 8 | Probation system | Medium | High |
| 9 | Auto-exec engine | Large | High |
| 10 | User notes | Small | Medium |

---

## Phase 2: Safe Error Handling (Improvement #2)

**Replaces all silent `.catch(() => null)` with actionable error logging.**

### New File: `src/safe.js`

A utility module with:
- **`orNull(promise, label)`** — catches errors, logs `[safe] <label>: <error>`, returns null
- **10 convenience wrappers** — `send`, `reply`, `edit`, `deleteMsg`, `react`, `timeout`, `ban`, `kick`, `addRole`, `removeRole`

Each wrapper provides a human-readable context label so you can tell exactly what failed in logs.

### Files Edited (14 total)
- `index.js` — 9 replacements + import
- `src/ai.js` — 3 replacements + import (fixed: path was `../safe`, corrected to `./safe`)
- `src/dangerzone.js` — 3 replacements + import
- `src/roles.js` — 7 replacements + import
- `src/greet.js` — 1 replacement + import
- `src/automod.js` — 5 replacements + import
- `src/ai/tools.js` — 8 replacements + import
- `src/commands/info.js` — 5 replacements + import
- `src/commands/utility.js` — 5 replacements + import
- `src/commands/reactionrole.js` — 4 replacements + import
- `src/commands/scrape.js` — 5 replacements + import (fixed: `editReply` is a function, not a Message)
- `src/commands/sticky.js` — 4 replacements + import
- `src/commands/mod.js` — 15 replacements + import
- `src/commands/customrole.js` — 4 replacements + import

### Bugs Caught During Review
1. **`src/ai.js`** — Leftover `.catch(() => null)` inside `safe.orNull()` was silently swallowing errors
2. **`src/commands/scrape.js`** — `safe.edit(editReply, ...)` where `editReply` is a function, not a Message object
3. **`src/commands/mod.js`** — Syncperms fallback with `progress?.editable` (always true) was dead code
4. **`src/ai.js`** — `require("../safe")` path was wrong (both files in `src/`)

### Validation
- **0** remaining `.catch(() => null)` patterns in source files
- All modules load without syntax errors

---

## Phase 3: Multi-Guild Dashboard (Improvement #4)

**Refactored the API server and dashboard to support multiple Discord guilds instead of always using `cache.first()`.**

### API Server Changes (`src/api/server.js`)

New helpers:
- **`resolveGuild(guildId)`** — resolves by ID, falls back to `cache.first()` (backward compatible)
- **`reqGuildId(req)`** — extracts from `req.query.guildId` (GET) or `req.body.guildId` (POST)
- **`listGuilds()`** — returns all guilds sorted by name

New endpoint:
- **`GET /api/guilds`** — returns `{ guilds: [{ id, name, memberCount, iconURL }] }`

All guild-scoped endpoints updated to accept optional `guildId`:
- `/api/ai/memories`, `/api/commands`, `/api/channels`, `/api/automod`, `/api/greet`, `/api/roles`

### Dashboard Changes

`App.jsx`:
- Fetches guild list on mount via `GET /api/guilds`
- Shows dropdown selector if >1 guild, shows name if 1 guild
- Passes `guildId` prop to all 5 guild-scoped tabs

Tab components updated (CommandsTab, AutomodTab, GreetTab, RolesTab, ChannelsTab):
- Accept `guildId` prop
- Append `?guildId=xxx` to GET requests
- Include `guildId` in POST body
- Re-fetch when guild changes via `useEffect([guildId])`

---

## Phase 4: Dashboard UI Revamp (Dyno-Style)

**Complete visual overhaul from "AI aesthetic" (gradients, glows, animations) to Dyno-inspired utilitarian dark admin theme.**

### New CSS Variables
```css
:root {
  --bg: #0d1117;        /* GitHub-dark background */
  --surface: #21262d;    /* Card surface */
  --border: #30363d;     /* Subtle borders */
  --accent: #58a6ff;     /* Blue accent */
  --text: #e6edf3;       /* Light text */
  --font-mono: "SF Mono", "JetBrains Mono", monospace;
}
```

### Design Principles
- **Flat, bordered panels** — no backdrop-blur, no gradients
- **Compact density** — tighter padding, smaller fonts, more information per view
- **Functional colors** — green for success, red for danger, orange for warnings, blue for info
- **Minimal animations** — only `fadeIn` and `slideDown` where functional
- **Consistent spacing** — 4px/8px/12px/16px/20px scale
- **Better table styling** — compact rows, sticky headers, hover states
- **Sub-tabs navigation** — for in-page section navigation
- **Ladder editor** — compact grid layout for warning escalation steps
- **Mod log viewer** — grid rows with color-coded action labels

### Key UX Changes
- Login: simpler card, no emoji, smaller header
- Sidebar: compact 240px, tighter nav buttons, smaller status indicator
- Header: breadcrumb-style `ggboi / Status` title
- Main panels: flat borders, no hover glow effects
- Buttons: flat with subtle hover borders, no gradients
- Toggle switches: smaller, green when active
- Chips: more compact border-radius pills
- Tables: 12px font, compact padding
- Feature cards: flat bordered, no glass morphism

---

## Phase 5: Database Schema Extensions

**Extended SQLite schema with 8 new tables and additional columns.**

### New/Modified Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `warnings` (modified) | Added severity & points | `severity INTEGER`, `points INTEGER` |
| `mod_notes` | Per-user moderator notes | `guild_id`, `user_id`, `content`, `by`, `timestamp` |
| `probation` | Auto-expiring restricted role assignments | `guild_id`, `user_id`, `role_id`, `expires_at`, `warning_count` |
| `moderation_log` | Full audit trail of all actions | `id`, `guild_id`, `user_id`, `mod_id`, `action`, `reason`, `details`, `timestamp` |
| `dm_templates` | Customizable DM messages per action | `guild_id`, `action`, `message`, `enabled` |
| `automod_extended` | Extended automod config | `link_blacklist`, `link_whitelist`, `repeated_text`, `emoji_spam`, `zalgo_enabled` + action fields |
| `autoexec_rules` | Trigger→condition→action rules engine | `trigger_event`, `conditions`, `actions`, `enabled`, `priority` |

### New Query Functions (21 total)

Warnings:
- `getWarningsSince(guildId, userId, sinceTimestamp)` — time-windowed query
- `getTotalWarningPoints(guildId, userId, sinceTimestamp)` — weighted sum
- `getWarningCount(guildId, userId, sinceTimestamp)` — count in window

Mod Notes:
- `getModNotes(guildId, userId)`, `addModNote(...)`, `deleteModNote(id)`

Probation:
- `getProbation(guildId, userId)`, `setProbation(...)`, `removeProbation(guildId, userId)`, `getAllProbations()`

Moderation Log:
- `getModLog(guildId, limit)`, `getModLogForUser(guildId, userId, limit)`, `addModLogEntry(...)`

DM Templates:
- `getDmTemplate(guildId, action)`, `setDmTemplate(...)`, `getAllDmTemplates(guildId)`

Extended Automod:
- `getExtendedAutomod(guildId)`, `setExtendedAutomod(guildId, cfg)`

Auto-Execute Rules:
- `getAutoExecRules(guildId)`, `setAutoExecRule(guildId, rule)`, `deleteAutoExecRule(id)`

---

## Phase 6: Extended Automod Rules

**Added 4 new automod detection capabilities to `src/automod.js`.**

### New Detection Helpers

1. **Link Filtering** (`hasBlacklistedLink`)
   - Parses URLs from message content
   - Checks against domain blacklist
   - Supports whitelist for exempt domains
   - Configurable action: delete/warn/mute

2. **Repeated Text** (`hasRepeatedText`)
   - Detects same sentence/line repeated N+ times
   - Detects same word repeated 3N+ times (spam bot pattern)
   - Configurable threshold and action

3. **Emoji Spam** (`emojiCount`)
   - Counts custom emoji (`<:name:id>`) and unicode emoji ranges
   - Configurable max count and action

4. **Zalgo/Unicode Abuse** (`hasZalgo`)
   - Detects excessive combining characters (unicode diacritical marks)
   - Triggers if >20% of characters are combining marks

### In-Memory Cache
- `exStore` — separate cache for extended automod config
- Loaded in parallel with standard automod during `load()`
- `getExtendedConfig(guildId)` / `setExtendedConfig(guildId, patch)` functions

### Integration
- Extended checks run between standard automod rules and spam detection
- Uses the same `enforce()` + `logAction()` pipeline
- Each rule has its own configurable action (`link_action`, `repeated_text_action`, `emoji_action`, `zalgo_action`)

---

## Phase 7: Weighted Warning System

**Overhauled the warning system in `src/commands/mod.js` from flat count-based to weighted points with severity.**

### New Ladder Format
```js
// Old (flat count)
{ count: 2, action: "mute", duration: "10m" }

// New (supports both count & points)
{ type: "count", threshold: 2, action: "mute", duration: "10m" }
{ type: "points", threshold: 5, action: "probation", probationRoleId: "...", probationDuration: "7d" }
```

### Backward Compatibility
- `ladderActionFor()` checks both `s.threshold` and `s.count` via `s.threshold ?? s.count`
- Default ladder uses `type: "count"` format
- Guilds with saved ladders using old `{ count }` format continue working

### Severity Levels
| Severity | Label | Points |
|----------|-------|--------|
| 1 | Minor | 1 |
| 2 | Moderate | 2 |
| 3 | Severe | 3 |
| 4 | Critical | 4 |
| 5 | Extreme | 5 |

### Discord Command Usage
**Prefix:** `$realwarn @user 3 Spamming in chat`
**Slash:** `/realwarn user: @user severity: 3 reason: Spamming in chat`

### Escalation Types
- `mute` — timeout member for duration
- `kick` — kick member from server
- `ban` — ban member with 7d message deletion
- `probation` — assign probation role for duration (new!)
- `none` — no escalation

### Time-Decay Ready
- `getActiveWarningCount(data, guildId, userId, decayMs)` — filters warnings within time window
- When `decayMs` is set, only warnings within that window count toward escalation
- Currently called with `0` (no decay) — ready for configurable decay settings

---

## Phase 8: DM Templates

**Added configurable DM notifications sent to users when they are warned, muted, kicked, or banned.**

### Default Templates
```js
const DM_TEMPLATE_DEFAULTS = {
  warn:   "⚠️ You've been warned in **{server}**. Reason: {reason}",
  mute:   "🔇 You've been muted in **{server}** for {duration}. Reason: {reason}",
  kick:   "👢 You've been kicked from **{server}**. Reason: {reason}",
  ban:    "🔨 You've been banned from **{server}**. Reason: {reason}",
  unmute: "🔊 You've been unmuted in **{server}**.",
  unban:  "You've been unbanned from **{server}**.",
};
```

### Placeholders
- `{user}` — @mention
- `{username}` — username
- `{server}` — server name
- `{reason}` — punishment reason
- `{duration}` — duration string (for mutes)
- `{mod}` — moderator name

### Storage
- Per-guild, per-action templates stored in `dm_templates` table
- Each template has an `enabled` flag (default: 1)
- Falls back to defaults if no guild template exists

### Integration
- Called from `execRealMod()` for warn, mute, kick, ban actions
- Uses `safe.orNull()` so DM failures never crash the command
- Error is silently caught — if DM is closed, the punishment still goes through

---

## Phase 9: Moderation Log & User Notes

### Moderation Log (`moderation_log` table)
- Every real moderation action is logged: warn, mute, kick, ban
- Stores: `guild_id`, `user_id`, `mod_id`, `action`, `reason`, `details`, `timestamp`
- Queryable by guild (last 100) or by user (last 50)
- API endpoints: `GET /api/modlog` and `GET /api/modlog/:userId`

### User Notes (`mod_notes` table)
- Free-form text notes attached to users
- Stores: `guild_id`, `user_id`, `content`, `by`, `timestamp`
- API endpoints: `GET/POST /api/modnotes/:userId`, `DELETE /api/modnotes/:id`

---

## Phase 10: Probation System

**Auto-expiring restricted role assignments triggered by warning escalation.**

### How It Works
1. An escalation step with `action: "probation"` is added to the ladder
2. When triggered, the bot assigns the specified `probationRoleId` role to the member
3. The `probationDuration` (e.g., "7d") determines how long the probation lasts
4. `expires_at` is stored in the `probation` table
5. A cleanup interval runs every 5 minutes, removing expired probations

### Configuration
```js
// In the warn ladder:
{ type: "count", threshold: 3, action: "probation",
  probationRoleId: "123456789", probationDuration: "7d" }
```

### Cleanup Timer
- Started during bot bootstrap (in `index.js`)
- `startProbationCleanup()` — 5-minute interval
- `stopProbationCleanup()` — called during graceful shutdown
- Uses `timer.unref()` so it doesn't prevent process exit

### Known Limitation (since resolved — see Phase 17)
- Cleanup originally only removed DB records but didn't remove Discord role from members
- Fixed in Phase 17 with `setClient()` integration

---

## Phase 11: Auto-Execute Rules Engine (Schema + API)

**Database schema and API endpoints for a trigger-condition-action automation system.**

### Schema
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `guild_id` | TEXT | Guild scope |
| `trigger_event` | TEXT | Event type (e.g., `warn`, `kick`, `ban`, `join`) |
| `conditions` | TEXT (JSON) | Conditions to check before executing |
| `actions` | TEXT (JSON array) | Actions to execute when triggered |
| `enabled` | INTEGER | 0/1 |
| `priority` | INTEGER | Execution order |

### API Endpoints
- `GET /api/autoexec` — list rules for guild
- `POST /api/autoexec` — create/update rule
- `DELETE /api/autoexec/:id` — delete rule

### Status (at time of writing)
- Schema and API ready
- Runtime execution engine not yet implemented (since resolved — see Phase 16)

---

## Phase 12: New API Endpoints

**14 new endpoints added to `src/api/server.js`.**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/automod/extended` | GET | Get extended automod config |
| `/api/automod/extended` | POST | Update extended automod config |
| `/api/modlog` | GET | Get moderation log (last 100 entries) |
| `/api/modlog/:userId` | GET | Get mod log for specific user |
| `/api/dm-templates` | GET | Get all DM templates for guild |
| `/api/dm-templates` | POST | Set a DM template |
| `/api/modnotes/:userId` | GET | Get mod notes for user |
| `/api/modnotes/:userId` | POST | Add mod note for user |
| `/api/modnotes/:id` | DELETE | Delete a mod note |
| `/api/autoexec` | GET | List auto-exec rules |
| `/api/autoexec` | POST | Create/update auto-exec rule |
| `/api/autoexec/:id` | DELETE | Delete auto-exec rule |
| `/api/probation` | GET | List active probations |
| `/api/probation/:userId` | DELETE | Remove a probation |

---

## Phase 13: Startup/Shutdown Wiring

**Added probation cleanup lifecycle to the bot's startup and shutdown sequence in `index.js`.**

### Bootstrap (after data loading)
```js
const mod = require("./src/commands/mod");
mod.startProbationCleanup();
```

### Shutdown (before Discord client destroy)
```js
const mod = require("./src/commands/mod");
mod.stopProbationCleanup();
```

---

## Phase 14: Dashboard Tab Components (5 New Tabs)

**Implemented the 5 missing React dashboard components that expose backend features added in Phases 6–12.**

### New Components

| Component | File | Purpose |
|-----------|------|---------|
| **ModerationLogTab** | `dashboard/src/components/ModerationLogTab.jsx` | Searchable, filterable audit log viewer with action color-coding, user ID lookups, and text search |
| **DmTemplateTab** | `dashboard/src/components/DmTemplateTab.jsx` | Per-action DM message editor with toggle, placeholder reference card, and reset-to-default per template |
| **AutoExecTab** | `dashboard/src/components/AutoExecTab.jsx` | Trigger→condition→action rule builder with priority ordering, inline action editor, add/remove actions |
| **UserNotesTab** | `dashboard/src/components/UserNotesTab.jsx` | Per-user mod note viewer/editor with search-by-user-ID, add, and delete |
| **ExtendedAutomodTab** | `dashboard/src/components/ExtendedAutomodTab.jsx` | Link blacklist/whitelist (domain list editors), repeated text thresholds, emoji spam max count, zalgo detection toggles |

### Bugs Caught & Fixed During Review

1. **AutoExecTab.jsx (critical)** — The rule editor state was derived from props each render, causing edits to be lost immediately. Rewrote with proper `useState` using immutable updater functions.
2. **Unused imports** — `UserIcon` and `Filter` in ModerationLogTab, `Send` in UserNotesTab — removed.
3. **Dashboard build** required `npm install` in the `dashboard/` directory (gitignored `node_modules/`).

### Side Fix: `scripts/dev.js` — `shuttingDown` ReferenceError

- Missing `let shuttingDown = false;` declaration caused crash when the bot process exited
- Added declaration before `shutdown()` function

### Files Modified
- `dashboard/src/App.jsx` — Registered all 5 new tabs in TABS constant
- `scripts/dev.js` — Fixed `shuttingDown` is not defined error

### Validation
- `npm run build` in `dashboard/` — **passes** (1591 modules, 6.67s)

---

## Phase 15: Vite Proxy & API Connection Fix

**Fixed "NetworkError when attempting to fetch resource" by adding a Vite dev proxy to eliminate cross-origin API calls.**

### Problem
The dashboard (Vite on port 5173) made direct cross-origin `fetch()` calls to the bot's API (port 3001). This could fail due to:
- CORS misconfiguration when `DASHBOARD_ORIGIN` is not set
- Timing race where the dashboard loaded before the API was ready
- Stale port bindings from orphaned processes

### Solution
- **`dashboard/vite.config.js`** — Added `server.proxy` to forward `/api/*` and `/login` to `http://0.0.0.0:3001`
- **`scripts/dev.js`** — Removed `VITE_BOT_API_URL` env var passthrough — the SPA now uses same-origin requests through Vite's proxy
- The proxy reads `VITE_BOT_API_URL` with fallback to `http://0.0.0.0:3001`, so it's still configurable
- For production (Vercel), the env var is set at build time and `api.js` uses it for direct fetches

### Files Modified
- `dashboard/vite.config.js` — Added `server.proxy` config
- `scripts/dev.js` — Removed `VITE_BOT_API_URL` from dashboard env

### Validation
- `npm run build` in `dashboard/` — **passes**

---

## Phase 16: Auto-Execute Rules Runtime Engine

**Implemented the runtime engine for auto-execute rules so they actually fire when trigger events occur (resolves Phase 11 gap).**

### New File: `src/autoexec.js`

An in-memory cached rule engine with:

| Export | Purpose |
|--------|---------|
| `load()` | Loads all enabled rules from SQLite into cache at startup |
| `getRules(guildId)` | Returns cached rules for a guild |
| `hasRules(guildId)` | Quick boolean check to skip work on the message hot path |
| `reloadGuild(guildId)` | Reloads a single guild's rules (called after API saves) |
| `reload()` | Full cache reload (called after API deletes) |
| `executeTrigger(guildId, event, context)` | Core engine: filter matching rules, evaluate conditions, execute actions |
| `evaluateConditions(conditions, context)` | Condition evaluator |

### Condition Types Supported
- `min_warning_count` / `max_warning_count` — filter by total warnings
- `has_role` / `not_has_role` — filter by role membership
- `reason_contains` — substring match on moderation reason
- `min_severity` — minimum warning severity level

### Action Types Implemented
| Action | Behavior |
|--------|----------|
| `dm_user` | Sends a formatted DM to the affected user |
| `dm_mod` | Sends a formatted DM to the moderator who performed the action |
| `log_channel` | Sends a message to the guild's system channel (or first writable text channel) |
| `add_role` | Assigns a role to the user (respects role hierarchy) |
| `remove_role` | Removes a role from the user |

### Event Hooks Wired

| Event | Where | Context Passed |
|-------|-------|----------------|
| `warn` | `src/commands/mod.js` — after `execRealMod` warn | guild, member, reason, severity, warning count, moderator |
| `mute` | `src/commands/mod.js` — after `execRealMod` mute | guild, member, reason, duration, moderator |
| `kick` | `src/commands/mod.js` — after `execRealMod` kick | guild, member, reason, moderator |
| `ban` | `src/commands/mod.js` — after `execRealMod` ban | guild, member, reason, moderator |
| `join` | `index.js` — `guildMemberAdd` | guild, member |
| `leave` | `index.js` — `guildMemberRemove` | guild, user |
| `message` | `index.js` — `messageCreate` | guild, user, member, message content/channel |

### Bugs Caught & Fixed During Review

1. **Cache invalidation (critical)** — Rules created/edited/deleted via the dashboard API were saved to SQLite but the in-memory `rulesCache` was never updated. Fix: `reloadGuild()` call added after `POST /api/autoexec`, `reload()` call added after `DELETE /api/autoexec/:id` in `src/api/server.js`.
2. **`dm_mod` dead action** — The `moderatorUserId` was passed as `null` from `execRealMod()`, so `dm_mod` actions were always skipped. Fix: added `moderatorId` to `execRealMod` options, prefixed handlers pass `message.author.id`, slash handlers pass `interaction.user.id`.
3. **Message event overhead** — `executeTrigger` was called on every message unconditionally. Fix: added `hasRules()` guard in `index.js` to skip the function call for guilds with no rules.

### Files Modified
- `src/autoexec.js` — **NEW** — Runtime engine
- `src/commands/mod.js` — Import + autoexec calls after each moderation action
- `index.js` — Import, ctx, bootstrap load, event hooks (messageCreate, guildMemberAdd, guildMemberRemove)
- `src/api/server.js` — Cache invalidation after autoexec API writes

### Validation
- `node -e "require('./src/autoexec')"` — **passes**
- All 4 modified files load without syntax errors

---

## Phase 17: Probation Role Removal Fix

**Fixed the probation cleanup timer to actually remove the Discord role from members when probation expires (resolves Phase 10 limitation).**

### Problem
The 5-minute cleanup interval (`startProbationCleanup()` in `mod.js`) only deleted the database record (`db.removeProbation`). The Discord role remained on the member indefinitely.

### Solution
- Added `clientRef` module-level variable to store the Discord client reference
- Added `setClient(client)` export to `mod.js`
- Added `removeExpiredProbationRole(p)` helper that:
  1. Gets the guild from `clientRef.guilds.cache`
  2. Fetches the member from the guild
  3. Removes the role `p.role_id` from the member using `safe.removeRole`
  4. Falls back gracefully if guild/member/role is gone
- Updated the cleanup interval to call role removal *before* removing the DB record
- Wired `setClient(client)` into `index.js` bootstrap before starting the timer

### Edge Cases Handled
- Guild removed from cache (bot was removed) — silently skips
- Member left the guild — `members.fetch()` throws, caught by `safe.orNull`
- Role deleted from guild — `roles.cache.get()` returns undefined, skips
- Role above bot's hierarchy — `safe.removeRole` wraps the error silently

### Files Modified
- `src/commands/mod.js` — Added `clientRef`, `setClient`, `removeExpiredProbationRole`
- `index.js` — Calls `mod.setClient(client)` in bootstrap

### Validation
- `node -e "const m = require('./src/commands/mod'); console.log(typeof m.setClient)"` — **passes**, shows `function`

---

## Phase 18: Loading/Retry Indicator & dev.js Fix

**Added a connecting screen with spinner while the dashboard waits for the API, with exponential backoff retry logic.**

### ConnectingScreen Component
- Shown when `authed === null` (initial loading state)
- CSS spinner animation using theme accent color
- Progress bar showing retry progress (fills up as attempts increase)
- "Attempt X of N" counter
- After 8 failed attempts, shows a "Could not connect" message with a manual **Retry connection** button

### Retry Logic
- **Exponential backoff**: `1.5^x` seconds (1s → 1.5s → 2.25s → ... → capped at 16s)
- **Max 8 retries** (~45s total before showing failure screen)
- Uses `mountedRef` to prevent state updates after unmount
- Uses `timerRef` for proper timeout cleanup
- `onUnauthorized` callback still works to redirect to login on 401

### Side Fix: dev.js `shuttingDown` Fix

In a previous session, `scripts/dev.js` was missing the `let shuttingDown = false;` declaration. This was fixed in Phase 14 but is noted here for completeness.

### Files Modified
- `dashboard/src/App.jsx` — Replaced empty `null` render with `ConnectingScreen`, added retry state/logic
- `dashboard/src/styles.css` — Added `@keyframes spin` and `.spinner` class

### Validation
- `npm run build` in `dashboard/` — **passes** (4.42s)

---

## Phase 19: Dropdown Select Replaces Chip Buttons

**Replaced the inline chip button picker (`ChipPicker`) with a searchable multi-select dropdown (`DropdownSelect`) for all role/channel selectors across the dashboard.**

---

## Phase 20: AI Tools Import Path Fix

**Fixed a broken `require` path in `src/ai/tools.js` that caused `Cannot find module '../../safe'` at runtime on AI interactions.**

### Problem
`src/ai/tools.js` used `require("../../safe")` which resolved to the project root (e.g. `ggboi/safe`), but `safe.js` lives at `ggboi/src/safe`. The correct path is `../safe` (from `src/ai/` up to `src/`, then find `safe`).

This error was surfaced when the bot tried to process an AI interaction (ping or reply):
```
[bot] AI reply error: Cannot find module '../../safe'
[bot] Require stack:
[bot] - /home/marsh/Downloads/ggboi/src/ai/tools.js
[bot] - /home/marsh/Downloads/ggboi/src/ai.js
[bot] - /home/marsh/Downloads/ggboi/index.js
```

### Fix
- `src/ai/tools.js` — Changed `require("../../safe")` → `require("../safe")`

### Validation
- `node -e "require('./src/ai/tools')"` — **passes**
- `node -e "require('./src/ai')"` — **passes**
- The AI module chain (tools → ai → index) now loads without errors.

---

*This file must be updated whenever changes are made to the project. See mandate at the top of this file.*

### Problem
The original `ChipPicker` rendered ALL items (roles, channels) as inline clickable chips/badges. In servers with 100+ roles or 50+ channels, this was unusable — the list overflowed horizontally, scrolled awkwardly, and took up massive vertical space.

### New Component: `DropdownSelect.jsx`

A multi-select dropdown with:
- **Trigger button** — shows placeholder text when nothing selected, single item name when 1 selected, "N selected" count when 2+
- **Searchable dropdown** — opens on click, auto-focuses search input, filters items in real-time
- **Checkbox items** — each item has a checkbox, checked state is visually distinct
- **Keyboard support** — Escape closes the dropdown and returns focus to the trigger
- **Outside-click close** — closes dropdown when clicking outside the component
- **Scroll limit** — `max` prop limits visible items before scrolling (default 12)
- **Block variant** — `variant="block"` switches accent colors to red for "blocked channels" use (red checkbox, red text, red-subtle background)
- **Footer** — shows selection count and Done button
- **Full keyboard accessible** — proper `aria-haspopup`, `aria-expanded`, `role="listbox"`, `aria-selected`

### Dropdown Positions Affected (7 total)

| Tab | Selector | Variant |
|-----|----------|---------|
| CommandsTab | Allowed channels | normal |
| CommandsTab | Blocked channels | **block** |
| CommandsTab | Extra allowed roles | normal |
| AutomodTab | Ignored channels | normal |
| AutomodTab | Ignored roles | normal |
| RolesTab | Autoroles | normal |
| ChannelsTab | Custom channel items (name · category) | normal, max=8 |

### Files Modified/Created
- `dashboard/src/components/DropdownSelect.jsx` — **NEW** — Multi-select dropdown with search
- `dashboard/src/components/CommandsTab.jsx` — Replaced 3 ChipPicker instances with DropdownSelect
- `dashboard/src/components/AutomodTab.jsx` — Replaced 2 ChipPicker instances with DropdownSelect
- `dashboard/src/components/RolesTab.jsx` — Replaced 1 ChipPicker instance with DropdownSelect
- `dashboard/src/components/ChannelsTab.jsx` — Replaced 1 ChipPicker instance with DropdownSelect
- `dashboard/src/styles.css` — Replaced ChipPicker CSS with DropdownSelect CSS (search, menu, items, footer, block variant)

### Files Deleted
- `dashboard/src/components/ChipPicker.jsx` — No longer imported anywhere

### Bugs Caught & Fixed During Review

1. **Block variant visual inconsistency** — The block variant changed checkbox accent and text color to red, but the `.dropdown-item.on` background was still blue (`var(--accent-subtle)`). Fixed by adding `.dropdown-menu.block .dropdown-item.on { background: var(--red-subtle); }`.

### Validation
- `npm run build` in `dashboard/` — **passes** (1591 modules, 7.03s)

---

## Files Changed Summary

### New Files
| File | Phase | Description |
|------|-------|-------------|
| `DEEPSEEK.md` | All | This file — implementation log |
| `src/safe.js` | 2 | Safe error handling utility |
| `src/autoexec.js` | 16 | Auto-execute rules runtime engine |
| `dashboard/src/components/ModerationLogTab.jsx` | 14 | Moderation log viewer tab |
| `dashboard/src/components/DmTemplateTab.jsx` | 14 | DM template editor tab |
| `dashboard/src/components/AutoExecTab.jsx` | 14 | Auto-execute rules manager tab |
| `dashboard/src/components/UserNotesTab.jsx` | 14 | User notes panel tab |
| `dashboard/src/components/ExtendedAutomodTab.jsx` | 14 | Extended automod settings tab |

### Modified Files
| File | Phase(s) | Description |
|------|----------|-------------|
| `index.js` | 2, 13, 16, 17 | Safe error handling, bootstrap, autoexec hooks, setClient, shutdown |
| `src/commands/mod.js` | 2, 7, 8, 9, 10, 16, 17 | Weighted warnings, escalations, DM templates, probation, autoexec integration, role removal |
| `src/api/server.js` | 3, 12, 16 | Multi-guild support, 14 new endpoints, autoexec cache invalidation |
| `src/db.js` | 5 | 8 new tables, 21 new query functions |
| `src/automod.js` | 2, 6 | Extended automod rules |
| `src/data.js` | 7 | Warning points helpers |
| `scripts/dev.js` | 14, 15 | `shuttingDown` fix, Vite proxy env removal |
| `dashboard/src/App.jsx` | 3, 4, 14, 18 | Guild selector, CSS revamp, 5 new tabs, connecting/retry screen |
| `dashboard/src/styles.css` | 4, 18 | Dyno-style theme, spinner animation |
| `dashboard/src/components/*.jsx` | 3, 14 | Guild-scoped tab components |
| `dashboard/vite.config.js` | 15 | Vite dev proxy config |
| `dashboard/src/api.js` | 15 | BASE URL fallback to same-origin |

### Files with `.catch(() => null)` replaced (Phase 2)
- `index.js`, `src/ai.js`, `src/dangerzone.js`, `src/roles.js`, `src/greet.js`
- `src/automod.js`, `src/ai/tools.js`, `src/commands/info.js`, `src/commands/utility.js`
- `src/commands/reactionrole.js`, `src/commands/scrape.js`, `src/commands/sticky.js`
- `src/commands/mod.js`, `src/commands/customrole.js`

---

## What's Left Undone

### Runtime Features
- **Warning time-decay configuration** — the `getActiveWarningCount` helper is ready but there's no dashboard UI or command to set the decay window per guild

### Testing
- No unit tests for weighted warning system
- No unit tests for extended automod detection helpers
- No unit tests for auto-exec rule engine
- No integration tests for new API endpoints

---

*This file must be updated whenever changes are made to the project. See mandate at the top of this file.*
