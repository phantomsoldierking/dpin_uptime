.PHONY: help dev dev-api dev-hub dev-validator dev-frontend db-generate db-migrate db-seed test-e2e test-signing test-local down-local

help:
	@echo "make dev            # run all apps via turbo"
	@echo "make dev-api        # run API"
	@echo "make dev-hub        # run scheduler hub"
	@echo "make dev-validator  # run validator"
	@echo "make dev-validator-go # run Go validator"
	@echo "make dev-frontend   # run frontend"
	@echo "make db-generate    # prisma generate"
	@echo "make db-migrate     # prisma migrate dev"
	@echo "make db-seed        # seed local data"
	@echo "make test-e2e       # run end-to-end check flow"
	@echo "make test-signing   # run HMAC signing verification"
	@echo "make test-local     # start local stack and validate core workflows"
	@echo "make down-local     # stop local stack"
	@echo "make infra-plan-dev # terraform plan (dev)"
	@echo "make infra-plan-prod # terraform plan (prod)"

dev:
	bun run dev

dev-api:
	bun run dev:api

dev-hub:
	bun run dev:hub

dev-validator:
	bun run dev:validator

dev-validator-go:
	bun run dev:validator:go

dev-frontend:
	bun run dev:frontend

db-generate:
	bun run db:generate

db-migrate:
	bun run db:migrate

db-seed:
	bun run db:seed

test-e2e:
	bash scripts/test-check-flow.sh

test-signing:
	bash scripts/test-node-signing.sh

test-local:
	bash scripts/local-stack-test.sh

down-local:
	bash scripts/local-stack-down.sh

infra-plan-dev:
	bun run infra:plan:dev

infra-plan-prod:
	bun run infra:plan:prod
