import { Routes, Route, Navigate } from "react-router-dom";
import StatusView from "@/pages/views/system/StatusView";
import SettingsView from "@/pages/views/system/SettingsView";
import ModulesView from "@/pages/views/system/ModulesView";
import DataStoresView from "@/pages/views/system/DataStoresView";
import AlphaExperimentsView from "@/pages/views/system/AlphaExperimentsView";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

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

export default function SystemHub() {
  return (
    <div className="p-6">
      <Routes>
        <Route index element={<Navigate to="status" replace />} />
        <Route path="status" element={<StatusView />} />
        <Route path="settings" element={<SettingsView />} />
        <Route path="modules" element={<ModulesView />} />
        <Route path="data" element={<DataStoresView />} />
        <Route path="experiments" element={<AlphaExperimentsView />} />
      </Routes>
    </div>
  );
}
