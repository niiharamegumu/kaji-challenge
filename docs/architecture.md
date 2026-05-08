# Architecture

This repository uses two explicit architecture styles:

- Backend: Clean Architecture
- Frontend: Feature-Based Architecture

The boundary rules are enforced by `node scripts/check-architecture.mjs`. There is no accepted baseline debt; new violations fail the check.

## Backend: Clean Architecture

Target dependency direction:

```text
transport -> application/usecase -> domain <- application/ports
infra/persistence -> application/ports
infra/external -> application/ports
```

Responsibilities:

- `internal/domain`: entities, value objects, domain errors, and pure business rules.
- `internal/application/usecases`: use case orchestration and transaction-independent business flow.
- `internal/application/ports`: repository and external service interfaces expressed in domain types.
- `internal/adapter/transport`: Gin handlers, OpenAPI request/response mapping, cookies, headers, and HTTP status mapping.
- `internal/adapter/persistence`: PostgreSQL/sqlc implementation and DB row mapping.
- `internal/adapter/external`: OIDC, Push, and other external system clients.

Backend rules:

- `domain` must not import project packages.
- `application` must not import Gin, OpenAPI generated types, sqlc, transport, middleware, or infra implementation packages.
- OpenAPI generated types belong at the transport boundary.
- sqlc generated types belong at the persistence boundary.
- Business rules should live in domain/usecase, not in store methods.

Current migration note:

- The existing code still uses `internal/http/*` package names. OpenAPI generated types have been removed from `application`; remaining backend migration work is package relocation and moving store-level business rules toward usecase/domain services.

## Frontend: Feature-Based Architecture

Top-level structure:

- `src/app`: app bootstrap, providers, router, route chunk loading, and app-wide shell wiring.
- `src/features/<feature>`: feature-owned UI, routes, hooks, model, api adapter, and state.
- `src/shared`: cross-feature UI, hooks, query helpers, state, styles, and utilities.
- `src/lib/api`: generated API client and low-level API transport.

Feature rules:

- A feature must not import another feature's `components`, `hooks`, `state`, or `lib` internals.
- Cross-feature access must go through `src/features/<feature>/index.ts` public APIs.
- Cross-feature UI belongs in `shared/components`.
- Cross-feature query/state helpers belong in `shared/query` or `shared/state`.
- Components and routes should not value-import `src/lib/api/generated/client`; use feature hooks/api adapters instead.
- `shared` must not import from `features`.

Allowed examples:

```ts
import { ConfirmModal } from "../../../shared/components/ConfirmModal";
import { handleTeamStatePreconditionFailure } from "../../../shared/query/teamStateRefresh";
import { statusMessageAtom } from "../../../shared/state/status";
import { ShoppingListItemsSection } from "../../shopping-list";
```

NG examples:

```ts
import { ConfirmModal } from "../../admin/components/ConfirmModal";
import { handleTeamStatePreconditionFailure } from "../../shell/lib/teamStateRefresh";
import { postTask } from "../../../lib/api/generated/client";
import { ShoppingListItemsSection } from "../../shopping-list/components/ShoppingListManager";
```

Current migration note:

- `ConfirmModal`, status toast state, and team-state refresh helpers have been moved to `shared`.
- Frontend feature-cross imports and component-level generated API imports have been removed from the baseline.
