import { ChevronRight, LogOut } from "lucide-react";

export default function Sidebar({
  sections, tab, onTab, collapsedSections, onToggleSection,
  user, guilds, guildId, onGuildChange, isAdminMode, renderPanelToggle,
  headerStatus, onLogout, className = "", onNavClick,
}) {
  return (
    <div className={className}>
      <div className="brand-header">
        <span className="brand-title">ggboi</span>
        {isAdminMode && <span className="badge owner" style={{ fontSize: 9, padding: "1px 5px" }}>admin</span>}
        {className === "drawer" && (
          <button className="drawer-close" onClick={onNavClick} aria-label="Close menu"><span /></button>
        )}
      </div>

      <div className="status-container">
        <span className="status-dot" />
        <span>{headerStatus}</span>
      </div>

      {user && (
        <div className="user-info">
          <img
            className="user-avatar"
            src={
              user.avatar
                ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
                : `https://cdn.discordapp.com/embed/avatars/${Number(user.id) % 5}.png`
            }
            alt=""
            referrerPolicy="no-referrer"
          />
          <div className="user-details">
            <span className="user-name">{user.tag}</span>
            {user.isOwner && <span className="badge owner">owner</span>}
          </div>
        </div>
      )}

      {guilds.length > 1 && (
        <div className="guild-selector">
          <select value={guildId} onChange={(e) => onGuildChange(e.target.value)}>
            {guilds.map((g) => (
              <option key={g.id} value={g.id}>{g.name} ({g.memberCount})</option>
            ))}
          </select>
        </div>
      )}
      {guilds.length === 1 && className !== "drawer" && (
        <div className="guild-selector muted" style={{ padding: "0 8px", fontSize: 11 }}>
          {guilds[0].name}
        </div>
      )}

      {renderPanelToggle()}

      <nav>
        {sections.map((section) => {
          const isOpen = !collapsedSections.has(section.id);
          return (
            <div className="sidebar-section" key={section.id}>
              <div
                className="sidebar-section-header"
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => onToggleSection(section.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleSection(section.id); } }}
              >
                <ChevronRight className={`sidebar-section-chevron${isOpen ? " open" : ""}`} />
                <span className="sidebar-section-label">{section.label}</span>
              </div>
              <div className={`sidebar-section-tabs${isOpen ? " expanded" : ""}`}>
                {section.tabs.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    title={label}
                    className={tab === id ? "active" : ""}
                    onClick={() => { onTab(id); if (onNavClick) onNavClick(); }}
                  >
                    <Icon /> <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button className="btn" onClick={onLogout} style={{ width: "100%", justifyContent: "center" }}>
          <LogOut /> <span>Log out</span>
        </button>
      </div>
    </div>
  );
}
