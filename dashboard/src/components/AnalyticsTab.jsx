import { useState, useEffect, useMemo, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, LineChart, Line, Cell, PieChart, Pie,
} from "recharts";
import { Zap, Database, CheckCircle, Clock, Cpu, TrendingUp, Calendar } from "lucide-react";
import { api } from "../api.js";

const COLORS = ["#6366f1", "#f59e0b", "#ec4899", "#10b981", "#3b82f6", "#8b5cf6", "#14b8a6", "#ef4444"];
const PERIODS = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

// ─── Summary stat card ─────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="stat-pill" style={{ "--accent-color": color, flexDirection: "column", alignItems: "flex-start", gap: 6, padding: "14px 16px", background: "var(--bg)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
        <Icon style={{ width: 18, height: 18, color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
      </div>
      <div style={{ fontWeight: 700, fontSize: 22, color: "var(--text)" }}>{value}</div>
      {sub !== undefined && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{sub}</div>}
    </div>
  );
}

// ─── Per-provider stats table ──────────────────────────────────────────────
function ProviderTable({ stats }) {
  if (!stats || stats.length === 0) return null;
  return (
    <div style={{ marginTop: 8, overflow: "auto" }}>
      <table className="mod-log-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th style={{ padding: "6px 8px" }}>Provider</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Calls</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Tokens</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Success</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Failed</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Avg Latency</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s, i) => (
            <tr key={s.provider} className="mod-log-row" style={{ animationDelay: `${i * 0.03}s` }}>
              <td style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                <span style={{ fontWeight: 500 }}>{s.provider}</span>
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{s.calls?.toLocaleString()}</td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>{s.tokens?.toLocaleString()}</td>
              <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--green)" }}>{s.successful}</td>
              <td style={{ padding: "6px 8px", textAlign: "right", color: s.failed > 0 ? "var(--red)" : "var(--text-muted)" }}>{s.failed}</td>
              <td style={{ padding: "6px 8px", textAlign: "right", color: "var(--text-muted)" }}>{s.avg_latency_ms}ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Analytics Tab ─────────────────────────────────────────────────────
export default function AnalyticsTab() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    let cancelled = false;
    try {
      const res = await api("GET", `/api/ai/analytics?days=${days}`);
      if (!cancelled) setData(res);
    } catch (e) {
      if (!cancelled) setError(e.message);
    } finally {
      if (!cancelled) setLoading(false);
    }
    return () => { cancelled = true; };
  }, [days]);

  useEffect(() => {
    const cleanup = fetchData();
    return () => { if (typeof cleanup === "function") cleanup(); };
  }, [fetchData]);

  // ── Computed data ──────────────────────────────────────────────────────────
  const { totalCalls, totalTokens, totalSuccess, successRate, avgLatency, providerData, pieData, dailyData, providers } = useMemo(() => {
    const stats = data?.stats || [];
    const daily = data?.daily || [];

    const totalCalls = stats.reduce((s, r) => s + (r.calls || 0), 0);
    const totalTokens = stats.reduce((s, r) => s + (r.tokens || 0), 0);
    const totalSuccess = stats.reduce((s, r) => s + (r.successful || 0), 0);
    const successRate = totalCalls > 0 ? Math.round((totalSuccess / totalCalls) * 100) : 0;
    const avgLatency = stats.length > 0
      ? Math.round(stats.reduce((s, r) => s + (r.avg_latency_ms || 0) * (r.calls || 0), 0) / totalCalls)
      : 0;

    // Bar chart data
    const providerData = stats.map((s, i) => ({ name: s.provider, calls: s.calls, tokens: s.tokens, fill: COLORS[i % COLORS.length] }));

    // Pie data
    const pieData = stats.map((s, i) => ({ name: s.provider, value: s.calls, fill: COLORS[i % COLORS.length] }));

    // Daily trend: group by day, then by provider
    const dayMap = new Map();
    for (const d of daily) {
      const date = new Date(d.day_epoch * 86400000).toISOString().slice(0, 10);
      if (!dayMap.has(date)) dayMap.set(date, {});
      dayMap.get(date)[d.provider] = d.calls;
    }
    const sortedDays = [...dayMap.keys()].sort();
    const providers = [...new Set(daily.map(d => d.provider))];
    const dailyData = sortedDays.map(date => {
      const row = { date: date.slice(5) }; // MM-DD
      for (const p of providers) row[p] = dayMap.get(date)?.[p] || 0;
      return row;
    });

    return { totalCalls, totalTokens, totalSuccess, successRate, avgLatency, providerData, pieData, dailyData, providers };
  }, [data]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="panel">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}><TrendingUp style={{ width: 20, height: 20 }} /> AI Analytics</h2>
        <div style={{ padding: 40, textAlign: "center" }}>
          <div className="spinner" />
          <div className="muted" style={{ marginTop: 12 }}>Loading analytics...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}><TrendingUp style={{ width: 20, height: 20 }} /> AI Analytics</h2>
        <div style={{ padding: 40, textAlign: "center", color: "var(--red)" }}>Failed to load: {error}</div>
      </div>
    );
  }

  const hasData = totalCalls > 0;

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <TrendingUp style={{ width: 20, height: 20 }} />
          AI Analytics
        </h2>
        <div style={{ display: "flex", gap: 4 }}>
          {PERIODS.map(p => (
            <button
              key={p.value}
              className={`btn ${days === p.value ? "primary" : ""}`}
              style={{ fontSize: 12, padding: "4px 10px" }}
              onClick={() => setDays(p.value)}
            >
              <Calendar style={{ width: 12, height: 12 }} />
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div style={{ padding: 60, textAlign: "center" }}>
          <Database style={{ width: 40, height: 40, color: "var(--text-muted)", opacity: 0.3, marginBottom: 12 }} />
          <div style={{ fontSize: 15, color: "var(--text-muted)" }}>No analytics data yet</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>AI analytics will appear here once the bot starts handling AI messages.</div>
        </div>
      ) : (
        <>
          {/* ── Stat cards ──────────────────────────────────────────────────── */}
          <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 20 }}>
            <StatCard icon={Zap} label="Total Calls" value={totalCalls.toLocaleString()} color="#6366f1" />
            <StatCard icon={Database} label="Total Tokens" value={totalTokens.toLocaleString()} color="#f59e0b" />
            <StatCard
              icon={CheckCircle}
              label="Success Rate"
              value={`${successRate}%`}
              sub={`${totalSuccess} succeeded`}
              color={successRate >= 90 ? "var(--green)" : successRate >= 70 ? "var(--orange)" : "var(--red)"}
            />
            <StatCard icon={Clock} label="Avg Latency" value={`${avgLatency}ms`} color="#8b5cf6" />
          </div>

          {/* ── Charts row 1: Calls + Tokens by provider ───────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: 16, marginBottom: 20 }}>
            {/* Calls by provider */}
            <div className="chart-card" style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 14 }}>
              <h3 style={{ fontSize: 13, margin: "0 0 10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                <Cpu style={{ width: 14, height: 14, verticalAlign: "middle", marginRight: 4 }} />
                Calls by Provider
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={providerData} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--bg-alt)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  <Bar dataKey="calls" name="Calls" radius={[4, 4, 0, 0]}>
                    {providerData.map((entry, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Tokens by provider */}
            <div className="chart-card" style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 14 }}>
              <h3 style={{ fontSize: 13, margin: "0 0 10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                <Database style={{ width: 14, height: 14, verticalAlign: "middle", marginRight: 4 }} />
                Token Usage by Provider
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={providerData} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
                  <Tooltip
                    contentStyle={{ background: "var(--bg-alt)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  <Bar dataKey="tokens" name="Tokens" radius={[4, 4, 0, 0]}>
                    {providerData.map((entry, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Charts row 2: Provider distribution pie + Daily trends line ─── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: 16, marginBottom: 20 }}>
            {/* Provider share pie */}
            {pieData.length > 0 && (
              <div className="chart-card" style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 14 }}>
                <h3 style={{ fontSize: 13, margin: "0 0 10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  <Cpu style={{ width: 14, height: 14, verticalAlign: "middle", marginRight: 4 }} />
                  Provider Call Share
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="var(--bg)" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "var(--bg-alt)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
                  {pieData.map((entry, i) => (
                    <div key={entry.name} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                      <span style={{ color: "var(--text-muted)" }}>{entry.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Daily trend lines */}
            {dailyData.length > 1 && (
              <div className="chart-card" style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 14 }}>
                <h3 style={{ fontSize: 13, margin: "0 0 10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  <TrendingUp style={{ width: 14, height: 14, verticalAlign: "middle", marginRight: 4 }} />
                  Daily Call Trends
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={dailyData} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "var(--bg-alt)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ fontWeight: 600 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {providers.map((p, i) => (
                      <Line key={p} type="monotone" dataKey={p} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* ── Provider detail table ────────────────────────────────────────── */}
          <ProviderTable stats={data?.stats || []} />

          {/* ── Top users ────────────────────────────────────────────────────── */}
          {data?.topUsers?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 13, margin: "0 0 8px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Top AI Users</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {data.topUsers.map((u) => (
                  <div
                    key={u.user_id}
                    className="stat-pill"
                    style={{
                      padding: "6px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 8,
                      background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}><code style={{ fontSize: 11 }}>{u.user_id}</code></span>
                    <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{u.calls} calls</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
