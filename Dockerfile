# syntax=docker/dockerfile:1
#
# NEXUS Trading Intelligence — production image.
#
# SECRETS: no API key is ever copied into this image. `.env*` files are
# excluded by .dockerignore and no key is needed at build time. Keys are
# supplied at RUN time only (docker compose `env_file`, or `docker run --env-file`).
# Never add `ARG`/`ENV` lines containing keys here: they would be baked into
# image layers and readable by anyone who can pull the image.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as an unprivileged user.
RUN addgroup -S nexus && adduser -S nexus -G nexus

# `output: 'standalone'` (next.config.ts) emits a minimal server bundle.
COPY --from=build --chown=nexus:nexus /app/.next/standalone ./
COPY --from=build --chown=nexus:nexus /app/.next/static ./.next/static
COPY --from=build --chown=nexus:nexus /app/public ./public

USER nexus
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
