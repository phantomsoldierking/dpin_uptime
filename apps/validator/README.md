# Validator

Node agent that:
- sends heartbeat
- polls `/v1/jobs/poll`
- executes checks (HTTP/TCP, ICMP placeholder)
- signs payload with HMAC-SHA256
- submits `/v1/results`

Run:

```bash
NODE_ID=validator-us-east-dev \
NODE_REGION=us-east-1 \
NODE_API_KEY=578da30cdbacda0c410640ddde37490771f13bff08384de37d15c886303135e9 \
NODE_HMAC_SECRET=dev-secret-us-east-1234567890 \
HUB_API_URL=http://localhost:3001/v1 \
bun run dev
```
