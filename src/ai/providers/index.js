const groq     = require("./groq");
const openai   = require("./openai");
const claude   = require("./claude");
const gemini   = require("./gemini");
const custom   = require("./custom");
const nvidia   = require("./nvidia");
const deepseek = require("./deepseek");
const together = require("./together");

const PROVIDERS = [groq, openai, claude, gemini, custom, nvidia, deepseek, together];
const BY_ID = Object.fromEntries(PROVIDERS.map(p => [p.id, p]));

function getProvider(id) {
  return BY_ID[id] || null;
}

function listProviders() {
  return PROVIDERS.map(p => ({
    id:           p.id,
    label:        p.label,
    envVar:       p.envVar,
    keyField:     p.keyField,
    modelField:   p.modelField,
    defaultModel: p.defaultModel,
    baseUrlField: p.baseUrlField || null,
    apiTypeField: p.apiTypeField || null,
  }));
}

function getEnvVars(provider) {
  if (!provider) return [];
  return Array.isArray(provider.envVar) ? provider.envVar : [provider.envVar];
}

module.exports = { getProvider, listProviders, getEnvVars, PROVIDERS };
