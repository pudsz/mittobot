/**
 * Renders a Discord-style embed preview — mimics how the embed will look in Discord.
 *
 * Props:
 *   embed – An object with Discord embed fields:
 *     { title, description, url, color, timestamp, author: { name, icon_url, url },
 *       footer: { text, icon_url }, thumbnail: { url }, image: { url },
 *       fields: [{ name, value, inline }] }
 */
export default function EmbedPreview({ embed }) {
  if (!embed || Object.keys(embed).length === 0) {
    return (
      <div className="muted" style={{ padding: 32, textAlign: "center", border: "2px dashed var(--border)", borderRadius: "var(--radius-md)" }}>
        <p>Build your embed using the form on the right.</p>
        <p style={{ fontSize: 12 }}>Fill in fields and watch the preview update live.</p>
      </div>
    );
  }

  const color = embed.color != null ? embed.color : 0x5865F2;
  const hexColor = typeof color === "number"
    ? `#${color.toString(16).padStart(6, "0")}`
    : color;

  return (
    <div
      style={{
        maxWidth: 432,
        background: "#2B2D31",
        borderRadius: 4,
        borderLeft: `4px solid ${hexColor}`,
        padding: "8px 12px 12px 16px",
        fontFamily: "\"gg sans\", \"Noto Sans\", Helvetica, Arial, sans-serif",
        fontSize: 14,
        lineHeight: 1.375,
      }}
    >
      {/* Author */}
      {embed.author?.name && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: embed.title ? 4 : 8 }}>
          {embed.author.icon_url && (
            <img src={embed.author.icon_url} alt="" style={{ width: 24, height: 24, borderRadius: "50%" }} />
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
            {embed.author.url ? (
              <a href={embed.author.url} target="_blank" rel="noreferrer" style={{ color: "#fff", textDecoration: "none" }}>{embed.author.name}</a>
            ) : embed.author.name}
          </span>
        </div>
      )}

      {/* Title */}
      {embed.title && (
        <div style={{ fontWeight: 600, fontSize: 16, color: "#fff", marginBottom: 4 }}>
          {embed.url ? (
            <a href={embed.url} target="_blank" rel="noreferrer" style={{ color: "#00AFF4", textDecoration: "none" }}>{embed.title}</a>
          ) : embed.title}
        </div>
      )}

      {/* Description */}
      {embed.description && (
        <div style={{ color: "#DBDEE1", fontSize: 14, marginBottom: embed.fields?.length > 0 ? 12 : 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {embed.description}
        </div>
      )}

      {/* Fields */}
      {embed.fields && embed.fields.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px 16px",
          marginBottom: 8,
        }}>
          {embed.fields.map((f, i) => (
            <div
              key={f._key || i}
              style={{
                gridColumn: f.inline ? undefined : "span 2",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, color: "#fff", marginBottom: 2 }}>{f.name}</div>
              <div style={{ color: "#DBDEE1", fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{f.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Image */}
      {embed.image?.url && (
        <img
          src={embed.image.url}
          alt=""
          style={{ width: "100%", borderRadius: 4, marginTop: 4, marginBottom: 4, display: "block" }}
        />
      )}

      {/* Thumbnail (shown at top-right in real Discord; simplified: below) */}
      {embed.thumbnail?.url && (
        <div style={{ marginTop: 8, marginBottom: 4 }}>
          <img src={embed.thumbnail.url} alt="" style={{ maxWidth: 80, maxHeight: 80, borderRadius: 4 }} />
        </div>
      )}

      {/* Footer + Timestamp */}
      {(embed.footer?.text || embed.timestamp) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          {embed.footer?.icon_url && (
            <img src={embed.footer.icon_url} alt="" style={{ width: 20, height: 20, borderRadius: "50%" }} />
          )}
          {embed.footer?.text && (
            <span style={{ fontSize: 12, color: "#949BA4", fontWeight: 500 }}>{embed.footer.text}</span>
          )}
          {embed.footer?.text && embed.timestamp && <span style={{ color: "#4E5058", fontSize: 12 }}>•</span>}
          {embed.timestamp && (
            <span style={{ fontSize: 12, color: "#949BA4" }}>
              {(embed.timestamp !== true && !isNaN(new Date(embed.timestamp).getTime())
                ? new Date(embed.timestamp)
                : new Date()
              ).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
