import { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import useGuildData from "../hooks/useGuildData.js";
import { useToast } from "./Toast.jsx";
import DropdownSelect from "./DropdownSelect.jsx";

function formatCoins(n) {
  if (n == null) return "0";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function medal(idx) {
  if (idx === 0) return "🥇";
  if (idx === 1) return "🥈";
  if (idx === 2) return "🥉";
  return `${idx + 1}.`;
}

export default function EconomyTab({ guildId }) {
  const toast = useToast();

  // ─── Data fetching ──────────────────────────────────────────────────
  const lbQuery = useGuildData(guildId, "/api/economy/leaderboard");
  const [leaderboard, setLeaderboard] = useState([]);

  const [config, setConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Shop state
  const [shopItems, setShopItems] = useState([]);
  const [shopLoading, setShopLoading] = useState(true);
  const [roles, setRoles] = useState([]);
  const [editingShop, setEditingShop] = useState(null); // null | item | { isNew: true }
  const [shopForm, setShopForm] = useState({ name: "", description: "", price: 50, roleId: "", stock: -1 });
  const [shopSaving, setShopSaving] = useState(false);

  // Config form state
  const [configForm, setConfigForm] = useState(null);
  const [configSaving, setConfigSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    if (!guildId) return;
    try {
      setConfigLoading(true);
      const data = await api("GET", `/api/economy/config?guildId=${guildId}`);
      setConfig(data.config);
      setConfigForm(data.config);
    } catch { /* ignore */ }
    finally { setConfigLoading(false); }
  }, [guildId]);

  const loadStats = useCallback(async () => {
    if (!guildId) return;
    try {
      setStatsLoading(true);
      const data = await api("GET", `/api/economy/stats?guildId=${guildId}`);
      setStats(data.stats);
    } catch { /* ignore */ }
    finally { setStatsLoading(false); }
  }, [guildId]);

  const loadShop = useCallback(async () => {
    if (!guildId) return;
    try {
      setShopLoading(true);
      const data = await api("GET", `/api/economy/shop?guildId=${guildId}`);
      setShopItems(data.items || []);
      if (data.roles) setRoles(data.roles);
    } catch { /* ignore */ }
    finally { setShopLoading(false); }
  }, [guildId]);

  useEffect(() => {
    if (lbQuery.data?.leaderboard) setLeaderboard(lbQuery.data.leaderboard);
  }, [lbQuery.data]);

  useEffect(() => {
    loadConfig();
    loadStats();
    loadShop();
  }, [loadConfig, loadStats, loadShop]);

  // ─── Save config ────────────────────────────────────────────────────
  async function saveConfig(e) {
    e.preventDefault();
    if (!configForm) return;
    setConfigSaving(true);
    try {
      const body = {};
      if (configForm.dailyAmount !== config?.dailyAmount) body.dailyAmount = configForm.dailyAmount;
      if (configForm.workMin !== config?.workMin) body.workMin = configForm.workMin;
      if (configForm.workMax !== config?.workMax) body.workMax = configForm.workMax;
      if (configForm.interestRate !== config?.interestRate) body.interestRate = configForm.interestRate;
      if (configForm.taxRate !== config?.taxRate) body.taxRate = configForm.taxRate;
      if (configForm.gambleOdds !== config?.gambleOdds) body.gambleOdds = configForm.gambleOdds;
      if (Object.keys(body).length === 0) { toast("No changes to save"); return; }
      const data = await api("POST", `/api/economy/config?guildId=${guildId}`, body);
      setConfig(data.config);
      setConfigForm(data.config);
      toast("Economy config saved");
    } catch (e) {
      toast(e.message, true);
    } finally {
      setConfigSaving(false);
    }
  }

  // ─── Save/delete shop item ──────────────────────────────────────────
  async function saveShopItem(e) {
    e.preventDefault();
    if (!shopForm.name || !shopForm.price || shopForm.price < 1) {
      toast("Name and price (≥ 1) are required", true);
      return;
    }
    setShopSaving(true);
    try {
      if (editingShop?.isNew) {
        await api("POST", `/api/economy/shop?guildId=${guildId}`, {
          name: shopForm.name,
          description: shopForm.description,
          price: shopForm.price,
          roleId: shopForm.roleId || null,
          stock: shopForm.stock,
        });
        toast("Item added");
      } else {
        await api("PATCH", `/api/economy/shop/${editingShop.id}`, {
          name: shopForm.name,
          description: shopForm.description,
          price: shopForm.price,
          roleId: shopForm.roleId || null,
          stock: shopForm.stock,
        });
        toast("Item updated");
      }
      setEditingShop(null);
      setShopForm({ name: "", description: "", price: 50, roleId: "", stock: -1 });
      await loadShop();
    } catch (e) {
      toast(e.message, true);
    } finally {
      setShopSaving(false);
    }
  }

  async function deleteShopItem(item) {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    try {
      await api("DELETE", `/api/economy/shop/${item.id}`);
      toast(`Deleted "${item.name}"`);
      await loadShop();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function resetEconomy() {
    if (!confirm("Reset ALL economy data for this server? This will wipe every user's balance, shop items, and config. This cannot be undone!")) return;
    try {
      await api("POST", `/api/economy/reset?guildId=${guildId}`);
      toast("Economy reset complete");
      setLeaderboard([]);
      setConfig(null);
      setConfigForm(null);
      setStats(null);
      setShopItems([]);
      // Reload fresh
      loadConfig();
      loadStats();
      loadShop();
    } catch (e) {
      toast(e.message, true);
    }
  }

  function openNewShopItem() {
    setEditingShop({ isNew: true });
    setShopForm({ name: "", description: "", price: 50, roleId: "", stock: -1 });
  }

  function openEditShopItem(item) {
    setEditingShop(item);
    setShopForm({
      name: item.name,
      description: item.description || "",
      price: item.price,
      roleId: item.roleId || "",
      stock: item.stock ?? -1,
    });
  }

  const loading = lbQuery.loading || configLoading || statsLoading;
  const error = lbQuery.error;

  if (!guildId) {
    return <div className="muted" style={{ padding: 24, textAlign: "center" }}>Select a guild to manage its economy.</div>;
  }

  if (loading && !leaderboard.length) {
    return (
      <div>
        <div className="skeleton skeleton-heading" />
        <div className="skeleton skeleton-text" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
    );
  }

  return (
    <div>
      <h2>💰 Economy</h2>
      <p className="muted">
        Manage payouts, shop items, interest rates, and view the leaderboard.
      </p>

      {/* ─── Stats Cards ──────────────────────────────────────────────── */}
      {stats && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <div className="stat">
            <span className="lbl">Total Users</span>
            <span className="num">{stats.users || 0}</span>
          </div>
          <div className="stat">
            <span className="lbl">Total Coins</span>
            <span className="num">{formatCoins(stats.total_coins)}</span>
          </div>
          <div className="stat">
            <span className="lbl">In Wallets</span>
            <span className="num">{formatCoins(stats.total_wallet)}</span>
          </div>
          <div className="stat">
            <span className="lbl">In Banks</span>
            <span className="num">{formatCoins(stats.total_bank)}</span>
          </div>
          {stats.richestName && (
            <div className="stat">
              <span className="lbl">Richest</span>
              <span className="num" style={{ fontSize: 14 }}>{stats.richestName}</span>
            </div>
          )}
        </div>
      )}

      {/* ─── Payout Config ────────────────────────────────────────────── */}
      <div className="panel">
        <h2>⚙️ Payouts & Rates</h2>
        {error && <div className="muted" style={{ color: "var(--red)", marginBottom: 12 }}>{error}</div>}
        {configForm && (
          <form onSubmit={saveConfig}>
            <div className="grid-2">
              <div className="field">
                <label>Daily Reward (coins)</label>
                <input
                  type="number" min="1" max="100000"
                  value={configForm.dailyAmount}
                  onChange={(e) => setConfigForm({ ...configForm, dailyAmount: parseInt(e.target.value, 10) || 200 })}
                />
                <div className="hint">Coins given per /daily claim</div>
              </div>
              <div className="field">
                <label>Work Min (coins)</label>
                <input
                  type="number" min="1" max="100000"
                  value={configForm.workMin}
                  onChange={(e) => setConfigForm({ ...configForm, workMin: parseInt(e.target.value, 10) || 50 })}
                />
                <div className="hint">Minimum coins from /work</div>
              </div>
              <div className="field">
                <label>Work Max (coins)</label>
                <input
                  type="number" min={configForm.workMin} max="100000"
                  value={configForm.workMax}
                  onChange={(e) => setConfigForm({ ...configForm, workMax: parseInt(e.target.value, 10) || 300 })}
                />
                <div className="hint">Maximum coins from /work</div>
              </div>
              <div className="field">
                <label>Bank Interest Rate (%)</label>
                <input
                  type="number" min="0" max="100" step="0.1"
                  value={configForm.interestRate}
                  onChange={(e) => setConfigForm({ ...configForm, interestRate: parseFloat(e.target.value) || 0 })}
                />
                <div className="hint">% earned on bank deposits per day</div>
              </div>
              <div className="field">
                <label>Transfer Tax (%)</label>
                <input
                  type="number" min="0" max="100" step="0.1"
                  value={configForm.taxRate}
                  onChange={(e) => setConfigForm({ ...configForm, taxRate: parseFloat(e.target.value) || 0 })}
                />
                <div className="hint">% taken from /pay transfers</div>
              </div>
              <div className="field">
                <label>Gamble Win Chance (%)</label>
                <input
                  type="number" min="0" max="100" step="0.1"
                  value={((configForm.gambleOdds ?? 0.45) * 100).toFixed(1)}
                  onChange={(e) => setConfigForm({ ...configForm, gambleOdds: (parseFloat(e.target.value) || 45) / 100 })}
                />
                <div className="hint">Probability of winning /gamble</div>
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" type="submit" disabled={configSaving}>
                {configSaving ? "Saving..." : "Save Config"}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ─── Shop Editor ──────────────────────────────────────────────── */}
      <div className="panel">
        <h2>🛒 Item Shop</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Create items users can buy with <code>/buy</code>. Optionally link a role reward.
        </p>

        {shopLoading ? (
          <div className="skeleton skeleton-card" style={{ height: 60 }} />
        ) : shopItems.length === 0 ? (
          <div className="muted" style={{ marginBottom: 12 }}>No shop items yet. Add one below.</div>
        ) : (
          <table style={{ marginBottom: 12 }}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Price</th>
                <th>Role</th>
                <th>Stock</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {shopItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    {item.description && <div className="muted" style={{ fontSize: 11 }}>{item.description}</div>}
                  </td>
                  <td>🪙 {formatCoins(item.price)}</td>
                  <td>{item.roleName ? <span className="badge info">{item.roleName}</span> : <span className="muted">—</span>}</td>
                  <td>{item.stock === -1 ? <span className="muted">∞</span> : item.stock}</td>
                  <td>
                    <div className="row gap-4">
                      <button className="btn secondary text-sm" onClick={() => openEditShopItem(item)} style={{ padding: "4px 8px" }}>Edit</button>
                      <button className="btn danger text-sm" onClick={() => deleteShopItem(item)} style={{ padding: "4px 8px" }}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {editingShop ? (
          <form onSubmit={saveShopItem} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 14 }}>
            <h3 style={{ marginTop: 0 }}>{editingShop.isNew ? "Add Item" : `Edit "${editingShop.name}"`}</h3>
            <div className="grid-2">
              <div className="field">
                <label>Name</label>
                <input value={shopForm.name} onChange={(e) => setShopForm({ ...shopForm, name: e.target.value })} placeholder="e.g. VIP Role" maxLength={100} autoFocus />
              </div>
              <div className="field">
                <label>Price (coins)</label>
                <input type="number" min="1" value={shopForm.price} onChange={(e) => setShopForm({ ...shopForm, price: parseInt(e.target.value, 10) || 50 })} />
              </div>
              <div className="field">
                <label>Description</label>
                <input value={shopForm.description} onChange={(e) => setShopForm({ ...shopForm, description: e.target.value })} placeholder="Optional flavor text" maxLength={500} />
              </div>
              <div className="field">
                <label>Role Reward</label>
                <DropdownSelect
                  items={roles}
                  selected={shopForm.roleId ? new Set([shopForm.roleId]) : new Set()}
                  onToggle={(roleId) => setShopForm({ ...shopForm, roleId: shopForm.roleId === roleId ? "" : roleId })}
                  prefix="@"
                  placeholder="No role reward"
                />
              </div>
              <div className="field">
                <label>Stock (-1 = unlimited)</label>
                <input type="number" min="-1" value={shopForm.stock} onChange={(e) => setShopForm({ ...shopForm, stock: parseInt(e.target.value, 10) ?? -1 })} />
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" type="submit" disabled={shopSaving}>
                {shopSaving ? "Saving..." : editingShop.isNew ? "Add Item" : "Update Item"}
              </button>
              <button className="btn" type="button" onClick={() => { setEditingShop(null); setShopForm({ name: "", description: "", price: 50, roleId: "", stock: -1 }); }}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className="btn secondary" onClick={openNewShopItem}>+ Add Shop Item</button>
        )}
      </div>

      {/* ─── Leaderboard ──────────────────────────────────────────────── */}
      <div className="panel">
        <h2>🏆 Leaderboard</h2>
        {leaderboard.length === 0 ? (
          <p className="muted">No one has earned any coins yet. Be the first!</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "8px 12px", width: 40 }}>#</th>
                <th style={{ padding: "8px 12px" }}>Member</th>
                <th style={{ padding: "8px 12px", textAlign: "right", width: 90 }}>Wallet</th>
                <th style={{ padding: "8px 12px", textAlign: "right", width: 90 }}>Bank</th>
                <th style={{ padding: "8px 12px", textAlign: "right", width: 90 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, i) => (
                <tr key={row.user_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px", fontSize: 16 }}>{medal(i)}</td>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{row.displayName || row.user_id}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatCoins(row.balance)}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatCoins(row.bank)}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatCoins(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── Commands Reference ───────────────────────────────────────── */}
      <div className="panel">
        <h2>📋 Available Commands</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
          {[
            ["/balance [user]", "Check your or someone's wallet"],
            ["/daily", `Claim ${configForm?.dailyAmount ?? 200} coins every 24h`],
            ["/work", `Work for ${configForm?.workMin ?? 50}–${configForm?.workMax ?? 300} coins (1h cooldown)`],
            ["/pay @user amount", "Transfer coins to another member"],
            ["/leaderboard", "View the richest members"],
            ["/gamble amount", `${Math.round((configForm?.gambleOdds ?? 0.45) * 100)}% chance to double your bet`],
            ["/rob @user", "35% chance to steal from someone"],
          ].map(([cmd, desc]) => (
            <div key={cmd}>
              <code>{cmd}</code>
              <p className="muted" style={{ marginTop: 2, fontSize: 12 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Danger Zone ──────────────────────────────────────────────── */}
      <div className="panel" style={{ borderColor: "var(--red)", background: "var(--red-subtle)" }}>
        <h2 style={{ color: "var(--red)" }}>⚠ Reset Economy</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          This will permanently delete all balances, shop items, and config for this server. This action cannot be undone.
        </p>
        <button className="btn danger" onClick={resetEconomy}>Reset Entire Economy</button>
      </div>
    </div>
  );
}
