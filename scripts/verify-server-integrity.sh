#!/usr/bin/env bash
#
# Verifies server-side integrity against a REAL local Supabase stack.
#
# Two layers, both against the genuine platform (real Postgres, real auth schema,
# real roles, real PostgREST):
#
#   1. `supabase test db`  — the pgTAP suites in supabase/tests/. These call the
#      real RPCs as the real roles and assert the trust model holds.
#   2. The live integration tests — they drive the real game simulation through
#      the real client service and read the result back from the database.
#
# The stack must already be running (`supabase start`). The database is reset
# first so every migration is applied from scratch, which also proves they still
# apply in order.
#
# Usage:  bash scripts/verify-server-integrity.sh
#         npm run verify:server

set -euo pipefail

# Prefer a `supabase` on PATH (CI installs one); fall back to the pinned CLI via
# npx so this also works on a machine that only has Node.
if command -v supabase >/dev/null 2>&1; then
  SUPABASE=(supabase)
else
  SUPABASE=(npx --yes supabase@latest)
fi

if ! "${SUPABASE[@]}" status >/dev/null 2>&1; then
  echo "error: no local Supabase stack is running." >&2
  echo "       start it with 'npm run db:start', then re-run this script." >&2
  exit 1
fi

echo "==> Resetting the database (applies every migration from scratch)"
"${SUPABASE[@]}" db reset

echo "==> pgTAP server-integrity suites"
"${SUPABASE[@]}" test db supabase/tests

echo "==> Pointing the client at the local stack"
# `supabase status -o env` prints shell assignments: API_URL, ANON_KEY, …
# They are local demo keys. The values are passed to vitest through the
# environment rather than written to .env.local, so a developer's own file is
# never clobbered.
eval "$("${SUPABASE[@]}" status -o env)"

echo "==> Live integration tests (real client against the real stack)"
VITE_SUPABASE_URL="$API_URL" \
VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
VITE_SITE_URL="http://localhost:12000" \
  npx vitest run \
    src/services/dataService.integration.test.ts \
    src/features/arena/operationsFlow.integration.test.ts

echo "==> Server integrity verified"
