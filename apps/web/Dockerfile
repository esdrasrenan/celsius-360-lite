# Build estático com Bun + Vite, servido pelo nginx, que também faz o proxy de /api para a API
FROM oven/bun:1.4.3-slim AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/ingest/package.json apps/ingest/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
RUN bun install --frozen-lockfile --ignore-scripts --filter '@celsius/web'
COPY packages ./packages
COPY apps/web ./apps/web
RUN bun run --cwd apps/web build

FROM nginx:1.29.8-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
