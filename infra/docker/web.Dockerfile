# maestro-web — Next.js (standalone) production image.
# Built from the web/ context: `docker build -f infra/docker/web.Dockerfile web/`
FROM node:20-bookworm-slim AS deps
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS build
WORKDIR /web
COPY --from=deps /web/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* are baked at build time; overridden per-deployment via the compose build args.
ARG NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:8000
ENV NEXT_PUBLIC_ORCHESTRATOR_URL=$NEXT_PUBLIC_ORCHESTRATOR_URL
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3034 \
    HOSTNAME=0.0.0.0
# Next standalone output: a self-contained server + the static assets and public dir.
COPY --from=build /web/public ./public
COPY --from=build /web/.next/standalone ./
COPY --from=build /web/.next/static ./.next/static
EXPOSE 3034
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:3034/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
