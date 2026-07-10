import { Routes, Route, Navigate } from "react-router-dom";
import AutomodView from "@/pages/views/moderation/AutomodView";
import AutomodV2View from "@/pages/views/moderation/AutomodV2View";
import AntiRaidView from "@/pages/views/moderation/AntiRaidView";
import DangerZoneView from "@/pages/views/moderation/DangerzoneView";
import ModLogView from "@/pages/views/moderation/ModLogView";
import UserNotesView from "@/pages/views/moderation/UserNotesView";
import AutoRulesView from "@/pages/views/moderation/AutoRulesView";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FolderOpen, Construction } from "lucide-react";

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

function CasesView() {
  return <PlaceholderView icon={FolderOpen} title="Moderation Cases" description="Browse, search, and manage all moderation cases in a structured database."
    features={["Full-text search across usernames, reasons, and action types", "Filter by action type: warn, mute, kick, ban", "Filter by moderator and date range", "Case detail panel with status workflow (open / investigating / resolved)", "CSV export for external review"]} />;
}

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
