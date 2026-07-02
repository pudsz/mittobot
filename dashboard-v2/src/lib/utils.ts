import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Discord CDN avatar URL for a user, with default-avatar fallback.
 *  Password-login sessions have a non-numeric id ("password-session"). */
export function avatarUrl(user: { id: string; avatar?: string | null }) {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
  }
  const idx = /^\d+$/.test(user.id) ? Number(BigInt(user.id) % 5n) : 0;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

/** Discord CDN guild icon URL (null if the guild has no icon). */
export function guildIconUrl(guild: { id: string; icon?: string | null }, size = 128) {
  return guild.icon
    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=${size}`
    : null;
}

/** "MyServer Name" → "MSN" acronym for icon-less guilds. */
export function guildAcronym(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

/** 93784000ms → "1d 2h 3m" */
export function formatUptime(ms: number) {
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec % 60}s`;
}

/** Epoch ms → "14:02:11" local time. */
export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Epoch ms → relative "3m ago" style string. */
export function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
