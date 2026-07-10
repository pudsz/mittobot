import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, RefreshCw } from "lucide-react";

const DATA_STORE_NAMES: Record<string, string> = {
  stickies: "Sticky Messages",
  warnings: "Warnings",
  reactionlogs: "Reaction Logs",
  afkUsers: "AFK Users",
  customRoles: "Custom Roles",
};

interface DataResponse {
  store: string; data: any;
}

export default function DataStoresView() {
  const { guildId } = useGuild();
  const [selectedStore, setSelectedStore] = useState("stickies");

  const { data, isLoading, refetch, isFetching } = useQuery<DataResponse>({
    queryKey: ["data-store", selectedStore, guildId],
    // Pass guildId so the backend can scope guild-keyed stores (warnings,
    // customRoles, reactionlogs, afkUsers) to the selected guild instead of
    // returning every guild's data.
    queryFn: () => get(guildPath(`/api/data/${selectedStore}`, guildId)),
    enabled: !!guildId,
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;

  const rawData = data?.data;
  const preview = rawData ? JSON.stringify(rawData, null, 2) : "{}";
  const truncated = preview.length > 20000;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="size-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Data Stores</h1>
            <p className="text-xs text-muted-foreground">Read-only views of in-memory state stores</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`size-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Select Store</CardTitle>
          <CardDescription className="text-xs">Choose a data store to inspect</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(DATA_STORE_NAMES).map(([key, label]) => (
              <Button key={key} size="sm" variant={selectedStore === key ? "default" : "outline"} onClick={() => setSelectedStore(key)}>
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{DATA_STORE_NAMES[selectedStore]}</CardTitle>
          <CardDescription className="text-xs">Store: <code className="font-mono">{selectedStore}</code></CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : (
            <>
              {truncated && (
                <div className="text-[10px] text-warning mb-2">Data truncated — showing first 20,000 characters</div>
              )}
              <pre className="bg-background-alt/30 p-3 rounded text-[10px] font-mono overflow-auto max-h-96 whitespace-pre-wrap">
                {truncated ? preview.slice(0, 20000) + "\n…" : preview}
              </pre>
              <div className="text-[10px] text-muted-foreground mt-2">
                {rawData ? `${Object.keys(rawData).length} top-level keys` : "Empty"}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
