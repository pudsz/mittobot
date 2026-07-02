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
    <div className="stat-pill analytics-stat-card">
      <div className="analytics-stat-head">
        <Icon className="analytics-stat-icon" style={{ color }} />
        <span className="analytics-stat-label">{label}</span>
      </div>
      <div className="analytics-stat-value">{value}</div>
      {sub !== undefined && <div className="analytics-stat-sub">{sub}</div>}
    </div>
  );
}

// ─── Per-provider stats table ──────────────────────────────────────────────
function ProviderTable({ stats }) {
  if (!stats || stats.length === 0) return null;
  return (
    <div className="analytics-table-wrap">
      <table className="mod-log-table analytics-provider-table">
        <thead>
          <tr className="analytics-provider-head">
            <th>Provider</th>
            <th className="align-right">Calls</th>
            <th className="align-right">Tokens</th>
            <th className="align-right">Success</th>
            <th className="align-right">Failed</th>
            <th className="align-right">Avg Latency</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s, i) => (
            <tr key={s.provider} className="mod-log-row" style={{ animationDelay: `${i * 0.03}s` }}>
              <td className="analytics-provider-cell analytics-provider-name-cell">
                <span className="analytics-provider-dot" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="analytics-provider-name">{s.provider}</span>
              </td>
              <td className="analytics-provider-cell align-right analytics-provider-strong">{s.calls?.toLocaleString()}</td>
              <td className="analytics-provider-cell align-right">{s.tokens?.toLocaleString()}</td>
              <td className="analytics-provider-cell align-right success-text">{s.successful}</td>
              <td className={`analytics-provider-cell align-right ${s.failed > 0 ? "danger-text" : "muted-text"}`}>{s.failed}</td>
              <td className="analytics-provider-cell align-right muted-text">{s.avg_latency_ms}ms</td>
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
        <h2 className="analytics-title"><TrendingUp className="analytics-title-icon" /> AI Analytics</h2>
        <div className="analytics-state-panel">
          <div className="spinner" />
          <div className="muted analytics-state-copy">Loading analytics...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <h2 className="analytics-title"><TrendingUp className="analytics-title-icon" /> AI Analytics</h2>
        <div className="analytics-state-panel danger-text">Failed to load: {error}</div>
      </div>
    );
  }

  const hasData = totalCalls > 0;

  return (
    <div className="panel">
      <div className="analytics-toolbar">
        <h2 className="analytics-title analytics-title-reset">
          <TrendingUp className="analytics-title-icon" />
          AI Analytics
        </h2>
        <div className="analytics-periods">
          {PERIODS.map(p => (
            <button
              key={p.value}
              className={`btn analytics-period-btn ${days === p.value ? "primary" : ""}`}
              onClick={() => setDays(p.value)}
            >
              <Calendar style={{ width: 12, height: 12 }} />
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="analytics-empty-state">
          <Database className="analytics-empty-icon" />
          <div className="analytics-empty-title">No analytics data yet</div>
          <div className="muted analytics-empty-copy">AI analytics will appear here once the bot starts handling AI messages.</div>
        </div>
      ) : (
        <>
          {/* ── Stat cards ──────────────────────────────────────────────────── */}
          <div className="stat-grid analytics-stat-grid">
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
          <div className="analytics-chart-grid">
            {/* Calls by provider */}
            <div className="chart-card analytics-chart-card">
              <h3 className="analytics-chart-title">
                <Cpu className="analytics-chart-title-icon" />
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
                      <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Tokens by provider */}
            <div className="chart-card analytics-chart-card">
              <h3 className="analytics-chart-title">
                <Database className="analytics-chart-title-icon" />
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
                      <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Charts row 2: Provider distribution pie + Daily trends line ─── */}
          <div className="analytics-chart-grid">
            {/* Provider share pie */}
            {pieData.length > 0 && (
              <div className="chart-card analytics-chart-card">
                <h3 className="analytics-chart-title">
                  <Cpu className="analytics-chart-title-icon" />
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
                        <Cell key={entry.name} fill={COLORS[i % COLORS.length]} stroke="var(--bg)" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "var(--bg-alt)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="analytics-legend-list">
                  {pieData.map((entry, i) => (
                    <div key={entry.name} className="analytics-legend-item">
                      <span className="analytics-provider-dot" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="muted-text">{entry.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Daily trend lines */}
            {dailyData.length > 1 && (
              <div className="chart-card analytics-chart-card">
                <h3 className="analytics-chart-title">
                  <TrendingUp className="analytics-chart-title-icon" />
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
            <div className="analytics-top-users">
              <h3 className="analytics-chart-title analytics-top-users-title">Top AI Users</h3>
              <div className="analytics-top-user-list">
                {data.topUsers.map((u) => (
                  <div key={u.user_id} className="stat-pill analytics-top-user-pill">
                    <span className="analytics-top-user-id"><code className="analytics-top-user-code">{u.user_id}</code></span>
                    <span className="analytics-top-user-meta">{u.calls} calls</span>
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
