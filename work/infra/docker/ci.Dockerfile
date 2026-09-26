# The CI image: the api's dependencies plus the repository, so the gate runs lint, typecheck and the
# full suite against a sibling DynamoDB Local. The repository is baked in rather than bind-mounted.

FROM node:22-bookworm-slim

WORKDIR /repo

COPY api/package.json api/package-lock.json ./api/
RUN cd api && npm ci

COPY . .

CMD ["bash"]
