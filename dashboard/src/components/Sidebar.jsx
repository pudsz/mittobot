import { useState } from 'react';
import { ChevronRight, LogOut, Menu, X, Settings, Cpu, User, HelpCircle } from 'lucide-react';

export default function Sidebar({
  sections,
  tab,
  onTab,
  collapsedSections,
  onToggleSection,
  user,
  guilds,
  guildId,
  onGuildChange,
  isAdminMode,
  renderPanelToggle,
  headerStatus,
  onLogout,
  className = '',
  onNavClick,
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside className={`sidebar ${className} ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          {!isCollapsed && (
            <>
              <span className="sidebar-brand-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }}>
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </span>
              <span className="sidebar-brand-title">ggboi</span>
              {isAdminMode && <span className="sidebar-badge owner">admin</span>}
            </>
          )}
          {isCollapsed && <span className="sidebar-brand-icon-only">gg</span>}
        </div>
        <button
          className="sidebar-toggle"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <X size={16} /> : <Menu size={16} />}
        </button>
      </div>

      {!isCollapsed && (
        <>
          <div className="sidebar-status">
            <span className="sidebar-status-dot" />
            <span className="sidebar-status-text">{headerStatus}</span>
          </div>

          <div className="sidebar-user">
            <img
              className="sidebar-avatar"
              src={
                user.avatar
                  ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
                  : `https://cdn.discordapp.com/embed/avatars/${Number(user.id) % 5}.png`
              }
              alt=""
            />
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{user.tag}</span>
              {user.isOwner && <span className="sidebar-badge owner">owner</span>}
            </div>
          </div>

          {guilds.length > 1 && (
            <div className="sidebar-guild-selector">
              <select value={guildId} onChange={(e) => onGuildChange(e.target.value)}>
                {guilds.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {guilds.length === 1 && (
            <div className="sidebar-guild-single">
              {guilds[0].name}
            </div>
          )}

          {renderPanelToggle && !isCollapsed && renderPanelToggle()}
        </>
      )}

      <nav className="sidebar-nav" aria-label="Main navigation">
        {sections.map((section) => {
          const isOpen = !collapsedSections.has(section.id);
          return (
            <div className="sidebar-section" key={section.id}>
              <button
                className="sidebar-section-header"
                onClick={() => onToggleSection(section.id)}
                aria-expanded={isOpen}
              >
                <span className="sidebar-section-label">{section.label}</span>
                {!isCollapsed && (
                  <ChevronRight className={`sidebar-section-chevron ${isOpen ? 'open' : ''}`} />
                )}
              </button>
              <div className={`sidebar-section-tabs ${isOpen && !isCollapsed ? 'expanded' : ''}`}>
                <div>
                  {section.tabs.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      className={tab === id ? 'active' : ''}
                      onClick={() => { onTab(id); if (onNavClick) onNavClick(); }}
                      title={label}
                    >
                      <Icon className="sidebar-tab-icon" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        {!isCollapsed ? (
          <div className="sidebar-footer-links">
            <button
              className="sidebar-footer-link"
              onClick={() => { /* Help action */ }}
              title="Help & Docs"
            >
              <HelpCircle size={16} />
              <span>Help</span>
            </button>
            <button
              className="sidebar-footer-link"
              onClick={() => { /* Settings action */ }}
              title="Appearance"
            >
              <Settings size={16} />
              <span>Appearance</span>
            </button>
            <button
              className="sidebar-footer-link danger"
              onClick={onLogout}
              title="Log out"
            >
              <LogOut size={16} />
              <span>Log out</span>
            </button>
          </div>
        ) : (
          <div className="sidebar-footer-icons">
            <button className="sidebar-footer-icon" title="Help & Docs"><HelpCircle size={16} /></button>
            <button className="sidebar-footer-icon" title="Appearance"><Settings size={16} /></button>
            <button className="sidebar-footer-icon danger" onClick={onLogout} title="Log out"><LogOut size={16} /></button>
          </div>
        )}
      </div>
    </aside>
  );
}
