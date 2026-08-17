# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.18
ARG NODE_IMAGE_DIGEST=sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7

FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST} AS build
WORKDIR /opt/las

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST} AS production-dependencies
WORKDIR /opt/las

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST} AS runtime

LABEL org.opencontainers.image.title="Local Automation Server" \
      org.opencontainers.image.description="Local-first HTTP/WebSocket gateway and automation server" \
      org.opencontainers.image.source="https://github.com/tntexploding/LocalWebServer" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    LAS_ROOT_DIR=/var/lib/las
WORKDIR /opt/las

COPY --from=production-dependencies --chown=node:node /opt/las/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json release.config.json LICENSE README.md ./
COPY --chown=node:node apps/server/package.json apps/server/package.json
COPY --from=production-dependencies --chown=node:node /opt/las/apps/server/node_modules ./apps/server/node_modules
COPY --from=build --chown=node:node /opt/las/apps/server/dist ./apps/server/dist
COPY --chown=node:node apps/web/package.json apps/web/package.json
COPY --from=build --chown=node:node /opt/las/apps/web/dist ./apps/web/dist
COPY --chown=node:node packages/core/package.json packages/core/package.json
COPY --from=build --chown=node:node /opt/las/packages/core/dist ./packages/core/dist
COPY --chown=node:node packages/storage/package.json packages/storage/package.json
COPY --from=build --chown=node:node /opt/las/packages/storage/dist ./packages/storage/dist
COPY --chown=node:node scripts/container-entrypoint.mjs scripts/container-healthcheck.mjs scripts/container-runtime.mjs scripts/init-secrets.mjs ./scripts/
COPY --chown=node:node config/*.example.yaml ./config/

RUN mkdir -p /var/lib/las/config /var/lib/las/data \
    && chown -R node:node /var/lib/las \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

USER node
VOLUME ["/var/lib/las"]
EXPOSE 4789

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --start-interval=2s --retries=3 \
  CMD ["node", "scripts/container-healthcheck.mjs"]

ENTRYPOINT ["node", "scripts/container-entrypoint.mjs"]
