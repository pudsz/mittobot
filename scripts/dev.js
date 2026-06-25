#!/usr/bin/env node
// ─── Full local dev stack launcher ───────────────────────────────────────────
// One command to run everything you need locally:
//   1. Bot + API  (node index.js — also serves the dashboard API on :3001)
//   2. Dashboard  (Vite dev server in dashboard/ on :5173)
//
// Usage:
//   npm start                 # bot + dashboard
//   node scripts/dev.js --no-dashboard   # bot only
//
// No extra dependencies — uses Node's child_process and the dotenv already
// installed for the bot. SQLite database file is created automatically.

const { spawn, spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(ROOT, ".env") });

const args = process.argv.slice(2);
const RUN_DASHBOARD = !args.includes("--no-dashboard");

// Defaults for local development
const DASHBOARD_PORT = 5173;
const API_PORT = process.env.API_PORT || process.env.PORT || "3001";

// Child processes
const children = [];
let shuttingDown = false;

const COLORS = { bot: "\x1b[35m", dash: "\x1b[32m", sys: "\x1b[33m", err: "\x1b[31m", reset: "\x1b[0m" };
function log(tag, line) {
  const c = COLORS[tag] || "";
  process.stdout.write(`${c}[${tag}]${COLORS.reset} ${line}\n`);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("sys", "Shutting down bot and dashboard...");
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  // Give children a moment to exit cleanly, then force-quit.
  setTimeout(() => process.exit(code), 800).unref();
}

function spawnService(tag, cmd, cmdArgs, env) {
  const child = spawn(cmd, cmdArgs, { cwd: ROOT, env: { ...process.env, ...env } });
  const pipe = (stream) => stream.on("data", (d) => {
    for (const line of d.toString().split(/\r?\n/)) if (line.trim()) log(tag, line);
  });
  pipe(child.stdout);
  pipe(child.stderr);
  child.on("exit", (exitCode) => {
    if (shuttingDown) return;
    log("err", `${tag} exited (code ${exitCode}). Tearing down the rest of the stack.`);
    shutdown(exitCode == null ? 1 : exitCode);
  });
  children.push(child);
  return child;
}

// ─── 1. Bot (+ API) ─────────────────────────────────────────────────────────
function startBot() {
  if (!process.env.BOT_TOKEN) {
    log("err", "BOT_TOKEN is not set in .env — the bot cannot log in to Discord.");
    process.exit(1);
  }
  if (!process.env.DASHBOARD_PASSWORD && RUN_DASHBOARD) {
    log("sys", "DASHBOARD_PASSWORD not set — the dashboard API will be disabled (set it in .env to log in).");
  }
  log("bot", "Starting bot + API...");
  spawnService("bot", process.execPath, ["index.js"]);
}

// ─── 2. Dashboard (Vite dev server) ──────────────────────────────────────────
function startDashboard() {
  if (!RUN_DASHBOARD) return;
  // The Vite proxy (in vite.config.js) forwards /api/* and /login to the bot API.
  // The SPA fetches same-origin via the proxy — no env var needed for dev.
  const env = {};
  log("dash", `Starting dashboard on http://localhost:${DASHBOARD_PORT} (API proxied → http://localhost:${API_PORT})...`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  spawnService("dash", npm, ["--prefix", "dashboard", "run", "dev", "--", "--port", String(DASHBOARD_PORT)], env);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// Start services
startBot();
startDashboard();
log("sys", "Stack is up. Press Ctrl+C to stop.");