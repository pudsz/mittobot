// ─── Shared JSON parsing helper for AI providers ───────────────────────────
// Extracted from the 6 provider files to avoid duplication.
// Throws a descriptive error when the LLM outputs truncated/malformed tool args.

function safeJsonParse(str, toolName) {
  try { return JSON.parse(str); } catch (e) {
    throw new Error(`Tool "${toolName}" arguments truncated or malformed (${str?.length || 0} chars) — try increasing aiMaxTokens. ${e.message}`);
  }
}

module.exports = { safeJsonParse };
