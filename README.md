# DPIN Uptime

Plan-driven implementation of a distributed uptime monitoring platform with:
- API control plane (`apps/api`)
- scheduler hub with SLA aggregation (`apps/hub`)
- validator agents:
  - TypeScript runtime (`apps/validator`)
  - Go microservice (`apps/validator-go`)
- Next.js frontend (`apps/frontend`)
- Prisma/PostgreSQL data model (`packages/db`)
- DevOps layer (`infra/*`, `config/*`, `docker-compose*.yml`)

# Architecture
<img width="2576" height="1416" alt="image" src="https://github.com/user-attachments/assets/b269171a-b369-4529-a5da-1495ad66e81e" />


## Implemented platform features

- Auth: `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/refresh`, `GET /v1/auth/me`
- Websites: create/list/get/update/deactivate + results listing
- Nodes: register/list/get + heartbeat
- Jobs: list/get + node polling (`GET /v1/jobs/poll`)
- Results ingestion: `POST /v1/results` with HMAC signature verification
- Quorum consensus: majority status marks consensus results and closes/opens incidents
- Alerts: CRUD + incident creation on downtime consensus
- Analytics: overview + per-website stats + SLA records (`GET /v1/analytics/sla`)
- Health and metrics endpoints: `/health`, `/metrics`
- Hub SLA aggregation writes daily `sla_records`
- Go validator microservice for Kubernetes DaemonSet deployment

## DevOps and production support

- Terraform modules for:
  - EKS (`infra/terraform/modules/eks`)
  - RDS PostgreSQL (`infra/terraform/modules/rds`)
  - ElastiCache Redis (`infra/terraform/modules/elasticache`)
  - CloudWatch alarms + SNS (`infra/terraform/modules/cloudwatch`)
  - Route53 health checks (`infra/terraform/modules/route53`)
- Environment stacks:
  - `infra/terraform/environments/dev`
  - `infra/terraform/environments/prod`
- Helm charts:
  - `infra/helm/dpin-api`
  - `infra/helm/dpin-hub`
  - `infra/helm/dpin-frontend`
  - `infra/helm/dpin-validator` (DaemonSet)
- Observability:
  - Prometheus, Grafana, Loki, Tempo, OTel Collector, Promtail
  - configs under `config/*`
- Local full stack orchestration:
  - `docker-compose.infra.yml`
  - `docker-compose.yml`

## API endpoint groups

- `/v1/auth/*`
- `/v1/websites/*`
- `/v1/nodes/*`
- `/v1/jobs/*`
- `/v1/results`
- `/v1/alerts/*`
- `/v1/analytics/*`

Compatibility alias is also mounted at `/api/v1/*`.

## Local setup

1. Install dependencies

```bash
bun install
```

2. Copy env

```bash
cp .env.example .env.local
```

3. Start PostgreSQL and set `DATABASE_URL`.

4. Generate/migrate/seed DB

```bash
bun run db:generate
bun run db:migrate
bun run db:seed
```

5. Run services in separate terminals (Node validator)

```bash
bun run dev:api
bun run dev:hub
bun run dev:validator
bun run dev:frontend
```

Equivalent helper targets are available in `Makefile` (`make dev-api`, `make db-seed`, `make test-e2e`, etc.).

6. Run Go validator microservice

```bash
bun run dev:validator:go
```

## Default seeded credentials

- Admin: `admin@dpin-local.io` / `admin123`
- Node user: `node@dpin-local.io` / `node123`

## Smoke tests

```bash
bash scripts/test-check-flow.sh
bash scripts/test-node-signing.sh
bash scripts/local-stack-test.sh
```

## Notes

- Hub creates jobs based on website intervals and enabled regions.
- Validator polls jobs, runs checks, signs results, and submits them.
- API computes quorum-style majority consensus and opens/closes incidents from alert configs.
- SLA records are computed by hub and available to frontend through `/v1/analytics/sla`.
- `/infra` is only for production-style deployment and provisioning: Terraform, Helm, and Kubernetes manifests. You do not need it to understand or run the app locally.
- `/config` contains runtime configuration for local observability services such as Prometheus, Grafana, Loki, Tempo, OTel, and Promtail. It matters only when you use the Docker monitoring stack.
