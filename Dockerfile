# ─── ggboi bot — production Docker image ──────────────────────────────────
# The dashboard is deployed separately on Vercel.
# This image runs the bot process + API server behind a reverse proxy.
#
# Build:    docker build -t ggboi-bot .
# Run:      docker run -d --env-file .env -p 3001:3001 ggboi-bot
# Compose:  see docker-compose.prod.yml

FROM node:22-alpine AS builder
WORKDIR /app

# better-sqlite3 is a native C++ addon; Alpine needs build tools to compile it
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --only=production

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache sqlite-libs

# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY index.js ./
COPY src/ ./src/
COPY modules/ ./modules/

# SQLite database is written to /data by default (use bind mount or named volume)
# Override via SQLITE_DB_PATH env var if needed
VOLUME /data

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "index.js"]
