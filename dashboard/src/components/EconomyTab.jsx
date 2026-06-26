import { useState, useEffect } from "react";
import { api } from "../api.js";
import useGuildData from "../hooks/useGuildData.js";
import { useToast } from "./Toast.jsx";

function formatCoins(n) {
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
  const { data, loading, error } = useGuildData(guildId, "/api/economy/leaderboard");
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    if (data?.leaderboard) setLeaderboard(data.leaderboard);
  }, [data]);

  if (loading) return <div className="muted">Loading...</div>;
  if (error) return <div className="muted" style={{ color: "var(--red)" }}>{error}</div>;

  return (
    <div>
      <h2>💰 Economy</h2>
      <p className="muted">
        View the richest members in this server. Use <code>/balance</code>,{" "}
        <code>/daily</code>, <code>/work</code>, <code>/pay</code>,{" "}
        <code>/gamble</code>, <code>/rob</code>, and <code>/leaderboard</code> in Discord.
      </p>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>🏆 Leaderboard</h3>
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

      <div className="card" style={{ marginTop: 16 }}>
        <h3>📋 Available Commands</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
          {[
            ["/balance [user]", "Check your or someone's wallet"],
            ["/daily", "Claim 200 coins every 24h"],
            ["/work", "Work for 50–300 coins (1h cooldown)"],
            ["/pay @user amount", "Transfer coins to another member"],
            ["/leaderboard", "View the richest members"],
            ["/gamble amount", "45% chance to double your bet"],
            ["/rob @user", "35% chance to steal from someone"],
          ].map(([cmd, desc]) => (
            <div key={cmd}>
              <code>{cmd}</code>
              <p className="muted" style={{ marginTop: 2, fontSize: 12 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
