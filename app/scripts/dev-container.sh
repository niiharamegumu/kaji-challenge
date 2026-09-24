#!/bin/sh
set -eu
bun install --frozen-lockfile
bun run db:migrate
exec bun run dev --host 0.0.0.0 --port 5174
