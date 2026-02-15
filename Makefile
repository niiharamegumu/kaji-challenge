SHELL := /bin/bash

.PHONY: dev up down gen lint test check diff-gen

DC := docker compose
BACKEND_RUN := $(DC) run --rm backend
FRONTEND_RUN := $(DC) run --rm frontend

# Execution mode:
# - local dev: run inside Docker Compose
# - CI=true   : run directly on runner toolchain
ifeq ($(CI),true)
GEN_BACKEND = cd backend && go generate ./...
GEN_FRONTEND = cd frontend && npm run gen
LINT_BACKEND = cd backend && go run github.com/golangci/golangci-lint/cmd/golangci-lint@v1.64.8 run ./...
LINT_FRONTEND = cd frontend && npm run lint
TEST_BACKEND = cd backend && go test ./...
TEST_FRONTEND = cd frontend && npm run test -- --run
else
GEN_BACKEND = $(BACKEND_RUN) go -C /app/backend generate ./...
GEN_FRONTEND = $(FRONTEND_RUN) npm run gen
LINT_BACKEND = $(BACKEND_RUN) go -C /app/backend run github.com/golangci/golangci-lint/cmd/golangci-lint@v1.64.8 run ./...
LINT_FRONTEND = $(FRONTEND_RUN) npm run lint
TEST_BACKEND = $(BACKEND_RUN) go -C /app/backend test ./...
TEST_FRONTEND = $(FRONTEND_RUN) npm run test -- --run
endif

dev:
	$(DC) up --build

up:
	$(DC) up -d --build

down:
	$(DC) down -v

gen:
	$(GEN_BACKEND)
	$(GEN_FRONTEND)

lint:
	$(LINT_BACKEND)
	$(LINT_FRONTEND)

test:
	$(TEST_BACKEND)
	$(TEST_FRONTEND)

check: gen lint test

diff-gen: gen
	git diff --exit-code
