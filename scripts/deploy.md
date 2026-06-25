# ggboi Deployment Guide

**Architecture:** Dashboard on Vercel, bot on your VPS.

```
┌─────────────────┐     HTTPS / JWT      ┌──────────────────────┐
│  Vercel (SPA)   │ ◄──────────────────► │  Your VPS (Bot API)  │
│  ggboi-dash.vercel.app │               │  bot.yourdomain.com  │
│  Static React   │     CORS-locked      │  Express on :3001    │
│  No database    │     Bearer token     │  SQLite/Discord API  │
└─────────────────┘                      └──────────────────────┘
```

## 1. Deploy the Dashboard to Vercel

### Steps

```bash
# 1. Navigate to the dashboard directory
cd dashboard

# 2. Install dependencies
npm install

# 3. Build locally to verify
npm run build

# 4. Deploy to Vercel
npx vercel --prod
```

### Vercel Environment Variables

Set these in the Vercel dashboard (Project > Settings > Environment Variables):

| Variable | Value | Description |
|----------|-------|-------------|
| `VITE_BOT_API_URL` | `https://bot.yourdomain.com` | Your VPS bot API URL (no trailing slash) |

**Important:** `VITE_BOT_API_URL` is embedded at **build time**, not runtime. After changing it, redeploy.

### Vercel Configuration

`dashboard/vercel.json` is already set up with SPA rewrites:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/" }]
}
```

---

## 2. Deploy the Bot to Your VPS

### Option A: Docker (Recommended)

```bash
# 1. Clone or copy the project to your VPS
git clone <your-repo> /opt/ggboi
cd /opt/ggboi

# 2. Create .env from example (edit on the HOST, not inside the container)
cp .env.example .env
nano .env   # fill in your secrets (see .env.example for all fields)

# 3. Build and start with docker compose
docker compose -f docker-compose.prod.yml build bot
docker compose -f docker-compose.prod.yml up -d

# 4. Check logs
docker compose -f docker-compose.prod.yml logs -f bot
```

The bot API listens on `127.0.0.1:3001` (localhost only). You need a **reverse proxy** to serve it publicly with HTTPS.

### Discord Intents

Before the bot can function, enable these Gateway Intents in the [Discord Developer Portal](https://discord.com/developers/applications) under **Bot > Privileged Gateway Intents**:
- **Server Members Intent** — for autoroles, welcome/leave messages, role tracking
- **Message Content Intent** — for reading message content (commands, automod, AI)
- **Presence Intent** — for presence data in userinfo commands

### Option B: PM2 (Direct Node.js)

```bash
# 1. Install Node.js 22+ and PM2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# 2. Clone the project
git clone <your-repo> /opt/ggboi
cd /opt/ggboi

# 3. Install dependencies
npm install --production

# 4. Create .env
cp .env.example .env
nano .env

# 5. Create logs directory
mkdir -p logs

# 6. Start with PM2
pm2 start ecosystem.config.cjs
pm2 save
sudo pm2 startup   # auto-start on boot

# 7. Check status
pm2 status
pm2 logs ggboi-bot
```

### Option C: systemd (No PM2)

```bash
# 1. Clone the project
sudo git clone <your-repo> /opt/ggboi
cd /opt/ggboi
sudo npm install --production

# 2. Create a non-root user
sudo useradd -r -s /bin/false ggboi-bot
sudo mkdir -p logs
sudo chown -R ggboi-bot:ggboi-bot /opt/ggboi

# 3. Create .env
sudo -u ggboi-bot cp .env.example .env
sudo -u ggboi-bot nano .env

# 4. Install the systemd service
sudo cp scripts/ggboi-bot.service /etc/systemd/system/ggboi-bot.service
sudo systemctl daemon-reload
sudo systemctl enable ggboi-bot
sudo systemctl start ggboi-bot

# 5. Check status
sudo systemctl status ggboi-bot
sudo journalctl -u ggboi-bot -f
```

---

## 3. Set Up HTTPS (Reverse Proxy)

The bot API listens on `127.0.0.1:3001`. You must put it behind a reverse proxy for HTTPS.

### Option A: Caddy (Simplest — auto HTTPS)

```bash
# Install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# Create Caddyfile
sudo tee /etc/caddy/Caddyfile << 'EOF'
bot.yourdomain.com {
    reverse_proxy 127.0.0.1:3001
    log {
        output file /var/log/caddy/ggboi-bot.log
    }
}
EOF

# Start Caddy
sudo systemctl enable caddy
sudo systemctl restart caddy
```

### Option B: nginx + Let's Encrypt

```bash
# Install nginx and certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# Create nginx config
sudo tee /etc/nginx/sites-available/ggboi-bot << 'EOF'
server {
    listen 80;
    server_name bot.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/ggboi-bot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Get HTTPS certificate
sudo certbot --nginx -d bot.yourdomain.com
```

---

## 4. Security Checklist

- [ ] **HTTPS** — The bot API MUST be served over HTTPS in production
- [ ] **`DASHBOARD_JWT_SECRET`** — Set a long (~64 char), random, stable secret
- [ ] **`DASHBOARD_ORIGIN`** — Set to your exact Vercel URL (e.g., `https://ggboi-dash.vercel.app`)
- [ ] **`DASHBOARD_PASSWORD`** — Use a strong password (or set up Discord OAuth instead)
- [ ] **Firewall** — Only ports 80/443 open to the internet; port 3001 is localhost-only
- [ ] **API rate limit** — 300 requests/minute per IP on all `/api/*` endpoints (built-in)
- [ ] **Login rate limit** — 10 attempts/minute per IP on `/login` (built-in)
- [ ] **Regular updates** — Run `npm audit` and update dependencies periodically
- [ ] **SQLite backup** — Back up the `ggboi.sqlite` file regularly
- [ ] **Discord OAuth** (optional) — More secure than a shared password for multi-admin setups

---

## 5. Environment Variables (Production)

See `.env.example` for the full list. Here are the production-critical ones:

```bash
# Required
BOT_TOKEN=your_discord_bot_token

# Auth — pick one:
DASHBOARD_PASSWORD=a_very_strong_password_here

# OR (more secure for multi-user):
DISCORD_CLIENT_ID=your_discord_app_id
DISCORD_CLIENT_SECRET=your_discord_app_secret
DISCORD_REDIRECT_URI=https://bot.yourdomain.com/api/auth/discord/callback

# Required for production
DASHBOARD_JWT_SECRET=random_64_char_hex_secret
DASHBOARD_ORIGIN=https://ggboi-dash.vercel.app

# Optional
API_PORT=3001
DASHBOARD_TOKEN_TTL=7d
```

---

## 6. Updating

### Dashboard (Vercel)
```bash
cd dashboard
npm run build
npx vercel --prod
```

### Bot (Docker)
```bash
cd /opt/ggboi
git pull
docker compose -f docker-compose.prod.yml build bot
docker compose -f docker-compose.prod.yml up -d
```

### Bot (PM2)
```bash
cd /opt/ggboi
git pull
npm install --production
pm2 restart ggboi-bot
```
