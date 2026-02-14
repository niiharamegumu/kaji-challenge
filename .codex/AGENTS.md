# AGENTS.md

## Scope
This file defines how coding agents should work in this repository.

This repository is a monorepo:
- `frontend/`: React + Vite + TypeScript (Cloudflare Workers deploy target)
- `backend/`: Go + Gin (Cloud Run deploy target)
- `api/`: OpenAPI source of truth

## Instruction Priority
1. Direct user instructions in chat
2. The nearest `AGENTS.md` to the file being edited
3. Parent/root `AGENTS.md`

If future subprojects add their own `AGENTS.md`, the nearest file takes precedence.

## Agent Operating Principles
- Keep instructions concrete and actionable.
- Prefer small, verifiable changes over broad refactors.
- Run relevant checks before finishing.
- Do not expose secrets in code, logs, docs, commits, or PR text.
- Review and approve commands carefully when elevated or side-effectful operations are needed.

## Project Workflow

### Spec-First API Rule (Required)
When changing API behavior:
1. Update `api/openapi.yaml` first.
2. Run code generation (`make gen`).
3. Update frontend/backend code to match generated artifacts.
4. Run lint and tests.

### Common Commands
- Start local stack: `make dev`
- Generate API clients/server types: `make gen`
- Lint all: `make lint`
- Test all: `make test`
- Full check: `make check`
- Generated diff check: `make diff-gen`

### Definition of Done
A task is complete only when all applicable items are satisfied:
- Build/type/lint/test pass for changed areas.
- Generated files are updated when API/schema changed.
- Security and auth implications were reviewed for API/backend changes.
- Change summary includes what was changed and how it was validated.

## Skill Routing (Use the right skill for each task)

### Frontend
- `vercel-react-best-practices`
  - Use for React/Vite/TypeScript implementation, refactor, and performance work.
- `vitest`
  - Use for frontend unit/component test design and fixes.

### Backend (Go)
- `golang-http-frameworks`
  - Use for Go HTTP API design/implementation (including Gin patterns).
- `golang-testing`
  - Use for table-driven tests, test structure, and regression coverage.

### API / OpenAPI
- `openapi-spec-generation`
  - Use for OpenAPI-first design, endpoint/schema changes, and spec quality.

### Auth / Security
- `auth-implementation-patterns`
  - Use for authentication and authorization implementation decisions.
- `api-security-best-practices`
  - Use for API threat review, validation, and hardening.

### Runtime / Deploy
- `workers-best-practices`
  - Use for Cloudflare Workers runtime constraints and deployment fit.
- `gcp-cloud-run`
  - Use for Cloud Run deployment, config, and operational concerns.

### Workflow Skills
- `spec-workflow-manager`
  - Use for features/changes requiring structured investigation, planning, approval gates, and result tracking.
  - Default for non-trivial work spanning multiple files/components.
- `gh-pr-creator`
  - Use when the user asks to create a PR.
  - Includes pre-checks, commit preparation, and `gh pr create` flow.

## Security and Trust Boundaries
- Never commit API keys or credentials.
- Treat MCP/external integrations as trusted only if explicitly approved by the user/org.
- Avoid executing untrusted scripts blindly.
- For auth/security-sensitive changes, explicitly document risks and mitigations.

## Collaboration Output Format
When reporting completion, include:
- Files changed
- Why the change was made
- Validation commands run and outcomes
- Known risks or follow-up items

## Maintenance
Keep this file updated as stack, commands, and team conventions evolve.
