# ─── Stage 1: Frontend Build ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build

COPY app/package*.json ./
RUN npm ci

COPY app/ .
RUN npm run build
# Output: /build/dist/

# ─── Stage 2: Production Runtime ──────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source (server.js, srv/, db/, cds models)
COPY . .

# Copy built frontend into expected location
COPY --from=frontend-builder /build/dist/ ./app/dist/

# SQLite data dir (wird per Volume gemountet)
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=4004

EXPOSE 4004

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s \
  CMD wget -qO- http://localhost:4004/health || exit 1

# db:deploy legt/migriert die SQLite-DB an, danach startet cds-serve
CMD ["sh", "-c", "npm run db:deploy && npx cds-serve"]
