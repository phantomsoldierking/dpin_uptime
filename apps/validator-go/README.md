# validator-go

Go-based validator agent for DPIN Uptime.

## Features
- polls `/v1/jobs/poll`
- performs HTTP/TCP checks (ICMP placeholder)
- signs result payloads using HMAC-SHA256
- submits to `/v1/results`
- sends periodic `/v1/nodes/heartbeat`

## Run

```bash
go run ./cmd/validator
```

Required env vars:
- `NODE_ID`
- `NODE_API_KEY`
- `NODE_HMAC_SECRET`
- `HUB_API_URL`
