SHELL := /bin/bash

.PHONY: dev up down down-reset gen gen-backend gen-frontend lint lint-backend lint-frontend test test-backend test-frontend security security-backend security-frontend check diff-gen db-migrate-up db-migrate-down db-migrate-create

ifneq (,$(wildcard .env))
include .env
endif

DC := docker compose
BACKEND_RUN := $(DC) run --rm backend
FRONTEND_RUN := $(DC) run --rm frontend
MIGRATE_RUN := $(BACKEND_RUN) go -C /app/backend run -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.19.0

# Execution mode:
# - local dev: run inside Docker Compose
# - CI=true   : run directly on runner toolchain
ifeq ($(CI),true)
GEN_BACKEND = cd backend && go generate ./...
GEN_FRONTEND = cd frontend && npm run gen
LINT_BACKEND = cd backend && golangci-lint run --go=1.24 ./...
LINT_FRONTEND = cd frontend && npm run lint
TEST_BACKEND = cd backend && go test ./...
TEST_FRONTEND = cd frontend && npm run test -- --run
SECURITY_BACKEND = cd backend && go run github.com/securego/gosec/v2/cmd/gosec@v2.22.8 -exclude-dir=internal/db/sqlc ./... && go run golang.org/x/vuln/cmd/govulncheck@v1.1.4 -format json ./... | go run ./cmd/govulncheck-critical -critical-file ./security/critical_goids.txt
SECURITY_FRONTEND = cd frontend && npm audit --audit-level=critical
else
GEN_BACKEND = $(BACKEND_RUN) go -C /app/backend generate ./...
GEN_FRONTEND = $(FRONTEND_RUN) npm run gen
LINT_BACKEND = $(BACKEND_RUN) golangci-lint run --go=1.24 ./...
LINT_FRONTEND = $(FRONTEND_RUN) npm run lint
TEST_BACKEND = $(BACKEND_RUN) go -C /app/backend test ./...
TEST_FRONTEND = $(FRONTEND_RUN) npm run test -- --run
SECURITY_BACKEND = $(BACKEND_RUN) sh -c "cd /app/backend && go run github.com/securego/gosec/v2/cmd/gosec@v2.22.8 -exclude-dir=internal/db/sqlc ./... && go run golang.org/x/vuln/cmd/govulncheck@v1.1.4 -format json ./... | go run ./cmd/govulncheck-critical -critical-file ./security/critical_goids.txt"
SECURITY_FRONTEND = $(FRONTEND_RUN) npm audit --audit-level=critical
endif

dev:
	$(DC) up --build

up:
	$(DC) up -d --build

down:
	$(DC) down

down-reset:
	$(DC) down -v

gen:
	$(MAKE) gen-backend
	$(MAKE) gen-frontend

gen-backend:
	$(GEN_BACKEND)

gen-frontend:
	$(GEN_FRONTEND)

lint:
	$(MAKE) lint-backend
	$(MAKE) lint-frontend

lint-backend:
	$(LINT_BACKEND)

lint-frontend:
	$(LINT_FRONTEND)

test:
	$(MAKE) test-backend
	$(MAKE) test-frontend

test-backend:
	$(TEST_BACKEND)

test-frontend:
	$(TEST_FRONTEND)

security:
	$(MAKE) security-backend
	$(MAKE) security-frontend

security-backend:
	$(SECURITY_BACKEND)

security-frontend:
	$(SECURITY_FRONTEND)

check: gen lint test

diff-gen: gen
	git diff --exit-code

db-migrate-up:
	@test -n "$(DATABASE_URL)" || (echo "DATABASE_URL is empty. Set it in .env or env var." && exit 1)
	$(MIGRATE_RUN) -path /app/backend/migrations -database "$(DATABASE_URL)" up

db-migrate-down:
	@test -n "$(DATABASE_URL)" || (echo "DATABASE_URL is empty. Set it in .env or env var." && exit 1)
	$(MIGRATE_RUN) -path /app/backend/migrations -database "$(DATABASE_URL)" down 1

db-migrate-create:
	@test -n "$(name)" || (echo "usage: make db-migrate-create name=add_xxx" && exit 1)
	$(MIGRATE_RUN) create -ext sql -dir /app/backend/migrations -seq $(name)
