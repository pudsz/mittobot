# BOT_SPEC.md — The Ultimate ggboi Bot

> Implementation blueprint for evolving ggboi into a bot that competes with (and beats)
> MEE6, Dyno, Carl-bot, and Wick — while staying self-hosted, single-process, and
> dashboard-first. Every feature below is specced to be buildable directly from this
> document: commands, SQLite tables, config shapes, event wiring, and dashboard API
> endpoints. The companion file is `DASHBOARD_SPEC.md`.

---

## 0. Deployment Target: Pterodactyl NodeJS Egg

The bot runs as **one Node.js process on one port** — API + dashboard fallback serving
+ Discord gateway all in `node index.js`.

### 0.1 Port

- `PORT` (default `3432`) is the single public port. The Express server in
  `src/api/server.js` binds to it.
- **Pterodactyl injects `SERVER_PORT`** into eggs. Honor it as a fallback:
  ```js
  const port = process.env.PORT || process.env.SERVER_PORT || 3432;
  ```
  Document both in `.env.example` (see §12).

### 0.1.1 Single-port serving — dashboard-v2 is the default UI

**Current deployment decision: the bot AND the dashboard are both served on port
`3432`** (no Vercel split for now — Vercel remains an optional later path, see
DASHBOARD_SPEC §1).

- `src/api/server.js` serves the dashboard build as static files on the same Express
  app as the API. Path resolution order:
  ```js
  // Prefer the v2 build; fall back to legacy v1; warn if neither exists.
  const candidates = [
    path.resolve(__dirname, "../../dashboard-v2/dist"),   // ★ default
    path.resolve(__dirname, "../../dashboard/dist"),      // legacy fallback
  ];
  const dashboardPath = candidates.find(p => fs.existsSync(p));
  ```
- SPA fallback stays as-is: `GET *` → `index.html` (excluding `/api/*` and `/login`).
- Build step: `npm run build` at repo root builds `dashboard-v2` (update the root
  `package.json` script: `"build:dashboard": "cd dashboard-v2 && npm ci && npm run build"`).
- Same-origin means **no CORS config needed** (`DASHBOARD_ORIGIN` stays unset) and
  `VITE_BOT_API_URL` stays empty at build time — the SPA calls relative `/api/...`.
- Discord OAuth redirect: `DISCORD_REDIRECT_URI=https://<your-domain-or-ip>:3432/api/auth/discord/callback`,
  and the callback's redirect target (`originList[0]`) defaults to the same origin.
- Dev workflow unchanged: `npm start` runs the bot on :3432 and the v2 Vite dev server
  on :5174 (proxying `/api` + `/login` to :3432).

### 0.2 Egg configuration

- **Startup command**: `if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; npm install --omit=dev; node index.js`
- **Stop signal**: `SIGTERM` (bot must shut down gracefully — see §0.4).
- **Persistent volume**: everything in the container `/home/container` persists; keep
  `SQLITE_DB_PATH` default (`./ggboi.sqlite`) or point it at a mounted path.

### 0.3 SQLite hardening

- Enable WAL mode + busy timeout at `db.init()`:
  ```js
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  ```
- Hourly `wal_checkpoint(TRUNCATE)` on the scheduler tick to bound WAL growth.

### 0.4 Graceful shutdown

On `SIGTERM`/`SIGINT`:
1. Stop accepting HTTP (server.close()).
2. Flush all pending background persists (each domain module exposes `flush()`).
3. `client.destroy()` the Discord connection.
4. `db.close()`.
5. `process.exit(0)` — with a 10s hard timeout.

### 0.5 Memory budget

Target < 512 MB RSS for a 50-guild install. Rules:
- All new in-memory caches follow the existing pattern (authoritative cache + background
  persist) but must have **caps** (LRU or per-guild row limits) — no unbounded maps.
- Playwright/browser tools stay **opt-in** (`aiBrowserEnabled`) and lazy-required.

---

## 1. Architecture Ground Rules (unchanged, enforced)

Everything new must reuse these existing mechanisms — do not invent parallel ones:

1. **Command definition objects** (`{name, description, prefix, slash, execute, category,
   defaultPermission, defaultSettings}`) exported from files in `src/commands/`.
2. **Central permission enforcement** — the router's `checkAccess` + `config.evaluate`.
   Never re-add `isAuthorized` guards inside handlers.
3. **Per-command settings bag** — feature knobs live in `defaultSettings` and are
   overridden per-guild via `src/config.js`; the dashboard reads/writes them through
   `GET/POST /api/commands/:name`.
4. **Cache-first persistence** — sync reads from in-memory cache, async `load()` at
   startup, background best-effort writes to SQLite via `src/db.js`.
5. **Feature categories** — every new fun/community system gets a category in
   `src/features.js` + a `*Enabled` settings key so it's toggleable from the dashboard.
6. **`src/safe.js`** wrappers for all Discord API calls.
7. **Event bus** (new, §10) — every system that does something visible publishes an
   event so the dashboard's live feed and logging system can consume it.
8. **messageCreate pipeline order** is sacred; new message-hooks are inserted
   explicitly (documented in §11).

---

## 2. Moderation: Unified Case System (evolve `mod.js`)

### 2.1 Cases

Every real moderation action becomes a **case** with an auto-incrementing per-guild
case number.

**Table** (replaces ad-hoc reads of `moderation_log`; keep `moderation_log` writes for
back-compat, cases reference them):

```sql
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  case_number INTEGER NOT NULL,        -- per-guild sequence
  user_id TEXT NOT NULL,
  mod_id TEXT NOT NULL,
  action TEXT NOT NULL,                -- warn|mute|kick|ban|softban|tempban|unban|unmute|note
  reason TEXT,
  duration_ms INTEGER,                 -- for mute/tempban
  evidence TEXT,                       -- JSON: [{type:"link"|"attachment", url, note}]
  status TEXT DEFAULT 'open',          -- open|resolved|appealed|overturned
  linked_cases TEXT,                   -- JSON array of case_numbers
  created_at INTEGER NOT NULL,
  UNIQUE(guild_id, case_number)
);
CREATE INDEX IF NOT EXISTS cases_guild_user ON cases (guild_id, user_id);
```

**Commands**
- `$case <number>` / `/case view` — full case embed (user, mod, action, reason, evidence, status).
- `$case edit <number> reason <text>` — edit reason (mod+).
- `$case evidence <number> <link>` — attach evidence.
- `$case link <a> <b>`, `$case resolve <n>`, `$case overturn <n>` (admin).
- `$history <user>` — paginated case list per user (buttons for pages).
- `$realwarn`/`$realmute`/etc. now create cases automatically and DM the user a
  case-numbered notice (template configurable, §9).

**Config** (`realwarn` settings bag, extended):
```js
defaultSettings: {
  ladder: [{ count: 3, action: "mute", duration: "1h" }, { count: 5, action: "kick" }],
  dmOnAction: true,
  dmTemplate: "You received a {action} in {server} (Case #{case}): {reason}",
  warnExpiryDays: 0,        // 0 = never expire; N = warnings older than N days don't count toward ladder
  requireReason: false,
}
```

### 2.2 Bulk + quality-of-life

- `$purge` filters: `$purge 50 user @x`, `$purge 50 contains <text>`, `$purge 50 bots`,
  `$purge 50 embeds`, `$purge 50 attachments` (respect existing `MAX_PURGE`).
- `$massban <id id id…> reason <r>` (admin, confirmation button, max 20/invocation).
- `$lockdown` / `$unlockdown` — locks all channels in configured category set
  (or whole guild) by denying SendMessages for @everyone; state saved so unlock restores
  prior overwrites. Config lives in guild settings `lockdownChannels`.
- `$slowmode <duration|off> [channel]` — accepts presets `5s 10s 30s 1m 5m`.

**API**: `GET /api/cases?guildId&user&action&mod&q&page`, `POST /api/cases/:n`
(edit/resolve/overturn), existing modlog endpoints stay.

---

## 3. Automod v2 (evolve `src/automod.js`)

Keep the 5 built-in rules (`invites`, `bannedWords`, `spam`, `massMention`, `caps`);
add:

### 3.1 New rule types

| Rule | Fields | Notes |
|---|---|---|
| `regex` | `patterns[]` (max 10, each ≤ 200 chars), `action` | Compile-once with try/catch; 5 ms per-message regex budget via `re2`-style timeout guard (execute against first 2k chars only) |
| `links` | `mode: allowlist\|blocklist`, `domains[]` | Bare-domain match on extracted URLs |
| `attachments` | `blockedExtensions[]`, `maxSizeMb` | |
| `duplicates` | `threshold` (same message N× in window), `windowSeconds` | Per-user rolling hash buffer |
| `zalgo` | `percent` | Combining-char density |
| `emoji` | `maxEmoji` | Custom + unicode count |
| `newlines` | `maxLines` | Wall-of-text guard |
| `mentions_roles` | `maxRoleMentions` | Separate from user mass-mention |

### 3.2 Heat system (signature feature)

Instead of each rule acting independently, every violation adds **heat** to the user;
actions trigger at heat thresholds. This is what makes automod feel smart.

```js
// automod config additions (per guild)
{
  heat: {
    enabled: false,
    decayPerMinute: 5,
    thresholds: [
      { heat: 20, action: "warn" },
      { heat: 40, action: "mute", duration: "10m" },
      { heat: 80, action: "kick" },
    ],
  },
  // each rule gains: heatValue: 10 (how much heat a violation adds)
}
```
In-memory per-(guild,user) heat map with decay computed lazily on read. No table needed.

### 3.3 Anti-raid

New module `src/antiraid.js` (config in `automod_extended` or its own key):

- **Join-rate detection**: `maxJoins` per `windowSeconds` → trigger `raidAction`:
  `lockdown` (invoke §2.2 lockdown) | `kick_new` | `verification_high`.
- **Account-age gate**: accounts younger than `minAccountAgeHours` get `gateAction`:
  `kick` | `quarantine_role` | `notify_only`.
- **Alert channel** + auto-unlock after `cooldownMinutes`.
- Wired in `guildMemberAdd` *before* autoroles/greet.

### 3.4 Test mode + stats

- `$automod test <message text>` — dry-runs all rules, replies with which would fire.
- Per-rule trigger counters persisted daily to:
```sql
CREATE TABLE IF NOT EXISTS automod_stats (
  guild_id TEXT, rule TEXT, day TEXT, count INTEGER,
  PRIMARY KEY (guild_id, rule, day)
);
```

**API**: extend `GET/POST /api/automod` config shape; `GET /api/automod/stats?guildId&days=30`;
`POST /api/automod/test { guildId, content }`.

---

## 4. Leveling & XP (new: `src/leveling.js`, commands in `src/commands/leveling.js`)

Category: `leveling` (new feature category, `levelingEnabled` default `false`).

### 4.1 Mechanics

- XP per message: random `minXp..maxXp` (default 15–25), per-user cooldown
  `xpCooldownSeconds` (default 60) — standard MEE6-compatible curve:
  `xpForLevel(n) = 5*n² + 50*n + 100`.
- **Multipliers**: per-channel and per-role multiplier maps (0 disables a channel).
- **Voice XP** (optional): `voiceXpPerMinute` while ≥2 humans in channel, not muted.

```sql
CREATE TABLE IF NOT EXISTS leveling_users (
  guild_id TEXT, user_id TEXT,
  xp INTEGER DEFAULT 0, level INTEGER DEFAULT 0,
  last_xp_at INTEGER DEFAULT 0, messages INTEGER DEFAULT 0,
  voice_minutes INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
```

Config (guild-level JSON in `command_config` settings bag of the `leveling` pseudo-command
or a dedicated `leveling_config` table — use settings bag to reuse existing plumbing):

```js
defaultSettings: {
  minXp: 15, maxXp: 25, xpCooldownSeconds: 60,
  levelUpMessage: "🎉 {user} reached level {level}!",
  levelUpDestination: "channel",        // channel|dm|off|fixed:<channelId>
  channelMultipliers: {},               // { channelId: 1.5 }
  roleMultipliers: {},                  // { roleId: 2 }
  roleRewards: [],                      // [{ level: 10, roleId, removePrior: false }]
  stackRewards: true,
  ignoredChannels: [], ignoredRoles: [],
  voiceXpPerMinute: 0,
}
```

### 4.2 Commands

- `$rank [user]` / `/rank` — rank card embed: level, XP progress bar (text), server rank,
  messages. (Image cards are a later enhancement — no canvas dep initially.)
- `$leaderboard levels` — paginated top 10 with buttons.
- `$givexp <user> <amount>`, `$setlevel <user> <n>` (admin), `$resetlevels` (owner, confirm).

### 4.3 API

`GET /api/leveling?guildId` (config + top 100), `POST /api/leveling` (config),
`POST /api/leveling/user` (adjust), `POST /api/leveling/reset`.

---

## 5. Community Systems (new modules)

All are feature-category gated and event-bus publishing.

### 5.1 Tickets (`src/tickets.js`, `src/commands/tickets.js`)

- **Panels**: admin posts a panel (embed + button(s)) via `$ticketpanel create` or
  dashboard. Each button maps to a ticket **category** (support, appeals, …).
- Opening creates a private channel `ticket-<n>` under a configured Discord category,
  visible to opener + support roles. One open ticket per user per category.
- In-ticket buttons: **Claim** (assigns staff), **Close** (confirm → 10s grace),
  optional close reason modal.
- **Transcripts**: on close, fetch messages (cap 1,000), render plain-text transcript,
  store row + post to transcript channel as attachment.

```sql
CREATE TABLE IF NOT EXISTS ticket_config (guild_id TEXT PRIMARY KEY, config TEXT);          -- JSON: categories, supportRoles, transcriptChannelId, naming, maxOpenPerUser
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, number INTEGER,
  user_id TEXT, category TEXT, channel_id TEXT, claimed_by TEXT,
  status TEXT DEFAULT 'open',          -- open|closed
  opened_at INTEGER, closed_at INTEGER, close_reason TEXT, transcript TEXT
);
```

API: `GET/POST /api/tickets/config`, `GET /api/tickets?guildId&status`, `POST /api/tickets/:id/close`.

### 5.2 Giveaways (`src/giveaways.js`)

- `$gstart <duration> <winners> <prize>` (mod+), button-entry (🎉 button, not reactions —
  reliable count), `$gend`, `$greroll <messageId>`.
- Requirements (optional): required role, min level (ties into §4).
- Scheduler tick (reuse `src/scheduler.js` interval) ends due giveaways, picks winners
  (crypto random), edits embed + announces.

```sql
CREATE TABLE IF NOT EXISTS giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, channel_id TEXT, message_id TEXT,
  prize TEXT, winners INTEGER, ends_at INTEGER, ended INTEGER DEFAULT 0,
  host_id TEXT, requirements TEXT, entries TEXT DEFAULT '[]'   -- JSON user id array
);
```

API: `GET /api/giveaways?guildId`, `POST /api/giveaways` (create), `POST /api/giveaways/:id/end|reroll`.

### 5.3 Starboard (`src/starboard.js`)

- Config: `channelId`, `emoji` (default ⭐), `threshold` (default 3), `selfStar: false`,
  `ignoredChannels[]`.
- On `messageReactionAdd/Remove`: when count crosses threshold, post/update/remove the
  starboard embed (jump link, image support, star count).

```sql
CREATE TABLE IF NOT EXISTS starboard_posts (
  guild_id TEXT, source_message_id TEXT, starboard_message_id TEXT, stars INTEGER,
  PRIMARY KEY (guild_id, source_message_id)
);
```

### 5.4 Suggestions (`src/suggestions.js`)

- `$suggest <text>` → embed in suggestion channel with 👍/👎 buttons + live counts.
- Staff: `$approve <n> [comment]`, `$deny <n> [comment]`, `$consider <n>` — edits embed
  color/status, optionally DMs the author.
- Table `suggestions (guild_id, number, user_id, content, status, message_id, votes_up, votes_down, staff_comment, created_at)`.

### 5.5 Reminders (`src/commands/utility.js` extension)

- `$remind 2h30m take out pizza` / `/remind` — DM (fallback channel ping) at due time.
- `$reminders list|delete <id>`. Fired from the scheduler tick.
- Table `reminders (id, user_id, guild_id, channel_id, content, due_at, recurring)`.

### 5.6 Birthdays (`src/birthdays.js`)

- `$birthday set <MM-DD>`, `$birthday remove`; guild config: announce channel, message
  template, optional birthday role for the day, timezone (`birthdayTz`, default UTC).
- Daily check at local midnight via scheduler.
- Table `birthdays (guild_id, user_id, month, day)`.

### 5.7 Invite tracking (`src/invites.js`)

- Cache guild invites on ready/inviteCreate; on `guildMemberAdd`, diff uses → attribute
  inviter. Publishes to greet log ("invited by X, 12 total invites").
- `$invites [user]`, `$inviteleaderboard`.
- Table `invite_stats (guild_id, user_id, regular, leaves, fake, bonus)`.

### 5.8 Tags / custom text commands (`src/tags.js`)

Lightweight sibling of dynamic modules — **no JS execution**, safe for mods:
- `$tag create <name> <content>` (mod+), `$tag edit|delete|info|list`, use via
  `$<tagname>` (router falls through to tags when no command matches) or `/t <name>`.
- Content supports the placeholder system (§9) + embed JSON (`{embed:{...}}`).
- Table `tags (guild_id, name, content, author_id, uses, created_at, PRIMARY KEY (guild_id, name))`.

### 5.9 Social notifications (`src/social.js`)

Poll-based announcers (no OAuth needed):
- **YouTube**: channel RSS (`https://www.youtube.com/feeds/videos.xml?channel_id=`) every 5 min.
- **Twitch**: Helix `streams` endpoint (requires `TWITCH_CLIENT_ID/SECRET` env, app token).
- **RSS**: any feed URL.
- Config per subscription: target channel, message template (`{title} {url} {name}`),
  role ping. Table `social_subs (id, guild_id, type, identifier, channel_id, template, last_seen_id)`.

### 5.10 API endpoints for §5 systems

Uniform CRUD, all guild-scoped (`?guildId=`), matching DASHBOARD_SPEC page contracts:

- `GET/POST /api/starboard` — config + recent posts
- `GET/POST /api/suggestions` — list + status actions (`{number, status, comment}`)
- `GET/POST /api/birthdays` — config + upcoming list
- `GET /api/invites` — leaderboard + per-user stats
- `GET/POST/DELETE /api/tags` — tag CRUD
- `GET/POST/DELETE /api/social` — subscription CRUD
- `GET/POST /api/role-panels` — button/menu role panel CRUD + publish (§8 roles.js)

---

## 6. Music (new: `src/music/`, category `music`, `musicEnabled` default `false`)

Builds on the already-installed `@discordjs/voice` + opus stack (used by voice AI).

### 6.1 Sources — ToS-aware

> ⚠️ **Deliberate scope decision**: no YouTube scraping/stream-ripping — it violates
> YouTube ToS, breaks constantly, and gets bots banned. Sources supported:

1. **Direct audio URLs** (`.mp3/.ogg/.opus/.wav/.m3u8` streams).
2. **Internet radio** stations (curated preset list + custom URL).
3. **Local library**: files under `MUSIC_LIBRARY_PATH` (env; a Pterodactyl mount) —
   indexed at startup, searchable by filename.
4. **Discord attachments**: `$play` with an attached audio file.

Architecture leaves a `resolveTrack(query) → {title, streamUrl, duration}` provider
interface so additional licensed providers can be added later.

### 6.2 Player

Per-guild `MusicSession` (mirrors `src/voice/session.js` patterns): queue (max 200),
`@discordjs/voice` AudioPlayer, idle-disconnect after `idleMinutes` (default 5).

**Commands** (all slash + prefix): `play <url|search>`, `pause`, `resume`, `skip`,
`stop` (clears queue + leaves), `queue` (paginated), `nowplaying` (progress bar),
`volume <0-150>`, `loop <off|track|queue>`, `shuffle`, `remove <n>`, `move <a> <b>`,
`seek <time>` (direct-URL tracks only), `radio <preset>`.

**Config settings bag**: `djRoleId` (skip/stop restricted when set), `maxQueue`,
`defaultVolume`, `idleMinutes`, `allowedVoiceChannels[]`.

**Interplay with voice AI**: a guild voice channel is either an AI session or a music
session — `VoiceManager` refuses to double-book.

**API**: `GET /api/music/status?guildId` (now playing + queue), `POST /api/music/control`
(`{action: skip|pause|…}`), `GET/POST /api/music/config`, `GET /api/music/library`.

---

## 7. Verification (`src/verification.js`)

- Modes: **button** (click to verify → role), **captcha** (bot DMs a 6-char code image-free
  text-scramble; user replies), **question** (custom Q/A set by admin).
- Config: `verifiedRoleId`, `unverifiedRoleId` (optional quarantine), `mode`,
  `timeoutMinutes` → `timeoutAction: kick|nothing`, log channel.
- Panel posted via `$verifypanel` or dashboard. Ties into anti-raid (§3.3): raid mode can
  force-switch `mode` to captcha.

---

## 8. Existing Module Deepening (quick-hit list)

| Module | Additions |
|---|---|
| `economy.js` | Config-driven payouts (`dailyAmount`, `workMin/Max`, `robSuccessPct`…) — *(partially done, finish)*; **shop v2**: items with `type: role\|badge\|custom`, inventory table `economy_inventory`, `$buy/$inventory/$use`; **blackjack** + **slots** with house-edge config; weekly **lottery** (ticket purchases, scheduler draw); bank **interest** (`interestDailyPct`, applied lazily on read) |
| `schedule.js` | Cron-expression recurrence (reuse a 50-line cron parser, no dep); embed payload support via template library (§9); `pause/resume`; run-history log |
| `backup.js` | Scheduled auto-backups (`backupIntervalHours`, keep N); **restore preview diff** (`GET /api/backup/:id/diff` → added/removed/changed roles+channels before committing) |
| `greet.js` | Per-event log channels (memberEvents/messageEvents/voiceEvents/roleEvents each with own channel); welcome **embed templates** (§9); welcome card image *deferred* (no canvas dep) |
| `roles.js` | **Button roles + select-menu roles** (panels stored in `role_panels` table; up to 5×5 buttons or 25-option menus, exclusive mode) — replaces reliance on reaction roles; keep reaction roles for legacy |
| `sticky.js` | Per-channel debounce override; embed stickies; sticky slowmode (repost at most every N seconds) |
| `utility.js` | `$poll` v2: button voting, multi-option (up to 10), timed close with results embed, anonymous mode; `$snipe`/`$editsnipe` (last deleted/edited message per channel, 5-min in-memory buffer, permission-gated); `$translate <text>` (free LibreTranslate-compatible endpoint, env-configurable); `$userinfo` v2 with case/level/economy summary; `$afk` with mention-log |
| `autoexec.js` | New triggers: `voice_join`, `voice_leave`, `role_added`, `role_removed`, `level_up` (§4), `member_verified` (§7); new actions: `add_role`, `remove_role`, `timeout_member`, `create_thread`, `send_dm`, `add_xp`; per-rule enable toggle, execution log ring buffer (last 50 per guild, exposed via API) |
| AI (`src/ai.js`) | Per-channel personality override map (`aiChannelPersonalities`); per-user/role daily quota (`aiQuotaPerUser`, `aiQuotaRoles`); prompt library CRUD already exists — surface fully in dashboard; `$ai imagine` reserved (future) |
| `dangerzone.js` | Webhook-post trap option (invisible channel honeypot already works — add "log only" action for observation mode) |

---

## 9. Cross-Cutting: Placeholders & Embed Template Library

### 9.1 Placeholder engine (`src/placeholders.js`)

One resolver used by greet, leveling, tickets, giveaways, tags, DM templates, autoexec,
social notifications:

```
{user} {user.tag} {user.id} {user.name}      — mention / tag / id / display name
{server} {server.count} {server.id}
{channel} {channel.name}
{level} {xp} {case} {inviter} {invites}      — context-dependent, resolver receives a ctx bag
{date} {time}
```

Unknown placeholders pass through untouched. Max output 2,000 chars.

### 9.2 Embed template library

Already exists (`dm_templates`, `/api/embeds`) — generalize:

```sql
-- extend existing embeds storage with a scope column
-- embed_templates (guild_id, name, json, created_by, updated_at)
```

Any system that sends a message accepts either a plain string (placeholders resolved)
or `template:<name>` referencing a stored embed.

---

## 10. Event Bus & Logging v2 (`src/events.js`)

Tiny in-process emitter + per-guild ring buffer (200 events) powering the dashboard
live feed AND unified logging:

```js
// src/events.js
publish(guildId, { type, summary, data })   // types: member_join, member_leave, automod,
                                            // mod_action, ai_reply, level_up, ticket_open,
                                            // giveaway_end, music_play, raid_alert, ...
subscribe(fn) / getRecent(guildId, limit)
```

**Logging v2** (`src/greet.js` logs section, extended): a per-guild map
`{ eventType → channelId }` so each event type can log to its own channel with its own
embed. Default: all → existing single log channel.

**API**: `GET /api/activity?guildId&limit=50` (ring buffer + recent `moderation_log`),
`GET /api/events?guildId&token=` — **SSE stream** (EventSource can't set headers → JWT
via query param, validated the same as Bearer), 15s heartbeat.

---

## 11. messageCreate Pipeline (updated order)

1. `handleAiMessage` early-path (replies/mentions/DM)
2. `automod.checkMessage` (now heat-aware) → return if acted
3. `dangerzone.checkMessage` → return if acted
4. `leveling.grantXp(message)` — **never blocks**, fire-and-forget
5. `autoexec.executeTrigger("message", …)`
6. Command routing (prefix → `checkAccess` → handler)
7. **Tags fallthrough** — if prefix matched but no command, try `tags.get(name)`
8. `handleStickyRepost`
9. `handleAiMessage` fallback (chatty/keyword)

---

## 12. `.env.example` (full variable table)

Keep the existing single-port block. Final shape (additions marked ➕):

```bash
# ─── Required ───
BOT_TOKEN=

# ─── Port (Pterodactyl) ───
PORT=3432                    # single port: API + dashboard UI
# SERVER_PORT is honored automatically if PORT is unset (Pterodactyl injects it) ➕

# ─── Auth ───
DASHBOARD_PASSWORD=
DASHBOARD_JWT_SECRET=
# DISCORD_CLIENT_ID= / DISCORD_CLIENT_SECRET= / DISCORD_REDIRECT_URI=

# ─── Owners / DB ───
OWNER_IDS=
# SQLITE_DB_PATH=./ggboi.sqlite

# ─── External dashboard (Vercel split deploy) ───
# DASHBOARD_ORIGIN=https://your-dash.vercel.app

# ─── Integrations ➕ ───
# TWITCH_CLIENT_ID= / TWITCH_CLIENT_SECRET=     (social notifications)
# TRANSLATE_API_URL=                            (LibreTranslate-compatible)
# MUSIC_LIBRARY_PATH=./music                    (local music library)

# ─── AI (existing) ───
# GROQ_API_KEY= / OPENAI_API_KEY= / ANTHROPIC_API_KEY= / GEMINI_API_KEY=
```

---

## 13. Implementation Phases

| Phase | Scope | Depends on |
|---|---|---|
| **B1** | Event bus + SSE + activity API (§10) + Pterodactyl hardening (§0.3–0.4) | — |
| **B2** | Case system + mod QoL (§2) | B1 |
| **B3** | Automod v2: new rules, heat, anti-raid, test mode, stats (§3) | B1 |
| **B4** | Leveling (§4) | B1 |
| **B5** | Tags, reminders, suggestions, starboard (§5.4–5.8 lightweights) | B1 |
| **B6** | Tickets + giveaways (§5.1–5.2) | B1 |
| **B7** | Placeholders + embed templates generalization (§9), greet/roles/sticky deepening (§8) | B1 |
| **B8** | Verification + invite tracking (§7, §5.7) | B3 |
| **B9** | Music (§6) | — |
| **B10** | Social notifications, birthdays, economy v2, schedule/backup deepening (§5.9, §5.6, §8) | B7 |

Each phase: feature category registered → tables in `db.init()` → module + commands →
API endpoints → event-bus publishes → CLAUDE.md updated.

## 14. New SQLite Tables (appendix)

`cases`, `automod_stats`, `leveling_users`, `ticket_config`, `tickets`, `giveaways`,
`starboard_posts`, `suggestions`, `reminders`, `birthdays`, `invite_stats`, `tags`,
`social_subs`, `role_panels`, `economy_inventory`, `embed_templates` (generalized).
All follow existing conventions: TEXT ids, JSON-as-TEXT blobs, INTEGER 0/1 booleans,
epoch-ms timestamps, created in `db.init()` with `IF NOT EXISTS`.
