import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get, guildPath } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { BotStatus, Channel, Guild, Role } from "@/lib/types";

/** The guild for the current /g/:guildId/* route. */
export function useGuild(): { guildId: string; guild: Guild | undefined } {
  const { guildId = "" } = useParams<{ guildId: string }>();
  const { guilds } = useAuth();
  return { guildId, guild: guilds.find((g) => g.id === guildId) };
}

/** Bot status, polled — powers the sidebar status pill. */
export function useBotStatus(pollMs = 15_000) {
  return useQuery<BotStatus>({
    queryKey: ["status"],
    queryFn: () => get("/api/status"),
    refetchInterval: pollMs,
    staleTime: 5_000,
  });
}

/**
 * Text channels + roles for pickers, shared across pages.
 * Most guild-scoped GET endpoints embed `channels`/`roles` in their own
 * response (v1 pattern), but a shared cached copy avoids re-plumbing them
 * through every component. Sourced from /api/automod which returns the
 * standard `getGuildInfo()` shape.
 */
export function useGuildMeta(guildId: string) {
  return useQuery<{
    hasGuild: boolean;
    guildName: string | null;
    channels: Channel[];
    roles: Role[];
  }>({
    queryKey: ["guild", guildId, "meta"],
    queryFn: () => get(guildPath("/api/automod", guildId)),
    enabled: !!guildId,
    staleTime: 120_000,
  });
}
