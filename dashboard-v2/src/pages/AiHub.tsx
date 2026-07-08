import { Routes, Route, Navigate } from "react-router-dom";
import AiConfigView from "@/pages/views/ai/AiConfigView";
import AiChatView from "@/pages/views/ai/AiChatView";
import AiMemoryView from "@/pages/views/ai/AiMemoryView";
import AiAnalyticsView from "@/pages/views/ai/AiAnalyticsView";
import AiConversationsView from "@/pages/views/ai/AiConversationsView";

export default function AiHub() {
  return (
    <div className="p-6">
      <Routes>
        <Route index element={<Navigate to="config" replace />} />
        <Route path="config" element={<AiConfigView />} />
        <Route path="chat" element={<AiChatView />} />
        <Route path="memory" element={<AiMemoryView />} />
        <Route path="analytics" element={<AiAnalyticsView />} />
        <Route path="conversations" element={<AiConversationsView />} />
      </Routes>
    </div>
  );
}
