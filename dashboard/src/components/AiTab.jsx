import { useState } from "react";
import { Settings, MessageSquare, BarChart3, History } from "lucide-react";
import AiConfigTab from "./AiConfigTab.jsx";
import AiChatTab from "./AiChatTab.jsx";
import AnalyticsTab from "./AnalyticsTab.jsx";
import ConversationsTab from "./ConversationsTab.jsx";

const AI_SUB_TABS = [
  { id: "config", label: "Config", icon: Settings },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "conversations", label: "Conversations", icon: History },
];

export default function AiTab({ guildId = "", guilds = [] }) {
  const [activeTab, setActiveTab] = useState("config");

  const tabStyle = (active) => ({
    display: "flex", alignItems: "center", gap: 6,
    padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
    border: "none", cursor: "pointer", transition: "all 0.15s ease",
    background: active ? "var(--accent)" : "transparent",
    color: active ? "#fff" : "var(--text-muted)",
  });

  const renderTab = () => {
    switch (activeTab) {
      case "config": return <AiConfigTab guildId={guildId} guilds={guilds} />;
      case "chat": return <AiChatTab guildId={guildId} />;
      case "analytics": return <AnalyticsTab />;
      case "conversations": return <ConversationsTab guildId={guildId} />;
      default: return null;
    }
  };

  return (
    <div>
      <div style={{
        display: "flex", gap: 2, marginBottom: 16,
        background: "var(--bg)", borderRadius: 10, padding: 4,
        border: "1px solid var(--border)", width: "fit-content",
      }}>
        {AI_SUB_TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={tabStyle(activeTab === t.id)}>
              <Icon style={{ width: 14, height: 14 }} />
              {t.label}
            </button>
          );
        })}
      </div>
      {renderTab()}
    </div>
  );
}
