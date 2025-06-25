#!/usr/bin/env bash
set -euo pipefail

API="${API:-http://localhost:3001/v1}"
NODE_ID="${NODE_ID:-validator-us-east-dev}"
NODE_SECRET="${NODE_SECRET:-dev-secret-us-east-1234567890}"

JOB_JSON=$(curl -sf "$API/jobs/poll?nodeId=$NODE_ID" \
  -H "x-node-id: $NODE_ID" \
  -H "x-node-api-key: ${NODE_API_KEY:-578da30cdbacda0c410640ddde37490771f13bff08384de37d15c886303135e9}")

JOB_ID=$(echo "$JOB_JSON" | node -p "const v=JSON.parse(require('fs').readFileSync(0,'utf8')); v.job ? v.job.jobId : ''")
WEBSITE_ID=$(echo "$JOB_JSON" | node -p "const v=JSON.parse(require('fs').readFileSync(0,'utf8')); v.job ? v.job.websiteId : ''")
REGION=$(echo "$JOB_JSON" | node -p "const v=JSON.parse(require('fs').readFileSync(0,'utf8')); v.job ? v.job.region : ''")

if [[ -z "$JOB_ID" ]]; then
  echo "No pending job for $NODE_ID. Ensure hub is running and at least one active website exists."
  exit 1
fi

TS=$(date +%s%3N)

PAYLOAD=$(cat <<JSON
{"jobId":"$JOB_ID","nodeId":"$NODE_ID","websiteId":"$WEBSITE_ID","region":"$REGION","status":"UP","statusCode":200,"responseTimeMs":123,"dnsTimeMs":10,"tcpTimeMs":20,"tlsTimeMs":30,"ttfbMs":40,"errorMessage":null,"timestamp":$TS}
JSON
)

SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$NODE_SECRET" | awk '{print $2}')
VALID=$(echo "$PAYLOAD" | node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));p.signature=process.argv[1];process.stdout.write(JSON.stringify(p));" "$SIG")
INVALID=$(echo "$PAYLOAD" | node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));p.signature='deadbeef';process.stdout.write(JSON.stringify(p));")

echo "1) Submit invalid signature (expect 401)"
if curl -s -o /tmp/dpin-invalid.out -w "%{http_code}" -X POST "$API/results" -H "Content-Type: application/json" -d "$INVALID" | grep -q "401"; then
  echo "   ✅ invalid signature rejected"
else
  echo "   ❌ invalid signature was not rejected"
  cat /tmp/dpin-invalid.out
  exit 1
fi

echo "2) Submit valid signature (expect 201)"
if curl -s -o /tmp/dpin-valid.out -w "%{http_code}" -X POST "$API/results" -H "Content-Type: application/json" -d "$VALID" | grep -q "201"; then
  echo "   ✅ valid signature accepted"
else
  echo "   ❌ valid signature not accepted"
  cat /tmp/dpin-valid.out
  exit 1
fi

echo "✅ Signing test complete"
