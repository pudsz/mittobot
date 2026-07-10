import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, del, patch } from "@/lib/api";
import { guildPath } from "@/lib/api";
import { useGuild } from "@/hooks/useGuild";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Coins, Plus, Trash2, Edit, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { SaveBar } from "@/components/app/SaveBar";
import { useConfirm } from "@/components/app/ConfirmProvider";

interface EconomyConfig {
  dailyAmount: number; workMin: number; workMax: number;
  interestRate: number; taxRate: number;
  // Game tuning (all optional — older configs/defaults may omit them).
  slotsMinBet?: number; slotsMaxBet?: number; slotsWinOdds?: number; slotsJackpotMultiplier?: number;
  coinflipMinBet?: number; coinflipMaxBet?: number;
  highlowMinBet?: number; highlowMaxBet?: number; highlowDiceSides?: number;
  blackjackMinBet?: number; blackjackMaxBet?: number; blackjackPayout?: number;
  fishMinBet?: number;
  mineMinBet?: number;
  triviaStreakBonus?: number;
  wordleEnabled?: number; wordleStreakBonus?: number;
}

interface EconomyStats {
  totalWealth: number; totalWallet: number; totalBank: number;
  userCount: number; richestUserId?: string; richestName?: string;
}

interface ShopItem {
  id: number; guildId: string; name: string;
  description: string; price: number;
  roleId?: string | null; roleName?: string | null; stock: number;
}

interface LBRow {
  user_id: string; balance: number; displayName: string;
}

interface ConfigData {
  config: EconomyConfig; defaults: EconomyConfig;
  hasGuild: boolean; guildId: string;
}

// Parse a stock input. -1 means infinite (∞), 0 means sold out, N means N in
// stock. Empty/garbage → -1. The previous `parseInt(x) || -1` coerced a typed
// "0" (sold out) to -1 (infinite) because 0 is falsy — so a user intending
// "sold out" silently got unlimited stock.
function parseStock(raw: string): number {
  const n = parseInt(raw);
  return Number.isNaN(n) ? -1 : n;
}

export default function EconomyView() {
  const { guildId } = useGuild();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"config" | "shop" | "leaderboard">("config");
  // configDirty holds RAW input strings so a field can be cleared without
  // snapping to 0 — the previous parseFloat(x)||0 committed 0 the moment a
  // field was emptied, making it impossible to retype. Numbers are parsed at
  // save time; empty/invalid entries are skipped.
  const [configDirty, setConfigDirty] = useState<Partial<Record<keyof EconomyConfig, string>> | null>(null);
  const [newItem, setNewItem] = useState({ name: "", description: "", price: 100, roleId: "", stock: -1 });
  const [editingItem, setEditingItem] = useState<ShopItem | null>(null);
  // Controlled draft for the shop-item edit form. The previous version used
  // uncontrolled defaultValue inputs read via document.getElementById, which
  // reused the same DOM nodes when switching the edited item — so saving
  // item B persisted item A's field values. A draft keyed off the edit target
  // fixes that.
  const [editDraft, setEditDraft] = useState<{ name: string; description: string; price: string; stock: string } | null>(null);

  const { data: cfgData, isLoading: cfgLoading } = useQuery<ConfigData>({
    queryKey: ["economy-config", guildId],
    queryFn: () => get(guildPath("/api/economy/config", guildId)),
    enabled: !!guildId,
  });

  const { data: statsData } = useQuery<{ stats: EconomyStats }>({
    queryKey: ["economy-stats", guildId],
    queryFn: () => get(guildPath("/api/economy/stats", guildId)),
    enabled: !!guildId,
  });

  const { data: shopData, isLoading: shopLoading } = useQuery<{ items: ShopItem[]; roles: any[] }>({
    queryKey: ["economy-shop", guildId],
    queryFn: () => get(guildPath("/api/economy/shop", guildId)),
    enabled: !!guildId,
  });

  const { data: lbData, isLoading: lbLoading } = useQuery<{ leaderboard: LBRow[] }>({
    queryKey: ["economy-leaderboard", guildId],
    queryFn: () => get(guildPath("/api/economy/leaderboard", guildId)),
    enabled: !!guildId,
  });

  const saveConfigMutation = useMutation({
    mutationFn: (body: Partial<EconomyConfig>) => post(guildPath("/api/economy/config", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["economy-config", guildId] });
      setConfigDirty(null);
      toast.success("Config updated");
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const resetMutation = useMutation({
    mutationFn: () => post(guildPath("/api/economy/reset", guildId), {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["economy-config", guildId] });
      queryClient.invalidateQueries({ queryKey: ["economy-stats", guildId] });
      queryClient.invalidateQueries({ queryKey: ["economy-leaderboard", guildId] });
      toast.success("Economy reset");
    },
    onError: (e: any) => toast.error(e.message || "Reset failed"),
  });

  const addItemMutation = useMutation({
    mutationFn: (body: any) => post(guildPath("/api/economy/shop", guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["economy-shop", guildId] });
      setNewItem({ name: "", description: "", price: 100, roleId: "", stock: -1 });
      toast.success("Shop item added");
    },
    onError: (e: any) => toast.error(e.message || "Add failed"),
  });

  const editItemMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) => patch(guildPath(`/api/economy/shop/${id}`, guildId), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["economy-shop", guildId] });
      setEditingItem(null);
      toast.success("Item updated");
    },
    onError: (e: any) => toast.error(e.message || "Update failed"),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (id: number) => del(guildPath(`/api/economy/shop/${id}`, guildId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["economy-shop", guildId] });
      toast.success("Item deleted");
    },
    onError: (e: any) => toast.error(e.message || "Delete failed"),
  });

  if (!guildId) return <div className="p-6 text-sm text-muted-foreground">Select a guild first.</div>;

  const config = cfgData?.config || ({} as EconomyConfig);
  const defaults = cfgData?.defaults || ({} as EconomyConfig);

  // Display value for a config field: the raw dirty string if being edited,
  // else the stored/default value as a string. Keeps the input clearable
  // without snapping to 0 mid-edit.
  const cfgValue = (key: keyof EconomyConfig): string => {
    if (configDirty && configDirty[key] !== undefined) return configDirty[key] as string;
    const stored = config[key] ?? defaults[key];
    return stored === undefined || stored === null ? "" : String(stored);
  };

  // Dirty when any edited field parses to a number different from stored.
  const dirty = configDirty !== null && (Object.keys(configDirty) as (keyof EconomyConfig)[]).some(k => {
    const raw = configDirty[k];
    if (raw === undefined) return false;
    const n = parseFloat(raw);
    if (Number.isNaN(n)) return false;
    return n !== (config[k] ?? defaults[k]);
  });

  const handleConfigChange = (key: keyof EconomyConfig, value: string) => {
    setConfigDirty(prev => ({ ...(prev || {}), [key]: value }));
  };

  const handleSaveConfig = () => {
    if (!configDirty) return;
    // Parse raw strings to numbers at the save boundary; skip empty/invalid.
    const payload: Partial<EconomyConfig> = {};
    for (const k of Object.keys(configDirty) as (keyof EconomyConfig)[]) {
      const raw = configDirty[k] as string;
      if (raw.trim() === "") continue;
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) (payload as Record<string, number>)[k as string] = n;
    }
    if (Object.keys(payload).length === 0) { setConfigDirty(null); return; }
    saveConfigMutation.mutate(payload);
  };

  const tabs = [
    { id: "config" as const, label: "Config" },
    { id: "shop" as const, label: "Shop Items" },
    { id: "leaderboard" as const, label: "Leaderboard" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Coins className="size-5 text-primary" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Economy</h1>
          <p className="text-xs text-muted-foreground">
            {statsData?.stats ? `${statsData.stats.userCount} users · ${(statsData.stats.totalWealth || 0).toLocaleString()} total wealth` : "Virtual currency system"}
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border/30">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "config" && (
        <>
          {cfgLoading ? (
            <div className="text-xs text-muted-foreground py-4">Loading config...</div>
          ) : (
            <>
              <SaveBar dirty={dirty} saving={saveConfigMutation.isPending} onSave={handleSaveConfig} onReset={() => setConfigDirty(null)} />
              <Card className="border-border/40 bg-card/40">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold">Economy Settings</CardTitle>
                    <CardDescription className="text-xs">Daily, work, and gamble parameters</CardDescription>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                    if (!await confirm({
                      title: "Reset all economy data?",
                      description: "This permanently deletes every user's wallet, bank, the config, and all shop items for this guild. Cannot be undone.",
                      confirmLabel: "Reset everything",
                    })) return;
                    resetMutation.mutate();
                  }}>
                    <RotateCcw className="size-3.5 mr-1" /> Reset All
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {[
                      { key: "dailyAmount", label: "Daily Amount", min: 1 },
                      { key: "workMin", label: "Work Min", min: 1 },
                      { key: "workMax", label: "Work Max", min: 1 },
                      { key: "interestRate", label: "Interest Rate (%)", min: 0, max: 100, step: 0.1 },
                      { key: "taxRate", label: "Tax Rate (%)", min: 0, max: 100, step: 0.1 },
                    ].map(f => (
                      <div key={f.key}>
                        <label className="text-xs text-muted-foreground">{f.label}</label>
                        <Input type="number" className="mt-1 text-xs font-mono"
                          value={cfgValue(f.key as keyof EconomyConfig)}
                          min={f.min} max={f.max} step={f.step}
                          onChange={e => handleConfigChange(f.key as keyof EconomyConfig, e.target.value)} />
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 pt-4 border-t border-border/30">
                    <p className="text-xs font-semibold text-muted-foreground mb-3">🎰 Slots</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[
                        { key: "slotsMinBet", label: "Min Bet", min: 1 },
                        { key: "slotsMaxBet", label: "Max Bet", min: 1 },
                        { key: "slotsWinOdds", label: "Win Odds (0-1)", min: 0, max: 1, step: 0.01 },
                        { key: "slotsJackpotMultiplier", label: "Jackpot ×", min: 1 },
                      ].map(f => (
                        <div key={f.key}>
                          <label className="text-xs text-muted-foreground">{f.label}</label>
                          <Input type="number" className="mt-1 text-xs font-mono"
                            value={cfgValue(f.key as keyof EconomyConfig)}
                            min={f.min} max={f.max} step={f.step}
                            onChange={e => handleConfigChange(f.key as keyof EconomyConfig, e.target.value)} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-border/30">
                    <p className="text-xs font-semibold text-muted-foreground mb-3">🃏 Blackjack · 🪙 Betflip · 🎲 High/Low</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[
                        { key: "blackjackMinBet", label: "BJ Min Bet", min: 1 },
                        { key: "blackjackMaxBet", label: "BJ Max Bet", min: 1 },
                        { key: "blackjackPayout", label: "BJ Payout ×", min: 1, max: 3, step: 0.1 },
                        { key: "coinflipMinBet", label: "Betflip Min", min: 1 },
                        { key: "coinflipMaxBet", label: "Betflip Max", min: 1 },
                        { key: "highlowMinBet", label: "High/Low Min", min: 1 },
                        { key: "highlowMaxBet", label: "High/Low Max", min: 1 },
                        { key: "highlowDiceSides", label: "Dice Sides", min: 2, max: 100 },
                      ].map(f => (
                        <div key={f.key}>
                          <label className="text-xs text-muted-foreground">{f.label}</label>
                          <Input type="number" className="mt-1 text-xs font-mono"
                            value={cfgValue(f.key as keyof EconomyConfig)}
                            min={f.min} max={f.max} step={f.step}
                            onChange={e => handleConfigChange(f.key as keyof EconomyConfig, e.target.value)} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-border/30">
                    <p className="text-xs font-semibold text-muted-foreground mb-3">🎣 Fish · ⛏️ Mine · 🧠 Trivia · 🔤 Wordle</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[
                        { key: "fishMinBet", label: "Fish Cost", min: 1 },
                        { key: "mineMinBet", label: "Mine Cost", min: 1 },
                        { key: "triviaStreakBonus", label: "Trivia Streak Bonus", min: 0, max: 10, step: 0.05 },
                        { key: "wordleStreakBonus", label: "Wordle Streak Bonus", min: 0, max: 10, step: 0.05 },
                      ].map(f => (
                        <div key={f.key}>
                          <label className="text-xs text-muted-foreground">{f.label}</label>
                          <Input type="number" className="mt-1 text-xs font-mono"
                            value={cfgValue(f.key as keyof EconomyConfig)}
                            min={f.min} max={f.max} step={f.step}
                            onChange={e => handleConfigChange(f.key as keyof EconomyConfig, e.target.value)} />
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-muted-foreground">Wordle</label>
                        <Button size="sm" variant={config.wordleEnabled === 0 ? "outline" : "default"}
                          className="text-xs"
                          onClick={() => handleConfigChange("wordleEnabled", config.wordleEnabled === 0 ? "1" : "0")}>
                          {config.wordleEnabled === 0 ? "Disabled" : "Enabled"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {tab === "shop" && (
        <>
          <Card className="border-border/40 bg-card/40">
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Add Shop Item</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <Input placeholder="Name" className="text-xs" value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))} />
                <Input placeholder="Description" className="text-xs" value={newItem.description} onChange={e => setNewItem(p => ({ ...p, description: e.target.value }))} />
                <Input type="number" placeholder="Price" className="text-xs font-mono" value={newItem.price} onChange={e => setNewItem(p => ({ ...p, price: parseInt(e.target.value) || 0 }))} />
                <Input type="number" placeholder="Stock (-1 = ∞)" className="text-xs font-mono" value={newItem.stock} onChange={e => setNewItem(p => ({ ...p, stock: parseStock(e.target.value) }))} />
                <Button size="sm" onClick={() => addItemMutation.mutate(newItem)} disabled={!newItem.name || newItem.price < 1}>
                  <Plus className="size-3.5 mr-1" /> Add
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/40">
            <CardContent className="p-0">
              {shopLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Loading shop...</div>
              ) : !shopData?.items?.length ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No shop items yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border/30">
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Description</TableHead>
                      <TableHead className="text-xs">Price</TableHead>
                      <TableHead className="text-xs">Role</TableHead>
                      <TableHead className="text-xs">Stock</TableHead>
                      <TableHead className="text-xs w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shopData.items.map(item => (
                      <TableRow key={item.id} className="border-b border-border/20">
                        <TableCell className="text-xs font-semibold">{item.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{item.description}</TableCell>
                        <TableCell className="text-xs font-mono">{item.price.toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{item.roleName ? <Badge variant="outline" className="text-[10px]">@{item.roleName}</Badge> : <span className="text-muted-foreground/40">—</span>}</TableCell>
                        <TableCell className="text-xs">{item.stock === -1 ? <span className="text-muted-foreground/40">∞</span> : item.stock}</TableCell>
                        <TableCell className="text-xs">
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => {
                              if (editingItem?.id === item.id) {
                                setEditingItem(null);
                                setEditDraft(null);
                              } else {
                                setEditingItem(item);
                                setEditDraft({ name: item.name, description: item.description, price: String(item.price), stock: String(item.stock) });
                              }
                            }}>
                              <Edit className="size-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                              if (!await confirm({
                                title: `Delete shop item "${item.name}"?`,
                                description: "This permanently removes the item from the shop. Cannot be undone.",
                                confirmLabel: "Delete",
                              })) return;
                              deleteItemMutation.mutate(item.id);
                            }}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {editingItem && editDraft && (
            <Card className="border-border/40 bg-card/40">
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Edit: {editingItem.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  <Input className="text-xs" placeholder="Name" value={editDraft.name} onChange={e => setEditDraft(d => d ? { ...d, name: e.target.value } : d)} />
                  <Input className="text-xs" placeholder="Description" value={editDraft.description} onChange={e => setEditDraft(d => d ? { ...d, description: e.target.value } : d)} />
                  <Input className="text-xs font-mono" type="number" placeholder="Price" value={editDraft.price} onChange={e => setEditDraft(d => d ? { ...d, price: e.target.value } : d)} />
                  <Input className="text-xs font-mono" type="number" placeholder="Stock (-1 = ∞)" value={editDraft.stock} onChange={e => setEditDraft(d => d ? { ...d, stock: e.target.value } : d)} />
                </div>
                <Button size="sm" onClick={() => {
                  const price = parseInt(editDraft.price);
                  const stock = parseStock(editDraft.stock);
                  if (!editDraft.name.trim() || Number.isNaN(price) || price < 1) { toast.error("Name and valid price required"); return; }
                  editItemMutation.mutate({ id: editingItem.id, body: { name: editDraft.name, description: editDraft.description, price, stock } });
                }}>
                  Save Changes
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {tab === "leaderboard" && (
        <Card className="border-border/40 bg-card/40">
          <CardContent className="p-0">
            {lbLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading leaderboard...</div>
            ) : !lbData?.leaderboard?.length ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No economy data yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border/30">
                    <TableHead className="text-xs w-10">#</TableHead>
                    <TableHead className="text-xs">User</TableHead>
                    <TableHead className="text-xs">ID</TableHead>
                    <TableHead className="text-xs text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lbData.leaderboard.map((row, i) => (
                    <TableRow key={row.user_id} className="border-b border-border/20">
                      <TableCell className="text-xs font-bold text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-xs">{row.displayName}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{row.user_id}</TableCell>
                      <TableCell className="text-xs font-mono text-right">{row.balance.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
