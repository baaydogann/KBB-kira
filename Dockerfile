# syntax=docker/dockerfile:1.7

# Prisma motoru OpenSSL'i imajda arar. "slim" imajda yoktur; yoksa istemci "openssl-1.1.x" varsayar ve açılmaz.
FROM node:22-bookworm-slim AS base
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

FROM base AS pnpm
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM pnpm AS deps
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Yalnızca üretim bağımlılıkları (tsx dahil). `pnpm prune --prod` konteynerde kapanmadan takılıyordu; temiz bir üretim kurulumu kullanılır.
FROM pnpm AS prod-deps
RUN pnpm install --frozen-lockfile --prod

# Prisma CLI üretimde yalnızca migrasyon için gerekir; ayrı, düz bir kurulum.
FROM base AS migrator
WORKDIR /migrator
RUN npm install --no-save --omit=dev prisma@6.19.3

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=Europe/Istanbul BELGE_DIZINI=/data/belgeler
RUN mkdir -p /data/belgeler && chown node:node /data/belgeler
COPY --from=builder --chown=node:node /app/package.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/worker ./worker
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=migrator --chown=node:node /migrator/node_modules ./migrator/node_modules
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/saglik').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
