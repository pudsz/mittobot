// ─── Image processing for AI vision support ─────────────────────────────────
// Discord attachments are downloaded, validated, and converted to base64 data
// URIs so they can be injected into provider-specific vision formats.

const MAX_IMAGE_SIZE  = 8 * 1024 * 1024; // 8 MB per image
const MAX_IMAGES      = 4;               // max images per message
const FETCH_TIMEOUT   = 20_000;          // 20s per download

const SUPPORTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

// ─── Extract supported image attachments from a Discord message ────────────
function getImageAttachments(message) {
  if (!message.attachments || message.attachments.size === 0) return [];

  const images = [];
  for (const [, att] of message.attachments) {
    if (images.length >= MAX_IMAGES) break;
    if (!att.contentType || !SUPPORTED_TYPES.has(att.contentType)) continue;
    if (att.size > MAX_IMAGE_SIZE) continue;
    images.push({
      url: att.url,
      contentType: att.contentType,
      size: att.size,
      name: att.name || "image",
    });
  }
  return images;
}

// ─── Download a single image and return base64 data + media type ──────────
async function downloadImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  } finally {
    clearTimeout(timer);
  }
}

// ─── Download all images from extracted attachments ────────────────────────
// Returns an array of { data, mediaType } objects.
async function processMessageImages(message) {
  const attachments = getImageAttachments(message);
  if (attachments.length === 0) return [];

  const results = [];
  for (const att of attachments) {
    try {
      const data = await downloadImage(att.url);
      results.push({ data, mediaType: att.contentType });
    } catch (err) {
      console.warn(`[vision] Failed to download ${att.name} (${att.url}): ${err.message}`);
    }
  }
  return results;
}

// ─── Build OpenAI-format content parts from text + images ──────────────────
// Returns either a plain string (no images) or an array of content parts.
function buildContentParts(text, images) {
  if (!images || images.length === 0) return text;

  const parts = [];
  // Main text first
  parts.push({ type: "text", text: text || "" });
  // Then each image as an image_url part
  for (const img of images) {
    parts.push({
      type: "image_url",
      image_url: { url: `data:${img.mediaType};base64,${img.data}` },
    });
  }
  return parts;
}

// ─── Parse a data: URI into { mediaType, data } ──────────────────────────
function parseDataUri(dataUri) {
  if (typeof dataUri !== "string") return null;
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

// ─── Convert an OpenAI-format content array to Claude/Anthropic format ────
// Input parts: [{type:"text",text:"..."}, {type:"image_url",image_url:{url:"data:..."}}]
// Output parts: [{type:"text",text:"..."}, {type:"image",source:{type:"base64",media_type:"...",data:"..."}}]
function contentToAnthropicBlocks(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content;
  return content.map(part => {
    if (part.type === "image_url") {
      const parsed = parseDataUri(part.image_url?.url);
      if (!parsed) return part;
      // Claude uses "media_type" (snake_case, singular) instead of "contentType"
      return {
        type: "image",
        source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
      };
    }
    return part;
  });
}

// ─── Convert an OpenAI-format content array to Gemini format parts ────────
// Input parts: [{type:"text",text:"..."}, {type:"image_url",image_url:{url:"data:..."}}]
// Output parts: [{text:"..."}, {inlineData:{mimeType:"...",data:"..."}}]
function contentToGeminiParts(content) {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [{ text: "" }];
  return content.map(part => {
    if (part.type === "image_url") {
      const parsed = parseDataUri(part.image_url?.url);
      if (!parsed) return { text: "" };
      return { inlineData: { mimeType: parsed.mediaType, data: parsed.data } };
    }
    return { text: part.text || "" };
  });
}

module.exports = {
  getImageAttachments,
  downloadImage,
  processMessageImages,
  buildContentParts,
  parseDataUri,
  contentToAnthropicBlocks,
  contentToGeminiParts,
  MAX_IMAGES,
  MAX_IMAGE_SIZE,
  SUPPORTED_TYPES,
};
