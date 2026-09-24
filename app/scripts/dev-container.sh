#!/bin/sh
# Composeの開発コンテナ起動時に依存導入・ローカルD1移行・開発サーバー起動を行う。
set -eu
bun install --frozen-lockfile
bun run db:migrate
exec bun run dev --host 0.0.0.0 --port 5174
