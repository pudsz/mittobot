// ─── PM2 ecosystem file for ggboi bot ─────────────────────────────────────
// The dashboard is deployed separately on Vercel — this only manages the bot.
//
// Install PM2:    npm install -g pm2
// Start:          pm2 start ecosystem.config.cjs
// Save:           pm2 save
// Startup:        pm2 startup
// Logs:           pm2 logs ggboi-bot
// Stop:           pm2 stop ggboi-bot

module.exports = {
  apps: [
    {
      name: "ggboi-bot",
      script: "index.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      // ── Process management ──
      instances: 1,             // Discord client is stateful; one instance only
      exec_mode: "fork",        // fork mode (not cluster) for singletons
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5_000,     // wait 5s between restarts
      min_uptime: "30s",        // considered "started" after 30s
      // ── Logging ──
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "logs/error.log",
      out_file: "logs/output.log",
      merge_logs: true,
      // ── Resource limits ──
      max_memory_restart: "512M", // restart if memory exceeds 512MB
    },
  ],
};
