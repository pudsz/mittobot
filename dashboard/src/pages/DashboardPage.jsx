import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity, Terminal, ShieldAlert, MessageSquareCode, ShieldCheck,
  Settings, Sparkles, Blocks, Database, KeyRound, FolderSync,
  Gauge, ScrollText, StickyNote, Zap, ShieldPlus, Mail, RefreshCw,
  Users, Cpu, Disc, Flame, FolderOpen, CalendarDays, HardDrive, Coins,
  Menu, Palette, ArrowLeft,
} from "lucide-react";
import { api, setToken, clearToken, onUnauthorized, BASE } from "../api.js";
import { ToastProvider } from "../components/Toast.jsx";
import StatusTab from "../components/StatusTab.jsx";
import CommandsTab from "../components/CommandsTab.jsx";
import AutomodTab from "../components/AutomodTab.jsx";
import GreetTab from "../components/GreetTab.jsx";
import RolesTab from "../components/RolesTab.jsx";
import ChannelsTab from "../components/ChannelsTab.jsx";
import SettingsTab from "../components/SettingsTab.jsx";
import AiTab from "../components/AiTab.jsx";
import ModulesTab from "../components/ModulesTab.jsx";
import DataTab from "../components/DataTab.jsx";
import ModerationLogTab from "../components/ModerationLogTab.jsx";
import DmTemplateTab from "../components/DmTemplateTab.jsx";
import AutoExecTab from "../components/AutoExecTab.jsx";
import UserNotesTab from "../components/UserNotesTab.jsx";
import ExtendedAutomodTab from "../components/ExtendedAutomodTab.jsx";
import CasesTab from "../components/CasesTab.jsx";
import ScheduleTab from "../components/ScheduleTab.jsx";
import BackupTab from "../components/BackupTab.jsx";
import EconomyTab from "../components/EconomyTab.jsx";
import RoleMembersTab from "../components/RoleMembersTab.jsx";
import DangerZoneTab from "../components/DangerZoneTab.jsx";
import EmbedBuilderTab from "../components/EmbedBuilderTab.jsx";
import Sidebar from "../components/Sidebar.jsx";
import CommandPalette from "../components/CommandPalette.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";

// ─── Sidebar sections ────────────────────────────────────────────────────────
const SIDEBAR_SECTIONS = [
  {
    id: "moderation",
    label: "Moderation",
    tabs: [
      { id: "automod",    label: "Automod",    Icon: ShieldAlert },
      { id: "extautomod", label: "Ext. Automod", Icon: ShieldPlus },
      { id: "dangerzone", label: "Dangerzone", Icon: Flame },
      { id: "modlog",     label: "Mod Log",    Icon: ScrollText },
      { id: "modnotes",   label: "User Notes", Icon: StickyNote },
      { id: "autoexec",   label: "Auto Rules", Icon: Zap },
      { id: "cases",      label: "Cases",      Icon: FolderOpen },
    ],
  },
  {
    id: "community",
    label: "Community",
    tabs: [
      { id: "greet",      label: "Greet & Logs", Icon: MessageSquareCode },
      { id: "roles",      label: "Roles",      Icon: ShieldCheck },
      { id: "rolemembers",label: "Role Members",Icon: Users },
      { id: "channels",   label: "Channels",   Icon: FolderSync },
      { id: "schedule",   label: "Schedule",   Icon: CalendarDays },
      { id: "backup",     label: "Backups",    Icon: HardDrive },
      { id: "economy",    label: "Economy",    Icon: Coins },
      { id: "dmtemplates",label: "DM Templates",Icon: Mail },
    ],
  },
  {
    id: "config",
    label: "Configuration",
    tabs: [
      { id: "status",     label: "Status",     Icon: Activity },
      { id: "commands",   label: "Commands",   Icon: Terminal },
      { id: "embeds",     label: "Embed Builder", Icon: Palette },
    ],
  },
];

const ADMIN_SECTIONS = [
  {
    id: "admin",
    label: "Admin",
    tabs: [
      { id: "settings",  label: "Settings",     Icon: Gauge },
      { id: "ai",        label: "AI Assistant",  Icon: Sparkles },
      { id: "modules",   label: "Modules",       Icon: Blocks },
      { id: "data",      label: "Data",          Icon: Database },
    ],
  },
];

const USER_TABS = SIDEBAR_SECTIONS.flatMap(s => s.tabs);
const ADMIN_TABS = ADMIN_SECTIONS.flatMap(s => s.tabs);

export default function DashboardPage({ user, onLogout, isAdminMode, onToggleMode }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState("status");
  const [headerStatus, setHeaderStatus] = useState("loading...");
  const [guilds, setGuilds] = useState([]);
  const [guildId, setGuildId] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState(new Set());
  const contentRef = useRef(null);
  const drawerRef = useRef(null);

  const activeTabs = isAdminMode ? [...USER_TABS, ...ADMIN_TABS] : USER_TABS;
  const activeSections = isAdminMode ? ADMIN_SECTIONS : SIDEBAR_SECTIONS;

  function toggleSection(sectionId) {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  // Close drawer on outside click or swipe
  useEffect(() => {
    function onTouchStart(e) {
      if (!drawerRef.current || !mobileMenuOpen) return;
      const touch = e.touches[0];
      const startX = touch.clientX;
      function onTouchMove(ev) {
        const diff = ev.touches[0].clientX - startX;
        if (diff < -60) setMobileMenuOpen(false);
      }
      function onTouchEnd() {
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend", onTouchEnd);
      }
      document.addEventListener("touchmove", onTouchMove, { passive: true });
      document.addEventListener("touchend", onTouchEnd);
    }
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => document.removeEventListener("touchstart", onTouchStart);
  }, [mobileMenuOpen]);

  // Ctrl+K / Cmd+K command palette + Alt+1-9 quick tab switching
  useEffect(() => {
    function onKey(e) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
        setPaletteQuery("");
        return;
      }
      if (e.key === "Escape") { setPaletteOpen(false); setMobileMenuOpen(false); return; }
      if (e.altKey && e.key >= "1" && e.key <= "9") {
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        const idx = parseInt(e.key, 10) - 1;
        if (idx < activeTabs.length) {
          e.preventDefault();
          setTab(activeTabs[idx].id);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTabs]);

  const paletteItems = activeTabs.map(t => ({ type: "tab", label: t.label, id: t.id, Icon: t.Icon }));
  const filteredPalette = paletteQuery.trim()
    ? paletteItems.filter(t => t.label.toLowerCase().includes(paletteQuery.toLowerCase()))
    : paletteItems;

  async function fetchGuilds() {
    try {
      const { guilds: list } = await api("GET", "/api/guilds");
      setGuilds(list);
      // Prefer guild from URL query param, then first guild, then keep current
      const urlGuild = searchParams.get("guild");
      if (urlGuild && list.some(g => g.id === urlGuild)) {
        setGuildId(urlGuild);
      } else if (list.length > 0 && !guildId) {
        setGuildId(list[0].id);
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const s = await api("GET", "/api/status");
        if (alive) setHeaderStatus((s.tag || "offline") + " · " + s.ping + "ms");
      } catch { /* ignore */ }
    }
    tick();
    fetchGuilds();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [aiKey, setAiKey] = useState(0);

  useEffect(() => {
    const currentExists = activeTabs.some(t => t.id === tab);
    if (!currentExists) setTab("status");
  }, [isAdminMode, activeTabs]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [tab]);

  const renderPanelToggle = useCallback(() => {
    if (!user?.isOwner) return null;
    return (
      <div role="group" aria-label="Panel selector" style={{
        display: "flex", gap: 4, padding: "4px",
        background: "var(--surface)",
        border: "1px solid var(--border)", borderRadius: 6,
        margin: "4px 8px 8px",
      }}>
        <button
          aria-pressed={!isAdminMode}
          onClick={onToggleMode}
          disabled={!isAdminMode}
          className={`btn ${!isAdminMode ? "green" : "secondary"}`}
          style={{ flex: 1, padding: "6px 8px", fontSize: 12, justifyContent: "center", gap: 4 }}
        >
          <ShieldCheck style={{ width: 13, height: 13 }} /> Server
        </button>
        <button
          aria-pressed={isAdminMode}
          onClick={onToggleMode}
          disabled={isAdminMode}
          className={`btn ${isAdminMode ? "green" : "secondary"}`}
          style={{ flex: 1, padding: "6px 8px", fontSize: 12, justifyContent: "center", gap: 4 }}
        >
          <Cpu style={{ width: 13, height: 13 }} /> Admin
        </button>
      </div>
    );
  }, [user?.isOwner, isAdminMode, onToggleMode]);

  return (
    <div id="app">
      {/* ─── Mobile top bar ─── */}
      <div className="mobile-topbar">
        <button className="hamburger" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu">
          <Menu />
        </button>
        <span className="brand">ggboi</span>
        <span className="status-dot-mobile" title={headerStatus}></span>
        {guilds.length > 1 && (
          <div className="guild-select-mobile">
            <select value={guildId} onChange={(e) => setGuildId(e.target.value)}>
              {guilds.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ─── Mobile drawer ─── */}
      {mobileMenuOpen && (
        <>
          <div className="drawer-overlay" onClick={() => setMobileMenuOpen(false)} />
          <div className="drawer" ref={drawerRef}>
            <Sidebar
              sections={activeSections}
              tab={tab}
              onTab={(id) => { setTab(id); setMobileMenuOpen(false); }}
              collapsedSections={collapsedSections}
              onToggleSection={toggleSection}
              user={user}
              guilds={guilds}
              guildId={guildId}
              onGuildChange={setGuildId}
              isAdminMode={isAdminMode}
              renderPanelToggle={renderPanelToggle}
              headerStatus={headerStatus}
              onLogout={() => { onLogout(); setMobileMenuOpen(false); }}
              onNavClick={() => setMobileMenuOpen(false)}
            />
          </div>
        </>
      )}

      {/* ─── Desktop sidebar ─── */}
      <aside>
        <Sidebar
          sections={activeSections}
          tab={tab}
          onTab={setTab}
          collapsedSections={collapsedSections}
          onToggleSection={toggleSection}
          user={user}
          guilds={guilds}
          guildId={guildId}
          onGuildChange={setGuildId}
          isAdminMode={isAdminMode}
          renderPanelToggle={renderPanelToggle}
          headerStatus={headerStatus}
          onLogout={onLogout}
        />
      </aside>

      <div className="content-area" ref={contentRef}>
        <header>
          <button
            className="btn secondary"
            onClick={() => navigate("/")}
            style={{ marginRight: 8, padding: "5px 10px", fontSize: 12 }}
            title="Back to Home"
          >
            <ArrowLeft style={{ width: 14, height: 14 }} />
            <span>Home</span>
          </button>
          <h1>ggboi / {activeTabs.find(t => t.id === tab)?.label || tab}</h1>
          <div className="spacer"></div>
          <span className="muted" style={{ fontSize: 10, opacity: 0.5 }}>Alt+1-9 to switch tabs</span>
        </header>
        <main>
          <ErrorBoundary resetKey={tab + guildId}>
            {tab === "status" && <StatusTab onStatus={(s) => setHeaderStatus((s.tag || "offline") + " · " + s.ping + "ms")} admin={isAdminMode} />}
            {tab === "commands" && <CommandsTab guildId={guildId} />}
            {tab === "automod" && <AutomodTab guildId={guildId} />}
            {tab === "greet" && <GreetTab guildId={guildId} />}
            {tab === "roles" && <RolesTab guildId={guildId} />}
            {tab === "rolemembers" && <RoleMembersTab guildId={guildId} />}
            {tab === "channels" && <ChannelsTab guildId={guildId} />}
            {tab === "cases" && <CasesTab guildId={guildId} />}
            {tab === "schedule" && <ScheduleTab guildId={guildId} />}
            {tab === "backup" && <BackupTab guildId={guildId} />}
            {tab === "economy" && <EconomyTab guildId={guildId} />}
            {tab === "modlog" && <ModerationLogTab guildId={guildId} />}
            {tab === "modnotes" && <UserNotesTab guildId={guildId} />}
            {tab === "dmtemplates" && <DmTemplateTab guildId={guildId} />}
            {tab === "autoexec" && <AutoExecTab guildId={guildId} />}
            {tab === "dangerzone" && <DangerZoneTab guildId={guildId} />}
            {tab === "extautomod" && <ExtendedAutomodTab guildId={guildId} />}
            {tab === "settings" && <SettingsTab onReset={() => setAiKey((k) => k + 1)} />}
            {tab === "ai" && <AiTab key={aiKey} guildId={guildId} guilds={guilds} />}
            {tab === "modules" && <ModulesTab />}
            {tab === "data" && <DataTab />}
            {tab === "embeds" && <EmbedBuilderTab guildId={guildId} />}
          </ErrorBoundary>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={filteredPalette}
        onSelect={(id) => { setTab(id); setPaletteOpen(false); }}
        query={paletteQuery}
        onQuery={setPaletteQuery}
      />
    </div>
  );
}
