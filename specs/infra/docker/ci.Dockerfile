# The CI image: both packages' dependencies plus the repository, so the DoD gate can run lint,
# typecheck and the full suite against a sibling MongoDB replica set.
#
# The repository is baked in rather than bind-mounted. The ds1 runner is itself containerized and
# talks to the host Docker socket, so host paths do not translate across it — the build context is
# streamed to the daemon instead.

FROM node:22-bookworm-slim

WORKDIR /repo

COPY api/package.json api/package-lock.json ./api/
RUN cd api && npm ci

COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY . .

CMD ["bash"]
