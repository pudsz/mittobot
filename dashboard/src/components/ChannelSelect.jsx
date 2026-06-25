/**
 * Reusable channel <select> dropdown.
 *
 * Props:
 *   value    – Currently selected channel ID (or "")
 *   onChange – (channelId: string) => void
 *   channels – Array of { id, name }
 *   noneLabel – Label for the "none" option (default "— none —")
 *   label    – Optional field label
 */
export default function ChannelSelect({ value, onChange, channels, noneLabel = "— none —", label }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{noneLabel}</option>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            #{c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
