#!/usr/bin/env sh
# Sobe uma stack separada (projeto celsius-e2e, portas próprias) com os dados sintéticos de test/fixtures/e2e
# e espera a ingestão terminar. Uso: sh scripts/e2e-stack.sh [down]
set -eu
export COMPOSE_PROJECT_NAME=celsius-e2e
export DATA_PATH=./test/fixtures/e2e
export DEMO_PASSWORD="${E2E_PASSWORD:-senha-de-teste-123}"
export INGEST_RATE=0 WEB_PORT=18080 API_PORT=13000 POSTGRES_PORT=15432 CLICKHOUSE_PORT=18123 INGEST_METRICS_PORT=19464

if [ "${1:-up}" = "down" ]; then
  docker compose down -v
  exit 0
fi

docker compose up -d --build
# a ingestão roda uma vez e termina; espera o código de saída
status=$(docker wait "$(docker compose ps -a -q ingest)")
docker compose logs ingest | tail -n 3
[ "$status" = "0" ] || { echo "ingestão falhou ($status)"; exit 1; }
echo "stack de E2E pronta em http://localhost:18080"
