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
      <div className="embedprev-empty muted">
        <p>Build your embed using the form on the right.</p>
        <p className="embedprev-empty-text">Fill in fields and watch the preview update live.</p>
      </div>
    );
  }

  const color = embed.color != null ? embed.color : 0x5865F2;
  const hexColor = typeof color === "number"
    ? `#${color.toString(16).padStart(6, "0")}`
    : color;

  return (
    <div
      className="embedprev-card"
      style={{ borderLeft: `4px solid ${hexColor}` }}
    >
      {/* Author */}
      {embed.author?.name && (
        <div className="embedprev-author-row" style={{ marginBottom: embed.title ? 4 : 8 }}>
          {embed.author.icon_url && (
            <img src={embed.author.icon_url} alt="" className="embedprev-author-icon" />
          )}
          <span className="embedprev-author-name">
            {embed.author.url ? (
              <a href={embed.author.url} target="_blank" rel="noreferrer" className="embedprev-author-link">{embed.author.name}</a>
            ) : embed.author.name}
          </span>
        </div>
      )}

      {/* Title */}
      {embed.title && (
        <div className="embedprev-title">
          {embed.url ? (
            <a href={embed.url} target="_blank" rel="noreferrer" className="embedprev-title-link">{embed.title}</a>
          ) : embed.title}
        </div>
      )}

      {/* Description */}
      {embed.description && (
        <div className="embedprev-description" style={{ marginBottom: embed.fields?.length > 0 ? 12 : 8 }}>
          {embed.description}
        </div>
      )}

      {/* Fields */}
      {embed.fields && embed.fields.length > 0 && (
        <div className="embedprev-fields-grid">
          {embed.fields.map((f, i) => (
            <div
              key={f._key || i}
              style={{
                gridColumn: f.inline ? undefined : "span 2",
              }}
            >
              <div className="embedprev-field-name">{f.name}</div>
              <div className="embedprev-field-value">{f.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Image */}
      {embed.image?.url && (
        <img
          src={embed.image.url}
          alt=""
          className="embedprev-image"
        />
      )}

      {/* Thumbnail (shown at top-right in real Discord; simplified: below) */}
      {embed.thumbnail?.url && (
        <div className="embedprev-thumbnail">
          <img src={embed.thumbnail.url} alt="" className="embedprev-thumbnail-img" />
        </div>
      )}

      {/* Footer + Timestamp */}
      {(embed.footer?.text || embed.timestamp) && (
        <div className="embedprev-footer">
          {embed.footer?.icon_url && (
            <img src={embed.footer.icon_url} alt="" className="embedprev-footer-icon" />
          )}
          {embed.footer?.text && (
            <span className="embedprev-footer-text">{embed.footer.text}</span>
          )}
          {embed.footer?.text && embed.timestamp && <span className="embedprev-footer-sep">•</span>}
          {embed.timestamp && (
            <span className="embedprev-timestamp">
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
