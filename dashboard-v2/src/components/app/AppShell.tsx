import { useState, type ComponentType } from "react";
import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  Menu, Terminal, LogOut, ChevronDown, ChevronRight,
  Home, Activity, Settings, Blocks, Database, FlaskConical, LayoutDashboard, Cpu,
  // Moderation icons
  ShieldAlert, ShieldBan, Flame, FolderOpen, ScrollText, StickyNote, Zap,
  // Community icons
  MessageSquareText, UserCheck, Users, FolderSync, BarChart3, Ticket, Gift,
  Star, MessageCircle, Cake, Link2, Share2, Clock, HardDrive,
  // Engagement icons
  Coins, Bookmark, Music,
  // AI icons
  Sparkles, Brain, TrendingUp, History,
  // System
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useGuild } from "@/hooks/useGuild";
import { avatarUrl, guildIconUrl, guildAcronym } from "@/lib/utils";

interface NavItem {
  label: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

export default function AppShell() {
  const { user, guilds, logout } = useAuth();
  const { guildId, guild } = useGuild();
  const navigate = useNavigate();
  const location = useLocation();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    moderation: true,
    community: true,
    engagement: true,
    ai: true,
  });

  const toggleSection = (id: string) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const isSystemRoute = location.pathname.startsWith("/system");

  const sections: NavSection[] = [
    {
      id: "moderation",
      label: "Moderation",
      items: [
        { label: "Automod", path: `/g/${guildId}/moderation/automod`, icon: ShieldAlert },
        { label: "Automod v2", path: `/g/${guildId}/moderation/automodv2`, icon: Sparkles },
        { label: "Anti-raid", path: `/g/${guildId}/moderation/antiraid`, icon: ShieldBan },
        { label: "Dangerzone", path: `/g/${guildId}/moderation/dangerzone`, icon: Flame },
        { label: "Cases", path: `/g/${guildId}/moderation/cases`, icon: FolderOpen },
        { label: "Mod Log", path: `/g/${guildId}/moderation/modlog`, icon: ScrollText },
        { label: "User Notes", path: `/g/${guildId}/moderation/notes`, icon: StickyNote },
        { label: "Auto Rules", path: `/g/${guildId}/moderation/rules`, icon: Zap },
      ],
    },
    {
      id: "community",
      label: "Community",
      items: [
        { label: "Greet & Logs", path: `/g/${guildId}/community/greet`, icon: MessageSquareText },
        { label: "Roles", path: `/g/${guildId}/community/roles`, icon: UserCheck },
        { label: "Role Members", path: `/g/${guildId}/community/members`, icon: Users },
        { label: "Channels", path: `/g/${guildId}/community/channels`, icon: FolderSync },
        { label: "Levels", path: `/g/${guildId}/community/levels`, icon: BarChart3 },
        { label: "Tickets", path: `/g/${guildId}/community/tickets`, icon: Ticket },
        { label: "Giveaways", path: `/g/${guildId}/community/giveaways`, icon: Gift },
        { label: "Starboard", path: `/g/${guildId}/community/starboard`, icon: Star },
        { label: "Suggestions", path: `/g/${guildId}/community/suggestions`, icon: MessageCircle },
        { label: "Birthdays", path: `/g/${guildId}/community/birthdays`, icon: Cake },
        { label: "Invites", path: `/g/${guildId}/community/invites`, icon: Link2 },
        { label: "Social", path: `/g/${guildId}/community/social`, icon: Share2 },
        { label: "Schedule", path: `/g/${guildId}/community/schedule`, icon: Clock },
        { label: "Backups", path: `/g/${guildId}/community/backups`, icon: HardDrive },
      ],
    },
    {
      id: "engagement",
      label: "Engagement",
      items: [
        { label: "Economy", path: `/g/${guildId}/engagement/economy`, icon: Coins },
        { label: "Tags", path: `/g/${guildId}/engagement/tags`, icon: Bookmark },
        { label: "Music", path: `/g/${guildId}/engagement/music`, icon: Music },
      ],
    },
    {
      id: "ai",
      label: "AI Engine",
      items: [
        { label: "Configuration", path: `/g/${guildId}/ai/config`, icon: Sparkles },
        { label: "Test Chat", path: `/g/${guildId}/ai/chat`, icon: Cpu },
        { label: "Memory Browser", path: `/g/${guildId}/ai/memory`, icon: Brain },
        { label: "Usage Analytics", path: `/g/${guildId}/ai/analytics`, icon: TrendingUp },
        { label: "Conversations", path: `/g/${guildId}/ai/conversations`, icon: History },
      ],
    },
  ];

  const systemSection: NavSection = {
    id: "system",
    label: "System",
    items: [
      { label: "Status & Health", path: "/system/status", icon: Activity },
      { label: "Global Settings", path: "/system/settings", icon: Settings },
      { label: "Custom Modules", path: "/system/modules", icon: Blocks },
      { label: "Data Stores", path: "/system/data", icon: Database },
      { label: "Alpha Experiments", path: "/system/experiments", icon: FlaskConical },
    ],
  };

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar">
      {/* Brand — no ping */}
      <div className="h-14 border-b border-sidebar-border px-5 flex items-center gap-2.5 shrink-0">
        <Terminal className="size-5 text-primary" />
        <span className="font-semibold text-foreground tracking-tight text-base">ggboi</span>
        <span className="status-dot ml-auto" />
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-5">
          {/* Guild Switcher */}
          {!isSystemRoute && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between h-10 px-3 border-sidebar-border bg-card/40 text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <div className="size-6 rounded bg-secondary flex items-center justify-center shrink-0 overflow-hidden">
                      {guild?.icon ? (
                        <img src={guildIconUrl(guild)!} className="size-full object-cover" alt="" />
                      ) : (
                        <span className="font-mono text-[10px] font-bold text-muted-foreground">
                          {guild ? guildAcronym(guild.name) : "?"}
                        </span>
                      )}
                    </div>
                    <span className="truncate font-semibold text-foreground">
                      {guild?.name || "Select..."}
                    </span>
                  </div>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[200px] border-sidebar-border bg-card">
                {guilds.map((g) => (
                  <DropdownMenuItem key={g.id} onClick={() => navigate(`/g/${g.id}`)} className="gap-2 cursor-pointer text-xs">
                    <div className="size-5 rounded bg-secondary flex items-center justify-center overflow-hidden shrink-0">
                      {g.icon ? (
                        <img src={guildIconUrl(g)!} className="size-full object-cover" alt="" />
                      ) : (
                        <span className="font-mono text-[9px] font-bold text-muted-foreground">{guildAcronym(g.name)}</span>
                      )}
                    </div>
                    <span className="truncate">{g.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Top-level links */}
          <div className="space-y-0.5">
            {!isSystemRoute ? (
              <>
                <NavLink
                  to={`/g/${guildId}/overview`}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                      isActive ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`
                  }
                >
                  <Home className="size-4" />
                  Overview
                </NavLink>
                <NavLink
                  to={`/g/${guildId}/commands`}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                      isActive ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`
                  }
                >
                  <LayoutDashboard className="size-4" />
                  Commands
                </NavLink>
              </>
            ) : (
              <Link
                to={guildId ? `/g/${guildId}/overview` : "/servers"}
                className="flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              >
                <ArrowLeft className="size-4" />
                Back to Guild
              </Link>
            )}
          </div>

          {/* Collapsible Sections */}
          {!isSystemRoute ? (
            <div className="space-y-3">
              {sections.map((sec) => (
                <div key={sec.id}>
                  <button
                    onClick={() => toggleSection(sec.id)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {sec.label}
                    {openSections[sec.id] ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  </button>
                  {openSections[sec.id] && (
                    <div className="space-y-0.5 mt-1">
                      {sec.items.map((item) => (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          className={({ isActive }) =>
                            `flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                              isActive
                                ? "bg-sidebar-accent text-primary border-l-2 border-primary pl-[10px]"
                                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            }`
                          }
                        >
                          <item.icon className="size-3.5 shrink-0" />
                          {item.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-0.5">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {systemSection.label}
              </div>
              {systemSection.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-sidebar-accent text-primary border-l-2 border-primary pl-[10px]"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`
                  }
                >
                  <item.icon className="size-3.5 shrink-0" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* User footer */}
      {user && (
        <div className="h-14 border-t border-sidebar-border px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 truncate">
            <img src={avatarUrl(user)} alt="" className="size-7 rounded-full border border-sidebar-border bg-background shrink-0" referrerPolicy="no-referrer" />
            <div className="truncate min-w-0">
              <div className="text-xs font-semibold text-foreground truncate">{user.tag}</div>
              <div className={`text-[9px] uppercase font-bold tracking-wider ${user.isOwner ? "text-primary" : "text-muted-foreground"}`}>
                {user.isOwner ? "Owner" : "Admin"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {user.isOwner && (
              <NavLink to="/system/status">
                <Button variant="ghost" size="icon" className={`size-7 text-muted-foreground hover:text-foreground ${isSystemRoute ? "text-primary" : ""}`} title="System">
                  <Cpu className="size-3.5" />
                </Button>
              </NavLink>
            )}
            <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={logout} title="Log out">
              <LogOut className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen bg-background flex flex-col md:flex-row overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 h-full border-r border-sidebar-border bg-sidebar">
        {renderSidebarContent()}
      </aside>

      {/* Mobile topbar */}
      <div className="md:hidden flex h-12 border-b border-border/40 bg-card/60 backdrop-blur-md px-4 items-center justify-between shrink-0 w-full">
        <div className="flex items-center gap-2.5">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 border-r-0 w-60 bg-sidebar">
              {renderSidebarContent()}
            </SheetContent>
          </Sheet>
          <span className="font-semibold text-foreground tracking-tight text-sm">ggboi</span>
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-28">
            {isSystemRoute ? "System" : (guild?.name || "")}
          </span>
        </div>
      </div>

      {/* Content pane */}
      <main className="flex-1 min-w-0 overflow-y-auto h-full">
        <Outlet />
      </main>
    </div>
  );
}
