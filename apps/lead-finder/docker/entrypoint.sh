#!/bin/sh
set -e

echo "[entrypoint] running database migrations..."
node_modules/.bin/drizzle-kit migrate

echo "[entrypoint] starting scheduler..."
exec node_modules/.bin/tsx scripts/scheduler.ts
