import { Routes, Route, Navigate } from "react-router-dom";
import EconomyView from "@/pages/views/engagement/EconomyView";
import TagsView from "@/pages/views/engagement/TagsView";
import MusicView from "@/pages/views/engagement/MusicView";

export default function EngagementHub() {
  return (
    <div className="p-6">
      <Routes>
        <Route index element={<Navigate to="economy" replace />} />
        <Route path="economy" element={<EconomyView />} />
        <Route path="tags" element={<TagsView />} />
        <Route path="music" element={<MusicView />} />
      </Routes>
    </div>
  );
}
