import { Routes, Route, Navigate } from "react-router-dom";
import AutomodView from "@/pages/views/moderation/AutomodView";
import AutomodV2View from "@/pages/views/moderation/AutomodV2View";
import AntiRaidView from "@/pages/views/moderation/AntiRaidView";
import DangerZoneView from "@/pages/views/moderation/DangerzoneView";
import ModLogView from "@/pages/views/moderation/ModLogView";
import UserNotesView from "@/pages/views/moderation/UserNotesView";
import AutoRulesView from "@/pages/views/moderation/AutoRulesView";
import CasesView from "@/pages/views/moderation/CasesView";

export default function ModerationHub() {
  return (
    <div className="p-6">
      <Routes>
        <Route index element={<Navigate to="automod" replace />} />
        <Route path="automod" element={<AutomodView />} />
        <Route path="automodv2" element={<AutomodV2View />} />
        <Route path="antiraid" element={<AntiRaidView />} />
        <Route path="dangerzone" element={<DangerZoneView />} />
        <Route path="cases" element={<CasesView />} />
        <Route path="modlog" element={<ModLogView />} />
        <Route path="notes" element={<UserNotesView />} />
        <Route path="rules" element={<AutoRulesView />} />
      </Routes>
    </div>
  );
}
