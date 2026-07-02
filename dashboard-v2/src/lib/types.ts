// ─── Shared API response types ───────────────────────────────────────────────
// Shapes mirror what src/api/server.js returns today. Fields the dashboard
// doesn't read are omitted; add them as pages need them.

export interface User {
  id: string;
  tag: string;
  avatar: string | null;
  isOwner: boolean;
}

export interface Guild {
  id: string;
  name: string;
  icon: string | null;
  memberCount?: number;
  channelCount?: number;
  roleCount?: number;
}

export interface BotStatus {
  online?: boolean;
  tag: string;
  ping: number;
  guilds: number;
  users: number;
  uptimeMs: number;
  activity: { name: string; type: number } | null;
  memoryUsedMb?: number;
  memoryTotalMb?: number;
  activeAiConversations?: number;
  commandsPerMin?: number;
  prefix?: string;
  cpuLoad?: { load1: number; load5: number; load15: number; cpuCount: number };
  processUptimeSec?: number;
  nodeRuntime?: { version: string; platform: string; arch: string; pid: number };
}

export interface Channel {
  id: string;
  name: string;
  type?: number;
  parentId?: string | null;
  position?: number;
}

export interface Role {
  id: string;
  name: string;
  color?: number;
  position?: number;
}

export interface FeatureCategory {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  commands: string[];
}

/** Live event pushed over SSE / returned by GET /api/activity. */
export interface ActivityEvent {
  id: string;
  guildId: string;
  type:
    | "member_join"
    | "member_leave"
    | "automod"
    | "mod_action"
    | "ai_reply"
    | string;
  timestamp: number;
  /** Short human line, e.g. `automod: spam by @user in #general` */
  summary: string;
  /** Extra structured detail, event-type specific. */
  data?: Record<string, unknown>;
}

export interface OverviewStats {
  guildName: string;
  memberCount: number;
  channelCount: number;
  roleCount: number;
  modActions7d: number;
  aiCallsToday: number;
  warningsActive: number;
  economyUsers: number;
  attention: AttentionItem[];
}

export interface AttentionItem {
  severity: "warn" | "info";
  message: string;
  /** Route within the dashboard that fixes it, e.g. `moderation/automod`. */
  fix?: string;
}
