#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_BASE="${API_BASE:-http://localhost:3001}"
API_V1="${API_V1:-$API_BASE/v1}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
PROM_URL="${PROM_URL:-http://localhost:9090}"
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3030}"
DATABASE_URL="${DATABASE_URL:-postgresql://dpin:dpin_secret@localhost:5432/dpin?schema=public}"

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@dpin-local.io}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

print_service_logs() {
  echo
  echo "[debug] docker compose status"
  docker compose ps || true
  echo
  echo "[debug] recent service logs"
  docker compose logs --tail=80 api frontend hub validator-us-east validator-eu-west validator-ap-south otel-collector || true
}

on_error() {
  local exit_code=$?
  echo "[error] local stack test failed" >&2
  print_service_logs
  exit "$exit_code"
}

trap on_error ERR

wait_for_http() {
  local url="$1"
  local name="$2"
  local attempts="${3:-60}"
  local sleep_seconds="${4:-2}"

  for ((i=1; i<=attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[ok] $name is reachable at $url"
      return 0
    fi
    sleep "$sleep_seconds"
  done

  echo "[error] $name did not become ready: $url" >&2
  return 1
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[error] Required command not found: $cmd" >&2
    exit 1
  fi
}

require_cmd bun
require_cmd curl
require_cmd node
require_cmd openssl
require_cmd docker

echo "[step] Checking Bun dependencies"
if [[ ! -d node_modules ]]; then
  echo "[error] node_modules is missing. Run 'bun install' first." >&2
  exit 1
fi

echo "[step] Starting infra services"
docker compose up -d postgres redis prometheus grafana loki tempo otel-collector promtail

wait_for_http "http://localhost:9090/-/ready" "Prometheus" 90 2
wait_for_http "$GRAFANA_URL/api/health" "Grafana" 90 2

export DATABASE_URL
echo "[step] Using DATABASE_URL=$DATABASE_URL"

echo "[step] Generating Prisma client"
bun run db:generate

echo "[step] Running database migrations"
bun run db:migrate

echo "[step] Seeding local data"
bun run db:seed

echo "[step] Starting application services"
docker compose rm -sf api hub frontend validator-us-east validator-eu-west validator-ap-south >/dev/null 2>&1 || true
docker compose up -d --build --force-recreate api hub frontend

wait_for_http "$API_BASE/health" "API" 90 2
wait_for_http "$FRONTEND_URL/login" "Frontend" 90 2

echo "[step] Verifying frontend routes"
curl -fsS "$FRONTEND_URL/login" | grep -q "Sign In"
curl -fsS "$FRONTEND_URL/register" | grep -q "Create Account"
echo "[ok] Frontend login/register routes render"

echo "[step] Logging in through API"
TOKEN="$(
  curl -fsS -X POST "$API_V1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
    | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).accessToken"
)"

if [[ -z "$TOKEN" ]]; then
  echo "[error] Failed to obtain access token" >&2
  exit 1
fi
echo "[ok] Auth login succeeded"

echo "[step] Verifying authenticated UX/API flow"
curl -fsS "$API_V1/auth/me" \
  -H "Authorization: Bearer $TOKEN" \
  | node -e "const fs=require('fs'); const v=JSON.parse(fs.readFileSync(0,'utf8')); if(!v.user || v.user.email !== process.argv[1]) process.exit(1);" "$ADMIN_EMAIL"

curl -fsS "$API_V1/analytics/overview" \
  -H "Authorization: Bearer $TOKEN" \
  | node -e "const fs=require('fs'); const v=JSON.parse(fs.readFileSync(0,'utf8')); if(!v.totals) process.exit(1);"
echo "[ok] Authenticated overview endpoint works"

echo "[step] Registering local validator nodes"
for node_id in validator-us-east-dev validator-eu-west-dev validator-ap-south-dev; do
  case "$node_id" in
    validator-us-east-dev)
      region="us-east-1"
      api_key="578da30cdbacda0c410640ddde37490771f13bff08384de37d15c886303135e9"
      hmac_secret="dev-secret-us-east-1234567890"
      ;;
    validator-eu-west-dev)
      region="eu-west-1"
      api_key="e2e63f950e1751ce68ca8a14c61e52903d77c0bf294a2bafc5af8892466512ca"
      hmac_secret="dev-secret-eu-west-1234567890"
      ;;
    validator-ap-south-dev)
      region="ap-south-1"
      api_key="1c15770878866b9a7213cd51d8a1be919e54e2919af9e80b9dee9db53163bdff"
      hmac_secret="dev-secret-ap-south-1234567890"
      ;;
  esac

  curl -fsS -X POST "$API_V1/nodes/register" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"nodeId\":\"$node_id\",\"name\":\"$node_id\",\"region\":\"$region\",\"apiKey\":\"$api_key\",\"hmacSecret\":\"$hmac_secret\"}" \
    >/dev/null
done
echo "[ok] Validator nodes registered"

echo "[step] Starting validator services"
docker compose up -d --build --force-recreate validator-us-east validator-eu-west validator-ap-south

echo "[step] Creating a monitored website"
WEBSITE_ID="$(
  curl -fsS -X POST "$API_V1/websites" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Local Stack Test Site",
      "url": "https://httpstat.us/200",
      "checkType": "HTTP",
      "intervalSeconds": 10,
      "timeoutSeconds": 5,
      "expectedStatus": 200,
      "isPublic": true,
      "regions": ["us-east-1", "eu-west-1", "ap-south-1"]
    }' | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).id"
)"
echo "[ok] Website created: $WEBSITE_ID"

echo "[step] Waiting for scheduler and Go validators to process jobs"
sleep 35

echo "[step] Verifying node activity"
curl -fsS "$API_V1/nodes" \
  -H "Authorization: Bearer $TOKEN" \
  | node -e "const fs=require('fs'); const v=JSON.parse(fs.readFileSync(0,'utf8')); if(!Array.isArray(v.nodes) || v.nodes.length < 3) process.exit(1); const online=v.nodes.filter(n => n.isOnline); if(online.length < 1) process.exit(1);"
echo "[ok] Nodes endpoint shows active validators"

echo "[step] Verifying results for created website"
curl -fsS "$API_V1/websites/$WEBSITE_ID/results?limit=20" \
  -H "Authorization: Bearer $TOKEN" \
  | node -e "const fs=require('fs'); const v=JSON.parse(fs.readFileSync(0,'utf8')); if(!Array.isArray(v.results) || v.results.length < 1) process.exit(1);"
echo "[ok] Result ingestion path works"

echo "[step] Verifying analytics for created website"
curl -fsS "$API_V1/analytics/websites/$WEBSITE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | node -e "const fs=require('fs'); const v=JSON.parse(fs.readFileSync(0,'utf8')); if(!v.stats || typeof v.stats.totalChecks !== 'number') process.exit(1);"
echo "[ok] Website analytics endpoint works"

echo "[step] Verifying Prometheus metrics exposure"
curl -fsS "$API_BASE/metrics" | grep -q "dpin_http_requests_total"
echo "[ok] API metrics are exposed"

echo "[step] Running HMAC signing verification test"
bash scripts/test-node-signing.sh

echo "[step] Running API-level end-to-end test"
bash scripts/test-check-flow.sh

echo "[done] Local stack validated"
echo "URLs:"
echo "  Frontend:   $FRONTEND_URL"
echo "  API:        $API_BASE"
echo "  Grafana:    $GRAFANA_URL"
echo "  Prometheus: $PROM_URL"
echo
echo "Notes:"
echo "  /infra contains production deployment definitions (Terraform, Helm, K8s)."
echo "  /config contains observability/runtime config files used by docker-compose and monitoring services."
