# DocuMind API image: Render runs it (render.yaml) and CI smoke-tests it (.github/workflows/ci.yml).
# Node 24 LTS pinned by digest: bump the tag and the digest together.
ARG NODE_IMAGE=node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c

FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Every workspace manifest, so npm ci can check the whole lockfile; only shared and api install.
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @documind/shared --workspace @documind/api --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @documind/shared && npm run build -w @documind/api

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @documind/api && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
WORKDIR /app/apps/api
EXPOSE 3000
# Render's free plan has no pre-deploy step, so migrations run before the server starts. If one
# fails, the process exits, the new instance never becomes healthy and Render keeps the old one.
CMD ["sh", "-c", "node dist/database/migrate.js latest && exec node dist/main.js"]
