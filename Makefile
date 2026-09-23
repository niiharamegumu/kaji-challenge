SHELL := /bin/bash
DC := docker compose

# App tooling runs in Compose locally and on the host in CI.
ifeq ($(CI),true)
APP_RUN = cd app &&
else
APP_RUN = $(DC) run --rm app
endif

.PHONY: dev dev-host up down build typecheck lint test security architecture-check check

dev:
	$(DC) up --build app

dev-host:
	cd app && bun run db:migrate
	cd app && bun run dev

up:
	$(DC) up --build -d app

down:
	$(DC) down

build:
	$(APP_RUN) bun run build

typecheck:
	$(APP_RUN) bun run typecheck

lint:
	$(APP_RUN) bun run lint:all

test:
	$(APP_RUN) bun run test --run

security:
	$(APP_RUN) bun audit --audit-level high

architecture-check:
	$(APP_RUN) bun run architecture:check

# lint:all includes architecture; build includes application/infra typechecking.
# Full database/browser verification: cd app && bun run test:local
check: lint build test
