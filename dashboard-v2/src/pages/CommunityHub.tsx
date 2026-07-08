import { Routes, Route, Navigate } from "react-router-dom";
import GreetView from "@/pages/views/community/GreetView";
import RolesView from "@/pages/views/community/RolesView";
import MembersView from "@/pages/views/community/MembersView";
import ChannelsView from "@/pages/views/community/ChannelsView";
import ScheduleView from "@/pages/views/community/ScheduleView";
import BackupsView from "@/pages/views/community/BackupsView";
import LevelsView from "@/pages/views/community/LevelsView";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Ticket, Gift,
  Star, MessageCircle, Calendar, Link2, Share2, Construction
} from "lucide-react";

function PlaceholderView({ icon: Icon, title, description, features }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  features: string[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2.5">
          <Icon className="size-5 text-primary" />
          {title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      <Card className="border-border/40 bg-card/30">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Construction className="size-4 text-warning" />
            Under Development
          </CardTitle>
          <CardDescription>This module is being built. The following features are planned:</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="text-primary mt-0.5">›</span>
                {f}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function TicketsView() {
  return <PlaceholderView icon={Ticket} title="Tickets Support" description="Build and handle customer support tickets."
    features={["Custom ticket panel designer", "Staff support roles setting", "Active ticket lists", "HTML-formatted transcript viewer for archives"]} />;
}
function GiveawaysView() {
  return <PlaceholderView icon={Gift} title="Giveaway Widgets" description="Host interactive giveaways in text channels."
    features={["Giveaway editor form (winners count, duration, restrictions)", "Active list with participant counts", "Manual giveaway cancel or immediate end", "Winner rerolling interface"]} />;
}
function StarboardView() {
  return <PlaceholderView icon={Star} title="Starboard Highlights" description="Log top-starred messages to a highlights board."
    features={["Target starboard channel select", "Star emoji configuration and reaction thresholds", "Browse logged spotlight cards"]} />;
}
function SuggestionsView() {
  return <PlaceholderView icon={MessageCircle} title="Suggestions Board" description="Receive user suggestion votes."
    features={["Suggestion channel select", "Staff review decisions panel (approve, reject, discuss)", "Direct comment replies thread links"]} />;
}
function BirthdaysView() {
  return <PlaceholderView icon={Calendar} title="Birthdays announcements" description="Congratulate members automatically."
    features={["Target announcement channel select", "Date entry format validations", "List of upcoming birthday celebrations"]} />;
}
function InvitesView() {
  return <PlaceholderView icon={Link2} title="Invite Tracking" description="Analyze which invite links brought in members."
    features={["Invite leaderboard", "Per-code tracker logs", "Inviter metrics dashboards"]} />;
}
function SocialView() {
  return <PlaceholderView icon={Share2} title="Social Connectors" description="Connect YouTube, Twitch, or RSS alerts to Discord logs."
    features={["Twitch streams checking intervals", "YouTube channel uploads updates", "RSS feeds parsing integrations", "Custom message template editor"]} />;
}

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
