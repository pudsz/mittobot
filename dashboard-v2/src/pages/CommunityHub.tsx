import { Routes, Route, Navigate } from "react-router-dom";
import GreetView from "@/pages/views/community/GreetView";
import RolesView from "@/pages/views/community/RolesView";
import MembersView from "@/pages/views/community/MembersView";
import ChannelsView from "@/pages/views/community/ChannelsView";
import ScheduleView from "@/pages/views/community/ScheduleView";
import BackupsView from "@/pages/views/community/BackupsView";
import LevelsView from "@/pages/views/community/LevelsView";
import StarboardView from "@/pages/views/community/StarboardView";
import BirthdaysView from "@/pages/views/community/BirthdaysView";
import TicketsView from "@/pages/views/community/TicketsView";
import GiveawaysView from "@/pages/views/community/GiveawaysView";
import SuggestionsView from "@/pages/views/community/SuggestionsView";
import InvitesView from "@/pages/views/community/InvitesView";
import SocialView from "@/pages/views/community/SocialView";

export default function CommunityHub() {
  return (
    <div className="p-6">
      <Routes>
        <Route index element={<Navigate to="greet" replace />} />
        <Route path="greet" element={<GreetView />} />
        <Route path="roles" element={<RolesView />} />
        <Route path="members" element={<MembersView />} />
        <Route path="channels" element={<ChannelsView />} />
        <Route path="levels" element={<LevelsView />} />
        <Route path="tickets" element={<TicketsView />} />
        <Route path="giveaways" element={<GiveawaysView />} />
        <Route path="starboard" element={<StarboardView />} />
        <Route path="suggestions" element={<SuggestionsView />} />
        <Route path="birthdays" element={<BirthdaysView />} />
        <Route path="invites" element={<InvitesView />} />
        <Route path="social" element={<SocialView />} />
        <Route path="schedule" element={<ScheduleView />} />
        <Route path="backups" element={<BackupsView />} />
      </Routes>
    </div>
  );
}
