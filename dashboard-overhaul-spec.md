# Dashboard Overhaul Specification

## Summary
Complete redesign and expansion of the ggboi Discord bot dashboard — transforming it from a utilitarian admin panel into a polished, Discord-native management experience with deeper controls, new feature tabs, real-time updates, and proper mobile support.

---

## 1. Visual Redesign: Discord-Native Theme

### 1.1 Color System
- **Primary accent**: Discord blurple `#5865F2` (replaces current `#58a6ff` blue)
- **Accent hover**: `#4752C4`
- **Green**: Discord green `#23A55A` (replaces `#3fb950`)
- **Red**: Discord red `#ED4245` (replaces `#f85149`)
- **Orange**: Discord yellow `#FEE75C` → text `#F0B232` (replaces `#d29922`)
- **Backgrounds**: Keep dark palette but adjust to Discord's exact shades
  - `--bg`: `#1E1F22` (Discord dark bg)
  - `--bg-alt`: `#2B2D31` (Discord sidebar bg)
  - `--surface`: `#383A40` (Discord card bg)
  - `--border`: `#4E5058`
- **Status dot**: `#23A55A` green pulsing dot (like Discord's online indicator)

### 1.2 Typography
- **Primary font**: `"gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`
- **Monospace font**: `"gg mono", "Source Code Pro", "JetBrains Mono", Consolas, monospace`
- Load gg sans from Discord's CDN or fall back to system fonts
- **Headings**: 600 weight, tighter letter-spacing
- **Body**: 400 weight, 1.5 line-height
- Scale: 11px (captions) / 12px (small) / 13px (body) / 14px (nav) / 16px (headings) / 20px (section titles)

### 1.3 Component Restyling
- **Cards/panels**: Rounded corners (8px), subtle inner shadow, Discord-style border (#4E5058)
- **Sidebar**: Server-list-style with guild icon circles at top, collapsible sections below
- **Buttons**: Discord pill style — rounded-full (999px border-radius), blurple fill for primary
- **Inputs**: Darker bg (#383A40), blurple focus ring, Discord-style placeholders
- **Toggles**: Discord-style switches (green when active, grey when off)
- **Badges**: Pill-shaped, blurple/red/green variants matching Discord
- **Scrollbar**: Thin, Discord-style (#1A1B1E track, #4E5058 thumb)
- **Context menus**: Discord-style dropdown with backdrop blur

### 1.4 Animations & Polish
- **Page transitions**: Fade + slight scale (0.97 → 1) on tab switch
- **Card entrance**: Staggered fade-up (translateY 8px → 0) with increasing delays
- **Hover states**: Subtle background lighten + border highlight on all interactive elements
- **Button press**: Scale(0.96) on click
- **Loading skeletons**: Shimmer animation with Discord's grey tones
- **Toast**: Slide up from bottom-right with Discord-style green left border
- **Status dot**: Pulsing animation on the online indicator

---

## 2. Sidebar Restructuring

### 2.1 Collapsible Sections
The flat 23+ tab list becomes organized collapsible sections:

```
┌─────────────────────┐
│  🏠 Guild Selector  │
│  🟢 Online · 42ms   │
├─────────────────────┤
│  MODERATION    ▼    │
│   🛡️ Automod        │
│   ⚡ Ext. Automod   │
│   🔥 Dangerzone     │
│   📜 Mod Log        │
│   📝 User Notes     │
│   ⚡ Auto Rules     │
│   📁 Cases          │
├─────────────────────┤
│  COMMUNITY     ▼    │
│   👋 Greet & Logs   │
│   🎭 Roles          │
│   👥 Role Members   │
│   🔀 Channels       │
│   📅 Schedule       │
│   💾 Backups        │
│   💰 Economy        │
│   ✉️ DM Templates   │
├─────────────────────┤
│  CONFIGURATION  ▼   │
│   ⌨️ Commands       │
│   📊 Analytics      │
│   🎨 Embed Builder  │
│   🔘 Role Buttons   │
├─────────────────────┤
│  ADMIN (owner)  ▼   │
│   📡 Status         │
│   ⚙️ Settings       │
│   🤖 AI Assistant   │
│   💬 AI Chat        │
│   📈 AI Analytics   │
│   🧩 Modules        │
│   🗄️ Data           │
└─────────────────────┘
```

- Sections are collapsible with animated chevrons
- Active tab highlighted with blurple left border (3px) + blurple background tint
- Admin section only visible to bot owners
- Guild selector shows guild icon + server name
- User avatar + tag at bottom (like Discord's user panel)

### 2.2 Status Integration
- Online status displayed as a small colored dot next to the guild name
- Ping displayed with color coding (green < 80ms, yellow < 150ms, red > 150ms)

---

## 3. Mobile Experience

### 3.1 Hamburger Drawer (replaces bottom icon bar)
- **Desktop**: Full sidebar always visible (current layout)
- **Mobile (< 900px)**:
  - **Top bar**: Hamburger button (☰) + "ggboi" brand + guild selector
  - **Drawer**: Full sidebar slides in from the left with overlay backdrop
  - Drawer is 280px wide, contains everything the desktop sidebar does
  - Swipe-to-close gesture
  - Backdrop click closes drawer
  - Smooth 250ms slide animation

### 3.2 Mobile Layout
- Content area scrolls naturally (no sub-scroll)
- Panels stack vertically with full width
- Stats grid: 2 columns on mobile
- Feature grids: 1 column on mobile
- Tables: Horizontal scroll with sticky first column
- Forms: Full-width inputs, larger touch targets (min 44px height)
- Modals/overlays: Full-screen on mobile

### 3.3 Touch Optimization
- All interactive elements: minimum 44×44px touch target
- Adequate spacing between clickable items (8px+ gap)
- Pull-to-refresh on main content area
- Long-press for context menus (future)

---

## 4. Existing Tab Deepening

### 4.1 Automod (`AutomodTab.jsx`)
**Current state**: Basic toggle for spam/caps/links/mentions
**Add**:
- Regex rule builder (pattern + action + reason)
- Join-raid detection: max joins per time window + auto-lockdown
- Slowmode auto-adjust: if messages/sec > threshold, set slowmode
- Per-rule exempt roles & channels
- Test mode: simulate a message against rules
- Rule priority ordering (drag-to-reorder or arrow buttons)
- Rule statistics: how many times each rule triggered

### 4.2 Extended Automod (`ExtendedAutomodTab.jsx`)
**Current state**: Basic extended rules
**Add**:
- File attachment scanning (type, size limits)
- Invite link filtering with allowlist
- Word/phrase blocklist with regex support
- Mention spam threshold configuration
- Duplicate message detection
- New account age gate
- Action logging with sample matches

### 4.3 Auto Rules (`AutoExecTab.jsx`)
**Current state**: message/join/leave/reaction triggers, basic actions
**Add**:
- **New triggers**: voice_join, voice_leave, role_added, role_removed, member_update
- **New conditions**: role_has/has_not, channel_category, message_contains_regex, user_message_count
- **New actions**: add_role, remove_role, timeout_member, create_thread
- Rule testing mode: simulate with sample event data
- Rule enable/disable toggle per rule
- Rule execution log: see when rules fired and what they did
- Drag-to-reorder rule priority

### 4.4 Commands (`CommandsTab.jsx`)
**Current state**: Per-command toggle, channel/role restrictions, cooldown, warn ladder
**Add**:
- Command grouping by category with category-level toggles
- Alias management: create custom aliases per command
- Usage analytics per command: invocation count, popular channels
- Bulk enable/disable
- Command search/filter
- Import/export command config as JSON
- Default cooldown presets

### 4.5 Greet & Logs (`GreetTab.jsx`)
**Current state**: Welcome/leave message templates, basic log channels
**Add**:
- Live embed preview for welcome/leave messages
- Variable reference panel (click to insert {user}, {server}, etc.)
- Voice join/leave logging
- Member update logging (nickname, role changes)
- Message delete/edit logging
- Log channel per event type (separate channels for voice vs messages)
- Log format customization per event
- Test buttons: simulate welcome/leave message in a channel

### 4.6 Economy (`EconomyTab.jsx`)
**Current state**: Leaderboard table + command reference
**Add**:
- Configurable payouts: set daily/work/gamble amounts
- Item shop editor: create purchasable items with price, description, role reward
- Role shop: buyable roles with configurable prices
- Interest rate: configurable % earned on bank deposits
- Tax rate: configurable % taken from transfers
- Payday schedule: automatic paydays
- Reset economy button
- Economy statistics: total coins in circulation, richest users

### 4.7 Mod Log (`ModerationLogTab.jsx`)
**Current state**: List of mod actions with basic stats
**Add**:
- Full-text search across reasons, usernames, action types
- Date range filter
- Filter by moderator
- Filter by action type (warn, mute, kick, ban)
- Case linking (link related cases together)
- Export as CSV
- Bulk undo (revert multiple actions)
- Statistics dashboard: actions per mod, actions over time chart

### 4.8 Channels (`ChannelsTab.jsx`)
**Current state**: Channel name/position editing, basic permission sync
**Add**:
- Batch permission sync: select multiple channels → apply role overrides
- Channel cloning: duplicate a channel with its permissions
- Auto-archive settings for threads
- Default notification settings per channel
- Slowmode presets (5s, 10s, 30s, 1m, 5m)
- Channel reordering (drag-and-drop or position numbers)
- Channel type filter in the view

### 4.9 Remaining Tabs
- **Roles**: Add role color picker, permission template presets, role clone
- **Role Members**: Add mass assign/remove, export member list, search
- **Cases**: Add case notes, case status workflow (open/investigating/resolved), case linking
- **DM Templates**: Add template variables, preview, test-send to self
- **Schedule**: Add recurring schedules (daily/weekly), message preview, pause/resume
- **Backups**: Add diff view (compare backup to current state), scheduled auto-backups
- **Data**: Replace raw JSON with formatted tree view, search, export
- **Settings**: Add WebSocket toggle, theme preview, log level config
- **Status**: Add uptime history chart, event log (restarts, errors)
- **AI Tabs**: Add conversation search, memory browser, usage tracking

---

## 5. New Tabs (Priority Order)

### 5.1 Server Analytics (`AnalyticsTab.jsx`) — FIRST
**Purpose**: Visual server statistics and growth tracking
**Features**:
- **Member Growth chart**: Line chart — members over time (7d / 30d / 90d / 1y)
- **Message Activity chart**: Bar chart — messages per day, by channel
- **Command Usage chart**: Pie/bar — top commands used
- **Mod Actions chart**: Actions over time — warns, mutes, kicks, bans
- **Voice Activity**: Hours in voice channels over time
- **Active Users**: Daily/weekly active user counts
- **Stat cards at top**: Total members, online now, messages today, commands today
- **Date range picker**: 7d | 30d | 90d | custom
- Uses Recharts (already installed)
- Responsive — charts resize to container width

### 5.2 Embed Builder (`EmbedBuilderTab.jsx`) — SECOND
**Purpose**: Visual Discord embed creator for bot messages
**Features**:
- **Live preview**: Rendered embed updates as you type
- **Fields**: Title, description, color picker, author, footer, thumbnail, image, fields (name+value pairs, add/remove)
- **Timestamp toggle**
- **JSON export**: Copy the raw embed JSON for use in autoexec/schedule/etc.
- **Template library**: Save/load named embed templates
- **Send test**: Send to a selected channel (admin only)
- **Import from JSON**: Paste existing embed JSON to edit
- **Color presets**: Blurple, green, red, orange, grey quick-select buttons

### 5.3 Role Button Builder (`RoleButtonsTab.jsx`) — THIRD
**Purpose**: Build Discord button-role and select-menu-role panels visually
**Features**:
- **Button rows**: Up to 5 buttons per row, up to 5 rows
- **Button config**: Label, emoji, color (blurple/grey/green/red), linked role
- **Select menus**: Dropdown role selector with up to 25 options
- **Live preview**: See how the panel will look in Discord
- **Channel selector**: Choose where to post the panel
- **Message text**: Custom message above the buttons/menu
- **Exclusive mode**: Only one role from the menu at a time
- **Publish**: Sends the panel to the chosen channel
- **Edit existing**: Lists published panels, lets you update them

### 5.4 Audit Log Viewer (`AuditLogTab.jsx`) — FOURTH
**Purpose**: Browse Discord's server audit log
**Features**:
- Fetch audit logs via the bot's API (bot must have VIEW_AUDIT_LOG permission)
- Filter by action type: all / member updates / role changes / channel changes / bans / kicks / etc.
- Filter by user (who performed the action)
- Date range filter
- Paginated results with infinite scroll
- Expandable entries with full change details
- Quick user info on target/moderator

### 5.5 Log Search (`LogSearchTab.jsx`) — FIFTH
**Purpose**: Full-text search across all stored logs
**Features**:
- Search across mod logs, reaction logs, message logs simultaneously
- Full-text or regex search
- Filter by log type, date range, user
- Results displayed in a unified timeline
- Quick jump to source message/channel

---

## 6. Real-Time Updates (Hybrid WebSocket)

### 6.1 WebSocket for Status
- Open a WebSocket to `/ws` on the bot API
- Receive push events: status changes, presence updates, connection state
- Status tab auto-updates without polling
- Connection indicator in sidebar (green/yellow/red dot for connected/reconnecting/disconnected)

### 6.2 Polling for Data Tabs
- Keep existing polling for data-heavy tabs (automod, commands, etc.)
- Add a manual "Refresh" button to each tab header
- Add a global "Refresh All" button in the top bar
- Show last-refreshed timestamp in tab headers

### 6.3 Optimistic Updates
- When saving config (toggling automod, saving settings), immediately update the local state
- Show success toast + revert on error
- Don't wait for refetch to show the change

---

## 7. Performance & Loading

### 7.1 Loading Optimization
- **Lazy-load tabs**: Only fetch data for the active tab (already implemented via lazy rendering in App.jsx)
- **Skeleton screens**: Already partially implemented, extend to all tabs
- **Request deduplication**: Prevent duplicate API calls when switching guilds quickly
- **Cache API responses**: Simple TTL-based in-memory cache per tab (30s default)
- **Parallel initial load**: Load status + guild list simultaneously on login

### 7.2 Perceived Performance
- Show skeleton immediately, don't wait for API
- Fade in content after load (not flash)
- Progress bar at top for initial load
- Background refetch: don't show skeleton on subsequent fetches unless data is stale

---

## 8. Additional UI Components

### 8.1 New Shared Components
- **`ColorPicker`**: Simple color input with preset swatches
- **`DateRangePicker`**: From/To date inputs for analytics and log search
- **`ProgressBar`**: Animated progress indicator
- **`ConfirmDialog`**: Modal confirmation for destructive actions (replaces window.confirm)
- **`SearchInput`**: Search bar with icon, clear button, debounce
- **`InfiniteScroll`**: Load-more pattern for long lists
- **`StatCard`**: Animated number card with icon, label, trend arrow
- **`EmbedPreview`**: Rendered Discord embed component for embed builder + greet preview
- **`ChartContainer`**: Responsive wrapper for Recharts with loading/error/empty states
- **`TabBar`**: Sub-navigation tabs within a main tab

### 8.2 Keyboard Shortcuts (extend existing)
- **`Ctrl+K`**: Command palette (already exists)
- **`Ctrl+S`**: Save current form
- **`Ctrl+R`**: Refresh current tab
- **`Ctrl+Shift+F`**: Focus search (on tabs with search)
- **`Alt+1-9`**: Quick tab switch (already exists, expand to sections)

---

## 9. API Changes Needed

### 9.1 New Endpoints
- `GET /api/analytics/:guildId` — member growth, message activity, command stats
- `GET /api/analytics/:guildId/members` — member count over time
- `GET /api/analytics/:guildId/messages` — messages per day
- `GET /api/audit-log/:guildId` — fetch Discord audit log entries
- `GET /api/logs/search` — full-text search across logs
- `POST /api/embeds` — save embed template
- `GET /api/embeds` — list saved templates
- `POST /api/role-buttons` — create/publish button role panel
- `GET /api/role-buttons/:guildId` — list published panels
- `WS /ws` — WebSocket for real-time status updates

### 9.2 Enhanced Endpoints
- `GET /api/automod` — add rule statistics
- `GET /api/commands` — add usage analytics
- `GET /api/greet` — add test-send capability
- `GET /api/economy` — add economy config (payouts, shop, tax)

---

## 10. Implementation Phases

### Phase 1: Foundation (visual overhaul + mobile + sidebar)
1. CSS variable reset to Discord colors
2. Font stack update
3. Component restyling (buttons, inputs, cards, toggles)
4. Sidebar restructuring with collapsible sections
5. Mobile hamburger drawer

### Phase 2: Tab Deepening
1. Automod & Ext. Automod
2. Auto Rules
3. Commands
4. Greet & Logs
5. Economy
6. Mod Log & Cases
7. Channels

### Phase 3: New Tabs
1. Server Analytics
2. Embed Builder
3. Role Button Builder
4. Audit Log Viewer
5. Log Search

### Phase 4: Real-Time & Polish
1. WebSocket status updates
2. Optimistic updates
3. Loading optimization
4. Keyboard shortcuts
5. Confirm dialogs (replace window.confirm)

---

## 11. Technical Constraints

- **Framework**: React 18 + Vite (no change)
- **Charts**: Recharts (already installed, use it)
- **Icons**: lucide-react (already installed)
- **No new dependencies** unless strictly necessary
- **No breaking changes** to the API contract except additive new endpoints
- **Backward compatible**: Old tabs should still work during migration
- **File structure**: Keep existing component-per-tab pattern, add new shared components
- **CSS**: Single styles.css file (avoid CSS-in-JS or CSS modules to keep things simple)

---

## 12. Non-Goals (for this spec)
- Adding user-facing features to the bot itself (that's a separate effort)
- Real Discord OAuth2 scopes management
- i18n / localization
- Accessibility audit (WCAG)
- PWA / service worker
- E2E testing
- Changing the build system (stays Vite + Vercel)
