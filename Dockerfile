# Imagem da ingestão e da API (Bun executa TypeScript direto, sem etapa de build)
FROM oven/bun:1.4.3-slim
WORKDIR /app
ENV NODE_ENV=production

# Manifestos primeiro: a camada de dependências só é refeita quando eles mudam
COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/ingest/package.json apps/ingest/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
RUN bun install --frozen-lockfile --production --ignore-scripts --filter '@celsius/api' --filter '@celsius/ingest'

COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/ingest ./apps/ingest
COPY db ./db

# Ponto de montagem do volume celsius-secrets: um volume nomeado novo herda o dono deste diretório,
# então o setup (usuário bun) consegue gravar o segredo da sessão
RUN mkdir -p /run/celsius-secrets && chown bun:bun /run/celsius-secrets

USER bun
CMD ["bun", "run", "apps/api/src/main.ts"]
