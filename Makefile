SHELL := /bin/bash

.PHONY: dev up down gen lint test check diff-gen

dev:
	docker compose up --build

up:
	docker compose up -d --build

down:
	docker compose down -v

gen:
	cd backend && go generate ./...
	cd frontend && npm run gen

lint:
	cd backend && go run github.com/golangci/golangci-lint/cmd/golangci-lint@v1.64.8 run ./...
	cd frontend && npm run lint

test:
	cd backend && go test ./...
	cd frontend && npm run test -- --run

check: gen lint test

diff-gen: gen
	git diff --exit-code
