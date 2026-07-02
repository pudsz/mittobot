import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LogOut, ShieldCheck, Users, MessageSquare, Hash, Crown,
  Settings, ArrowRight, Server, Radio, Activity,
} from "lucide-react";
import { api, clearToken } from "../api.js";

function UserProfileCard({ user, onLogout }) {
  if (!user) return null;
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/${Number(user.id) % 5}.png`;

  return (
    <div className="home-profile-card">
      <div className="home-profile-banner" />
      <div className="home-profile-body">
        <img className="home-profile-avatar" src={avatarUrl} alt="" referrerPolicy="no-referrer" />
        <div className="home-profile-info">
          <div className="home-profile-name-row">
            <span className="home-profile-name">{user.tag}</span>
            {user.isOwner && (
              <span className="badge owner"><Crown style={{ width: 10, height: 10 }} /> Owner</span>
            )}
          </div>
          <div className="home-profile-id">ID: {user.id}</div>
        </div>
        <div className="home-profile-actions">
          <button className="btn secondary" onClick={onLogout}>
            <LogOut style={{ width: 14, height: 14 }} />
            <span>Log out</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ServerCard({ guild, onSelect, style }) {
  const iconUrl = guild.icon
    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
    : null;

  const acronym = guild.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();

  // Determine visual tier based on member count
  const tier = guild.memberCount >= 10000 ? "large" : guild.memberCount >= 1000 ? "medium" : "small";

  return (
    <button
      className={`server-card server-card--${tier}`}
      onClick={() => onSelect(guild.id)}
      title={`Open ${guild.name}`}
      style={style}
    >
      <div className="server-card-icon-wrap">
        {iconUrl ? (
          <img className="server-card-icon" src={iconUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <div className="server-card-acronym">{acronym}</div>
        )}
      </div>
      <div className="server-card-body">
        <div className="server-card-name-row">
          <div className="server-card-name">{guild.name}</div>
          {tier === "large" && <span className="badge ok server-tier-badge">✦ Large</span>}
        </div>
        <div className="server-card-meta">
          <span className="server-card-meta-item">
            <Users style={{ width: 12, height: 12 }} /> {guild.memberCount?.toLocaleString() ?? "?"}
          </span>
          <span className="server-card-meta-item">
            <Hash style={{ width: 12, height: 12 }} /> {guild.channelCount ?? "?"} ch
          </span>
          <span className="server-card-meta-item">
            <MessageSquare style={{ width: 12, height: 12 }} /> {guild.roleCount ?? "?"} roles
          </span>
        </div>
      </div>
      <div className="server-card-actions">
        <ArrowRight className="server-card-arrow" style={{ width: 16, height: 16 }} />
      </div>
    </button>
  );
}

function ServerNavigator({ guilds, onSelect }) {
  const [query, setQuery] = useState("");
  const filtered = query.trim()
    ? guilds.filter((g) => g.name.toLowerCase().includes(query.toLowerCase()))
    : guilds;

  return (
    <div className="server-navigator">
      <div className="server-navigator-header">
        <h2><Server style={{ width: 18, height: 18 }} /> Your Servers</h2>
        <span className="muted">{guilds.length} server{guilds.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="server-navigator-search">
        <input
          type="text"
          placeholder="Search servers..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="server-navigator-empty">
          <div className="server-navigator-empty-icon">
            <Server style={{ width: 40, height: 40 }} />
          </div>
          <p>{query.trim() ? `No servers match "${query}"` : "No servers available"}</p>
          {query.trim() && (
            <button className="btn secondary server-clear-btn" onClick={() => setQuery("")}>
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="server-grid">
          {filtered.map((g, i) => (
            <ServerCard key={g.id} guild={g} onSelect={onSelect} style={{ "--server-delay": `${0.04 * i}s` }} />
          ))}
        </div>
      )}
    </div>
  );
}

function QuickStats({ guilds }) {
  const totalMembers = guilds.reduce((s, g) => s + (g.memberCount || 0), 0);
  return (
    <div className="home-quick-stats">
      <div className="home-stat-item">
        <Server style={{ width: 18, height: 18, color: "var(--accent)" }} />
        <div>
          <div className="home-stat-value">{guilds.length}</div>
          <div className="home-stat-label">Servers</div>
        </div>
      </div>
      <div className="home-stat-item">
        <Users style={{ width: 18, height: 18, color: "var(--green)" }} />
        <div>
          <div className="home-stat-value">{totalMembers.toLocaleString()}</div>
          <div className="home-stat-label">Total Members</div>
        </div>
      </div>
      <div className="home-stat-item">
        <ShieldCheck style={{ width: 18, height: 18, color: "var(--purple)" }} />
        <div>
          <div className="home-stat-value">Ready</div>
          <div className="home-stat-label">Bot Status</div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage({ user, onLogout }) {
  const navigate = useNavigate();
  const [guilds, setGuilds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ tag: "offline", ping: 0 });

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [{ guilds: list }, s] = await Promise.all([
          api("GET", "/api/guilds"),
          api("GET", "/api/status"),
        ]);
        if (!alive) return;
        // Enrich guilds with channel/role counts from status if available
        setGuilds(list);
        setStatus(s);
      } catch {
        /* ignore */
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, []);

  function handleSelectGuild(guildId) {
    navigate(`/dashboard?guild=${guildId}`);
  }

  return (
    <div id="home-page">
      <header className="home-header">
        <div className="home-header-inner">
          <div className="home-brand">
            <span className="home-brand-title">ggboi</span>
            <span className="home-brand-sub">Control Panel</span>
          </div>
          <div className="home-header-status">
            <span className="status-dot" />
            <span className="muted">{status.tag || "offline"} · {status.ping}ms</span>
          </div>
        </div>
      </header>

      <main className="home-main">
        <div className="home-layout">
          {/* Left column — User profile + quick stats */}
          <div className="home-sidebar-col">
            <UserProfileCard user={user} onLogout={onLogout} />
            <QuickStats guilds={guilds} />
          </div>

          {/* Right column — Server navigator */}
          <div className="home-content-col">
            {loading ? (
              <div className="home-loading">
                <div className="spinner" />
                <span className="muted">Loading servers...</span>
              </div>
            ) : (
              <ServerNavigator guilds={guilds} onSelect={handleSelectGuild} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
