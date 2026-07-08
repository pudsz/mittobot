import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { SaveBar } from "@/components/app/SaveBar";

export default function SettingsView() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingAll, setSavingAll] = useState(false);

  const { data, isLoading } = useQuery<{ settings: Record<string, any>; defaults: Record<string, any> }>({
    queryKey: ["settings"], queryFn: () => get("/api/settings"),
  });

  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading settings...</div>;

  const settings = data.settings;
  const defaults = data.defaults;
  const keys = Object.keys(settings).filter(k =>
    k.toLowerCase().includes(search.toLowerCase())
  ).sort();

  const dirty = Object.keys(edits).some(key => edits[key] !== String(settings[key] ?? ""));

  const handleSaveAll = async () => {
    setSavingAll(true);
    try {
      const promises = Object.entries(edits)
        .filter(([key, value]) => value !== String(settings[key] ?? ""))
        .map(([key, value]) =>
          post("/api/settings", { key, value: String(value) })
        );
      await Promise.all(promises);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setEdits({});
      toast.success("All settings saved successfully");
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setSavingAll(false);
    }
  };

  const handleReset = () => {
    setEdits({});
    toast("Changes discarded");
  };

  return (
    <div className="space-y-4">
      <SaveBar
        dirty={dirty}
        saving={savingAll}
        onSave={handleSaveAll}
        onReset={handleReset}
      />

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search settings..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Global Settings ({keys.length})</CardTitle>
          <CardDescription className="text-xs">Bot-wide configuration values</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border/20">
            {keys.map(key => {
              const current = edits[key] !== undefined ? edits[key] : String(settings[key] ?? "");
              const isChanged = edits[key] !== undefined && edits[key] !== String(settings[key] ?? "");
              const def = defaults[key];
              const isBool = typeof settings[key] === "boolean" || settings[key] === "true" || settings[key] === "false";
              return (
                <div key={key} className="flex items-center gap-3 px-5 py-3 hover:bg-card/10 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate font-mono">{key}</p>
                    <p className="text-[11px] text-muted-foreground truncate">default: {String(def ?? "")}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isBool ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className={`min-w-[70px] text-xs transition-all ${isChanged ? "border-primary text-primary" : ""}`}
                        onClick={() => {
                          const currentBool = current === "true";
                          setEdits(prev => ({ ...prev, [key]: !currentBool ? "true" : "false" }));
                        }}
                      >
                        {current === "true" ? "true" : "false"}
                      </Button>
                    ) : (
                      <Input
                        className={`w-40 h-8 text-xs font-mono transition-all ${isChanged ? "border-primary" : ""}`}
                        value={current}
                        onChange={e => setEdits(prev => ({ ...prev, [key]: e.target.value }))}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
