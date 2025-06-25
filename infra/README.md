# Infrastructure Layer

This directory contains production and local DevOps support for DPIN Uptime.

## Terraform
- `infra/terraform/main.tf`: root orchestration
- Modules:
  - `modules/eks`
  - `modules/rds`
  - `modules/elasticache`
  - `modules/cloudwatch`
  - `modules/route53`
- Environment stacks:
  - `environments/dev`
  - `environments/prod`

## Helm
- `helm/dpin-api`: API Deployment + Service
- `helm/dpin-hub`: hub scheduler Deployment
- `helm/dpin-frontend`: frontend Deployment + Service
- `helm/dpin-validator`: Go validator DaemonSet

## Kubernetes Manifests
- `k8s/namespaces.yaml`
- `k8s/secrets.yaml`
- `k8s/monitoring/*`

## Observability Config
- `config/prometheus/prometheus.yml`
- `config/grafana/*`
- `config/loki/loki.yml`
- `config/tempo/tempo.yml`
- `config/otel/config.yml`
- `config/promtail/config.yml`

## Local Stack
- `docker-compose.infra.yml`
- `docker-compose.yml`
