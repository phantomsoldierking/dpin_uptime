#!/usr/bin/env bash
set -euo pipefail

API="${API:-http://localhost:3001/v1}"
EMAIL="${EMAIL:-admin@dpin-local.io}"
PASSWORD="${PASSWORD:-admin123}"

echo "1) Login"
TOKEN=$(curl -sf -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).accessToken")

echo "2) Create website"
WEBSITE_ID=$(curl -sf -X POST "$API/websites" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "E2E Check Site",
    "url": "https://httpstat.us/200",
    "checkType": "HTTP",
    "intervalSeconds": 10,
    "timeoutSeconds": 5,
    "expectedStatus": 200,
    "regions": ["us-east-1", "eu-west-1", "ap-south-1"]
  }' | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).id")

echo "   websiteId=$WEBSITE_ID"

echo "3) Wait for scheduler + validator"
sleep 25

echo "4) Fetch results"
curl -sf "$API/websites/$WEBSITE_ID/results?limit=20" \
  -H "Authorization: Bearer $TOKEN" | node -p "JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')), null, 2)"

echo "5) Fetch analytics summary"
curl -sf "$API/analytics/websites/$WEBSITE_ID" \
  -H "Authorization: Bearer $TOKEN" | node -p "JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')).stats, null, 2)"

echo "✅ E2E check flow complete"
