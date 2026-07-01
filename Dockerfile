# ─── ggboi bot — production Docker image ──────────────────────────────────
# Builds the dashboard with Vite and serves it from the same Express process.
# The entire application (bot API + dashboard UI) runs on a single port,
# making it ideal for Pterodactyl or any single-port environment.
#
# Build:    docker build -t ggboi-bot .
# Run:      docker run -d --env-file .env -p 3432:3432 ggboi-bot
# Compose:  see docker-compose.prod.yml

# ─── Stage 1: Native addon (better-sqlite3) ────────────────────────────
FROM node:22-alpine AS bot-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --only=production

# ─── Stage 2: Dashboard build (Vite) ───────────────────────────────────
FROM node:22-alpine AS dashboard-build
WORKDIR /app
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# ─── Stage 3: Runtime image ────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache sqlite-libs

# Copy bot dependencies & source from bot-deps stage
COPY --from=bot-deps /app/node_modules ./node_modules
COPY index.js ./
COPY src/ ./src/
COPY modules/ ./modules/

# Copy built dashboard from dashboard-build stage
COPY --from=dashboard-build /app/dist ./dashboard/dist

# SQLite database is written to /data by default (use bind mount or named volume)
# Override via SQLITE_DB_PATH env var if needed
VOLUME /data

ENV NODE_ENV=production
# Port is configurable via $PORT env var (Pterodactyl standard)
EXPOSE 3432

CMD ["node", "index.js"]
