#!/usr/bin/env bash
# Shared paths and ports for the verify-budget helpers. Sourced by the other scripts.
SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPO=$(cd "$SKILL_DIR/../../.." && pwd)
STATE=${XDG_STATE_HOME:-$HOME/.local/state}/verify-budget
RUN=$STATE/run            # pids, logs, throwaway secrets (deleted by cleanup)
APP=$STATE/app            # snapshot of the checkout the server runs from (deleted by cleanup)
PGDATA=$STATE/pgdata      # private Postgres cluster (deleted by cleanup)
TOOLS=$STATE/tools        # playwright-core install (kept as a cache; cleanup.sh --all removes it)
EVIDENCE=$STATE/evidence  # proof artifacts (never deleted by cleanup)

PG_PORT=${VERIFY_BUDGET_PG_PORT:-41010}
SHIM_PORT=${VERIFY_BUDGET_SHIM_PORT:-41011}
APP_PORT=${VERIFY_BUDGET_APP_PORT:-41012}
BASE_URL=http://127.0.0.1:$APP_PORT

PGBIN=${VERIFY_BUDGET_PGBIN:-/opt/homebrew/opt/postgresql@16/bin}
PLAYWRIGHT_VERSION=1.65.1
PG_CLIENT_VERSION=8.23.1   # node-postgres for neon-shim.mjs

# TCP URL for drizzle-kit and evidence queries.
LOCAL_DB_URL=postgresql://verify@127.0.0.1:$PG_PORT/budget
# URL the app sees. Neon's driver turns it into https://api.verify-budget.invalid/sql, which
# egress-guard.cjs reroutes to the local shim. `.invalid` never resolves, so without the guard
# the request fails instead of reaching a real database.
APP_DB_URL=postgresql://verify:verify@db.verify-budget.invalid/budget

export SKILL_DIR REPO STATE RUN APP PGDATA TOOLS EVIDENCE PG_PORT SHIM_PORT APP_PORT BASE_URL \
  PGBIN PLAYWRIGHT_VERSION PG_CLIENT_VERSION LOCAL_DB_URL APP_DB_URL

# Run a command with ONLY the variables listed here plus the arguments: no inherited Plaid,
# Neon, Anthropic, OpenAI or gateway credentials can reach the app.
# It execs, replacing the calling shell: always call it inside ( ... ) or as `appenv ... &`,
# which also makes `$!` the app's own pid (cleanup.sh verifies that pid's command line).
appenv() {
  # shellcheck disable=SC1091
  . "$RUN/secrets.env"
  exec env -i HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" LANG=en_US.UTF-8 \
    NODE_OPTIONS="--require $SKILL_DIR/scripts/egress-guard.cjs" \
    VERIFY_BUDGET_SHIM_URL="http://127.0.0.1:$SHIM_PORT/sql" \
    VERIFY_BUDGET_EGRESS_LOG="$RUN/egress-blocked.log" \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="$APP_DB_URL" \
    AUTH_SECRET="$AUTH_SECRET" AUTH_TRUST_HOST=true \
    AUTH_URL="$BASE_URL" NEXTAUTH_URL="$BASE_URL" \
    ENCRYPTION_KEY="$ENCRYPTION_KEY" \
    PLAID_ENV=sandbox PLAID_CLIENT_ID= PLAID_SECRET= PLAID_SANDBOX_SECRET= \
    "$@"
}

# PIDs of a process and all its descendants (children first).
pid_tree() {
  local c
  for c in $(pgrep -P "$1" 2>/dev/null); do pid_tree "$c"; done
  echo "$1"
}
