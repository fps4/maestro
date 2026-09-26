# The console image (maestro ADR-0023: one console per deployment). Build context is `console/`;
# specs-service's compose builds it from there for the local loop.
#
# As with the api image, the build stage IS the gate — typecheck, lint, tests and the production
# build. The runtime stage serves the standalone output.
#
# Only `NEXT_PUBLIC_*` values are build arguments: Next inlines those into the browser bundle, so
# they have to be known at build time. `API_PROXY_TARGET` is deliberately NOT one — it is read at
# runtime by the route handler, so the same image runs against a different api host without a
# rebuild.

# --- build stage: the gate ---
FROM node:22-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /web

ARG NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
# "dev" (a stub principal) or "component-auth" (identity-service password grant).
ARG NEXT_PUBLIC_AUTH_MODE=dev
ENV NEXT_PUBLIC_AUTH_MODE=$NEXT_PUBLIC_AUTH_MODE
ARG NEXT_PUBLIC_IDENTITY_BASE_URL=
ENV NEXT_PUBLIC_IDENTITY_BASE_URL=$NEXT_PUBLIC_IDENTITY_BASE_URL
ARG NEXT_PUBLIC_IDENTITY_CLIENT_ID=
ENV NEXT_PUBLIC_IDENTITY_CLIENT_ID=$NEXT_PUBLIC_IDENTITY_CLIENT_ID
ARG NEXT_PUBLIC_DEFAULT_WORKSPACE=
ENV NEXT_PUBLIC_DEFAULT_WORKSPACE=$NEXT_PUBLIC_DEFAULT_WORKSPACE

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run typecheck && npm run lint && npm test && npm run build

# --- runtime stage ---
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /web

COPY --from=build --chown=node:node /web/.next/standalone ./
COPY --from=build --chown=node:node /web/.next/static ./.next/static
# `public/` must contain at least one tracked file, or git does not carry the directory and this
# COPY fails in CI while succeeding on a developer's machine — where the empty directory exists.
COPY --from=build --chown=node:node /web/public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/sign-in',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
