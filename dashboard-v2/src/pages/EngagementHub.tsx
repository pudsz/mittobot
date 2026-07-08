import { Routes, Route, Navigate } from "react-router-dom";
import EconomyView from "@/pages/views/engagement/EconomyView";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bookmark, Music, Construction } from "lucide-react";

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
function TagsView() {
  return <PlaceholderView icon={Bookmark} title="Custom Tags" description="Manage custom triggers and auto responses."
    features={["Quick response text tag CRUD editor", "Rich Embed JSON builder support", "Tag usage statistics analytics"]} />;
}
function MusicView() {
  return <PlaceholderView icon={Music} title="Music Stream" description="View voice channel playback queues, player states, and presets."
    features={["Live now-playing progress track details", "Queue editor sorting options", "Radio station preset controls"]} />;
}

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
