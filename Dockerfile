# ── Stage 1: Install deps ─────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
# .npmrc carries legacy-peer-deps, which npm ci needs to resolve the
# react-three peer ranges. Without it here the image installs under different
# rules than every developer machine and the build dies on ERESOLVE.
COPY package.json package-lock.json* .npmrc ./
RUN npm ci

# ── Stage 2: Build ────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Stage 3: Runtime ──────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Standalone output does not include public/. Without this every file in it —
# the brand wordmark, the hero images — is a 404 in production while working
# in dev, where Next serves public/ straight from the checkout.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Client drawings, served by app/api/drawings to signed-in sessions only — kept
# out of public/ so they are never reachable by URL alone.
COPY --from=builder --chown=nextjs:nodejs /app/drawings ./drawings

# ── History mirror ─────────────────────────────────────────────────────────
# Where gateway/chunkStore.ts keeps sealed history chunks. It is a cache in the
# sense that everything in it can be re-read from the gateway, and emphatically
# not a cache in the sense that losing it is cheap: refilling thirty days costs
# ~1,080 gateway requests and about ten hours of walking, and the endpoint
# charges 8.0 s per request plus 5.27 ms per row.
#
# Declared as a volume so a container replacement does not silently start that
# again. Unmounted, the directory still exists inside the container and the app
# works — it simply re-backfills on every deploy, and says so at startup.
#
# Created before USER because a volume mounted over it inherits this ownership;
# without it the app runs as nextjs against a root-owned mount and every write
# fails silently, which chunkStore is deliberately built to survive and which
# would therefore show up only as history that never gets faster.
# /data/central: the central-backend collector's history and the shared alarm
# acknowledgements (lib/server/central/store.ts). Unlike the gateway mirror it
# CANNOT be refilled — the backend has already dropped what it holds — so keep
# the volume mounted.
RUN mkdir -p /data/history /data/central && chown -R nextjs:nodejs /data
VOLUME ["/data"]
ENV HISTORY_DIR=/data/history

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
