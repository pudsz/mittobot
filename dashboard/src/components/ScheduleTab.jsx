import { useState, useCallback } from "react";
import { Clock, Plus, Trash2, Calendar } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Panel from "./Panel.jsx";
import ChannelSelect from "./ChannelSelect.jsx";
import useGuildData from "../hooks/useGuildData.js";

const RECURRENCE_LABELS = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function channelName(channelId, channels) {
  const c = channels?.find(ch => ch.id === channelId);
  return c ? `#${c.name}` : channelId;
}

export default function ScheduleTab({ guildId }) {
  const toast = useToast();
  const { data, loading, refetch } = useGuildData(guildId, "/api/schedule");
  const schedules = data?.schedules || [];
  const channels = data?.channels || [];
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState("once"); // "once" or "recurring"

  // Form state
  const [channelId, setChannelId] = useState("");
  const [content, setContent] = useState("");
  const [datetime, setDatetime] = useState("");
  const [recurrence, setRecurrence] = useState("daily");
  const [time, setTime] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("mon");
  const [dayOfMonth, setDayOfMonth] = useState("1");

  function resetForm() {
    setShowForm(false);
    setMode("once");
    setChannelId("");
    setContent("");
    setDatetime("");
    setRecurrence("daily");
    setTime("");
    setDayOfWeek("mon");
    setDayOfMonth("1");
  }

  async function handleCreate() {
    if (!channelId || !content.trim()) return toast("Channel and message are required", true);

    let scheduledAt;

    if (mode === "once") {
      const d = new Date(datetime);
      if (isNaN(d.getTime()) || d <= new Date()) return toast("Enter a valid future date/time", true);
      scheduledAt = d.toISOString();
    } else {
      if (!time) return toast("Time (HH:MM) is required", true);
      const [h, m] = time.split(":").map(Number);
      if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return toast("Invalid time format (HH:MM 24-hour)", true);

      const next = new Date();
      next.setHours(h, m, 0, 0);
      if (next <= new Date()) next.setDate(next.getDate() + 1);

      if (recurrence === "weekly") {
        const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
        const target = days.indexOf(dayOfWeek);
        const diff = target - next.getDay();
        next.setDate(next.getDate() + (diff <= 0 ? diff + 7 : diff));
      } else if (recurrence === "monthly") {
        const dom = parseInt(dayOfMonth, 10);
        next.setDate(dom);
        if (next <= new Date()) {
          next.setMonth(next.getMonth() + 1);
          if (next.getDate() !== dom) next.setDate(0);
        }
      }

      scheduledAt = next.toISOString();
    }

    try {
      await api("POST", "/api/schedule", {
        guildId,
        channelId,
        content: content.trim().slice(0, 2000),
        scheduledAt,
        recurrence: mode === "recurring" ? recurrence : null,
      });
      toast("Schedule created");
      resetForm();
      refetch();
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this schedule?")) return;
    try {
      await api("DELETE", `/api/schedule/${id}${guildId ? `?guildId=${guildId}` : ""}`);
      toast("Schedule deleted");
      refetch();
    } catch (e) {
      toast(e.message, true);
    }
  }

  if (loading) {
    return (
      <div className="tab active">
        <Panel><div className="skeleton skeleton-heading" /><div className="skeleton skeleton-text" style={{ width: "70%" }} /></Panel>
        {[1, 2].map(i => <Panel key={i}><div className="skeleton skeleton-heading" style={{ width: "40%" }} /><div className="skeleton skeleton-text" /><div className="skeleton" style={{ height: 60, borderRadius: "var(--radius-sm)" }} /></Panel>)}
      </div>
    );
  }

  return (
    <div className="tab active">
      <Panel icon={Clock} title="Scheduled Messages">
        <p className="muted" style={{ marginBottom: 14 }}>
          Schedule messages to be sent automatically at a specific date/time, or on a recurring schedule (daily, weekly, monthly).
          Messages are sent to the configured channel when the schedule fires.
        </p>
        <button className="btn green" onClick={() => setShowForm(true)}><Plus /> New Schedule</button>
      </Panel>

      {showForm && (
        <Panel>
          <h2>New Schedule</h2>

          <div className="field">
            <label>Schedule Type</label>
            <div className="row" style={{ gap: 8 }}>
              <button className={`btn ${mode === "once" ? "accent" : "secondary"}`} onClick={() => setMode("once")}>One-Time</button>
              <button className={`btn ${mode === "recurring" ? "accent" : "secondary"}`} onClick={() => setMode("recurring")}>Recurring</button>
            </div>
          </div>

          <ChannelSelect
            label="Channel"
            value={channelId}
            onChange={setChannelId}
            channels={channels}
            noneLabel="— select channel —"
          />

          {mode === "once" ? (
            <div className="field">
              <label>Date & Time</label>
              <input
                type="datetime-local"
                value={datetime}
                onChange={e => setDatetime(e.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="field">
                <label>Recurrence</label>
                <select value={recurrence} onChange={e => setRecurrence(e.target.value)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="field">
                <label>Time (24-hour)</label>
                <input
                  type="time"
                  value={time}
                  onChange={e => setTime(e.target.value)}
                />
              </div>
              {recurrence === "weekly" && (
                <div className="field">
                  <label>Day of Week</label>
                  <select value={dayOfWeek} onChange={e => setDayOfWeek(e.target.value)}>
                    {["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map(d => (
                      <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                    ))}
                  </select>
                </div>
              )}
              {recurrence === "monthly" && (
                <div className="field">
                  <label>Day of Month (1-31)</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={dayOfMonth}
                    onChange={e => setDayOfMonth(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          <div className="field">
            <label>Message</label>
            <textarea
              style={{ minHeight: 80 }}
              placeholder="Message content to send..."
              value={content}
              onChange={e => setContent(e.target.value)}
              maxLength={2000}
            />
            <div className="hint">{content.length}/2000 characters</div>
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn green" onClick={handleCreate}><Plus /> Create</button>
            <button className="btn secondary" onClick={resetForm}>Cancel</button>
          </div>
        </Panel>
      )}

      {!schedules.length && !showForm ? (
        <Panel><div className="muted" style={{ textAlign: "center", padding: 20 }}>No scheduled messages yet. Click "New Schedule" to create one.</div></Panel>
      ) : (
        schedules.map(s => (
          <Panel compact key={s.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Calendar size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
              <span className="badge info" style={{ flexShrink: 0 }}>#{s.id}</span>
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1, minWidth: 200 }}>
                {s.content.slice(0, 80)}{s.content.length > 80 ? "…" : ""}
              </span>
              <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>
                {s.recurrence ? `${RECURRENCE_LABELS[s.recurrence] || s.recurrence} · ` : ""}
                {formatTime(s.scheduledAt)}
              </span>
              <span className="muted" style={{ fontSize: 11, flexShrink: 0 }}>
                {channelName(s.channelId, channels)}
              </span>
              <button className="btn danger" onClick={() => handleDelete(s.id)} style={{ padding: "4px 8px", flexShrink: 0 }}>
                <Trash2 size={14} />
              </button>
            </div>
          </Panel>
        ))
      )}
    </div>
  );
}
