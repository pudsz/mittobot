import { useEffect, useState } from "react";
import { ShieldPlus, Save, RotateCw } from "lucide-react";
import { api } from "../api.js";
import { useToast } from "./Toast.jsx";
import Toggle from "./Toggle.jsx";

const EX_ACTIONS = ["delete", "warn", "mute"];
const REACTION_ACTIONS = ["delete", "warn", "mute", "kick", "ban"];

function ExtendedAutomodSkeleton() {
  return (
    <div className="tab active">
      {[1, 2, 3, 4].map((i) => (
        <div className="panel" key={i}>
          <div className="skeleton skeleton-heading automod-skeleton-title" />
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text automod-skeleton-copy" />
        </div>
      ))}
    </div>
  );
}

export default function ExtendedAutomodTab({ guildId }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const qs = guildId ? `?guildId=${guildId}` : "";
      const { config: cfg } = await api("GET", `/api/automod/extended${qs}`);
      setConfig(cfg || {});
    } catch (e) {
      toast(e.message, true);
      setConfig({});
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [guildId]);

  function upd(patch) {
    setConfig((prev) => ({ ...(prev || {}), ...patch }));
  }

  function updList(key, value) {
    const list = value
      .split("\n")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    upd({ [key]: list });
  }

  function listToString(arr) {
    return Array.isArray(arr) ? arr.join("\n") : "";
  }

  async function save() {
    if (!config) return;
    try {
      const body = { ...config };
      // Ensure arrays are always saved as arrays
      if (typeof body.link_blacklist === "string") body.link_blacklist = body.link_blacklist.split("\n").filter(Boolean);
      if (typeof body.link_whitelist === "string") body.link_whitelist = body.link_whitelist.split("\n").filter(Boolean);
      await api("POST", "/api/automod/extended", { guildId, ...body });
      toast("Extended automod saved");
      await load();
    } catch (e) {
      toast(e.message, true);
    }
  }

  if (loading) return <ExtendedAutomodSkeleton />;
  if (!config) return <div className="tab active" />;

  return (
    <div className="tab active">
      <div className="panel">
        <h2><ShieldPlus /> Extended Automod Rules</h2>
        <p className="muted automod-panel-copy">
          Additional content-filtering rules beyond the standard automod. These rules run after the
          standard checks (invites, banned words, spam, etc.) and use the same action system.
        </p>
        <div className="panel-actions-row end">
          <button className="btn green" onClick={save}>
            <Save /> <span>Save All Settings</span>
          </button>
        </div>
      </div>

      {/* ── Link Filtering ── */}
      <div className="panel">
        <div className="panel-toggle-row">
          <h2 className="panel-inline-title">Link / Domain Filtering</h2>
          <Toggle checked={!!config.link_blacklist?.length} onChange={() => {}} />
        </div>
        <p className="muted automod-panel-copy">
          Block messages containing links to blacklisted domains. Whitelisted domains are always allowed.
        </p>

        <div className="grid-2">
          <div className="field">
            <label>Blacklisted domains (one per line)</label>
            <textarea
              className="automod-textarea-lg"
              placeholder={"spam-domain.com\nmalware-site.net\nphishing-link.org"}
              value={listToString(config.link_blacklist)}
              onChange={(e) => updList("link_blacklist", e.target.value)}
            />
            <div className="hint">Substring match — "spam" also matches "sub.spam.com".</div>
          </div>
          <div className="field">
            <label>Whitelisted domains (one per line)</label>
            <textarea
              className="automod-textarea-lg"
              placeholder={"youtube.com\ntwitter.com\ndiscord.com"}
              value={listToString(config.link_whitelist)}
              onChange={(e) => updList("link_whitelist", e.target.value)}
            />
            <div className="hint">Domains here bypass the blacklist.</div>
          </div>
        </div>

        <div className="field automod-field-gap">
          <label>Action for blacklisted links</label>
          <select
            value={config.link_action || "delete"}
            className="automod-select-sm"
            onChange={(e) => upd({ link_action: e.target.value })}
          >
            {EX_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {/* ── Repeated Text ── */}
      <div className="panel">
        <div className="panel-toggle-row">
          <h2 className="panel-inline-title">Repeated Text Detection</h2>
          <Toggle checked={!!config.repeated_text} onChange={(v) => upd({ repeated_text: v })} />
        </div>
        <p className="muted automod-panel-copy">
          Detect messages where the same line or word is repeated many times (common spam bot pattern).
        </p>

        {config.repeated_text && (
          <>
            <div className="field">
              <label>Repeated line threshold</label>
              <input
                type="number"
                min="2"
                max="20"
                value={config.repeated_text_count || 3}
                className="automod-input-sm"
                onChange={(e) => upd({ repeated_text_count: parseInt(e.target.value, 10) || 3 })}
              />
              <div className="hint">
                Number of times the same line must appear to trigger. Word repetition triggers at 3x this value.
              </div>
            </div>
            <div className="field">
              <label>Action</label>
              <select
                value={config.repeated_text_action || "delete"}
                className="automod-select-sm"
                onChange={(e) => upd({ repeated_text_action: e.target.value })}
              >
                {EX_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      {/* ── Emoji Spam ── */}
      <div className="panel">
        <div className="panel-toggle-row">
          <h2 className="panel-inline-title">Emoji Spam Detection</h2>
          <Toggle checked={!!config.emoji_spam} onChange={(v) => upd({ emoji_spam: v })} />
        </div>
        <p className="muted automod-panel-copy">
          Detect messages with excessive custom or unicode emoji usage.
        </p>

        {config.emoji_spam && (
          <>
            <div className="field">
              <label>Max emoji count</label>
              <input
                type="number"
                min="1"
                max="50"
                value={config.emoji_max || 5}
                className="automod-input-sm"
                onChange={(e) => upd({ emoji_max: parseInt(e.target.value, 10) || 5 })}
              />
              <div className="hint">Messages with more emoji than this threshold will be flagged.</div>
            </div>
            <div className="field">
              <label>Action</label>
              <select
                value={config.emoji_action || "delete"}
                className="automod-select-sm"
                onChange={(e) => upd({ emoji_action: e.target.value })}
              >
                {EX_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      {/* ── Blocked Message Emoji ── */}
      <div className="panel">
        <div className="panel-toggle-row">
          <h2 className="panel-inline-title">Blocked Message Emoji</h2>
          <Toggle checked={!!config.blocked_emojis_enabled} onChange={(v) => upd({ blocked_emojis_enabled: v })} />
        </div>
        <p className="muted automod-panel-copy">
          Act on messages containing specific unicode or custom emoji.
        </p>

        {config.blocked_emojis_enabled && (
          <>
            <div className="field">
              <label>Blocked emoji (one per line)</label>
              <textarea
                className="automod-textarea-md"
                placeholder={"😀\n<:bademoji:123456789012345678>\n123456789012345678"}
                value={listToString(config.blocked_emojis)}
                onChange={(e) => updList("blocked_emojis", e.target.value)}
              />
              <div className="hint">Paste unicode emoji, custom emoji, custom emoji name:id, or just the custom emoji ID.</div>
            </div>
            <div className="field">
              <label>Action</label>
              <select
                value={config.blocked_emojis_action || "delete"}
                className="automod-select-sm"
                onChange={(e) => upd({ blocked_emojis_action: e.target.value })}
              >
                {EX_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      {/* ── Blocked Reaction Emoji ── */}
      <div className="panel">
        <div className="panel-toggle-row">
          <h2 className="panel-inline-title">Blocked Reaction Emoji</h2>
          <Toggle checked={!!config.blocked_reaction_emojis_enabled} onChange={(v) => upd({ blocked_reaction_emojis_enabled: v })} />
        </div>
        <p className="muted automod-panel-copy">
          Remove specific reactions and optionally punish the user who reacted.
        </p>

        {config.blocked_reaction_emojis_enabled && (
          <>
            <div className="field">
              <label>Blocked reaction emoji (one per line)</label>
              <textarea
                className="automod-textarea-md"
                placeholder={"💀\n<:blocked:123456789012345678>\nblocked:123456789012345678"}
                value={listToString(config.blocked_reaction_emojis)}
                onChange={(e) => updList("blocked_reaction_emojis", e.target.value)}
              />
              <div className="hint">The delete action removes the reaction only. Stronger actions also remove the reaction first.</div>
            </div>
            <div className="field">
              <label>Action</label>
              <select
                value={config.blocked_reaction_action || "delete"}
                className="automod-select-sm"
                onChange={(e) => upd({ blocked_reaction_action: e.target.value })}
              >
                {REACTION_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      {/* ── Zalgo / Unicode Abuse ── */}
      <div className="panel">
        <div className="panel-toggle-row">
          <h2 className="panel-inline-title">Zalgo / Unicode Abuse</h2>
          <Toggle checked={!!config.zalgo_enabled} onChange={(v) => upd({ zalgo_enabled: v })} />
        </div>
        <p className="muted automod-panel-copy">
          Detect messages with excessive combining Unicode characters (zalgo text) that can distort message display.
        </p>

        {config.zalgo_enabled && (
          <div className="field">
            <label>Action</label>
            <select
              value={config.zalgo_action || "delete"}
              className="automod-select-sm"
              onChange={(e) => upd({ zalgo_action: e.target.value })}
            >
              {EX_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <div className="hint">
              Flags messages where more than 20% of characters are combining marks.
            </div>
          </div>
        )}
      </div>

      <div className="panel automod-save-panel">
        <button className="btn green" onClick={save}>
          <Save /> <span>Save All Settings</span>
        </button>
      </div>
    </div>
  );
}
