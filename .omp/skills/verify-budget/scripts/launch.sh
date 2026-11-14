#!/usr/bin/env bash
# Start an isolated budget instance: private Postgres + Neon HTTP shim + `next dev`, all on
# 127.0.0.1:41010-41012, running a snapshot of the current checkout with no inherited secrets.
# Prints READY when a seeded user can authenticate through the real DB path.
set -euo pipefail
. "$(dirname "$0")/env.sh"

if [ -f "$RUN/next.pid" ] && kill -0 "$(cat "$RUN/next.pid")" 2>/dev/null; then
  echo "verify-budget already running (pid $(cat "$RUN/next.pid")). Run doctor.sh, or cleanup.sh first." >&2
  exit 1
fi
for p in "$PG_PORT" "$SHIM_PORT" "$APP_PORT"; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $p is already in use by something this skill did not start; refusing. Set VERIFY_BUDGET_*_PORT inside 41000-41099." >&2
    exit 1
  fi
done
[ -x "$PGBIN/initdb" ] || { echo "postgres binaries not found at $PGBIN (brew install postgresql@16 or set VERIFY_BUDGET_PGBIN)" >&2; exit 1; }

rm -rf "$RUN" "$PGDATA"
mkdir -p "$RUN" "$APP" "$TOOLS" "$EVIDENCE"
chmod 700 "$RUN"

echo "[1/7] snapshot checkout -> $APP (no .git, .next, node_modules, .env*)"
rsync -a --delete --exclude /.git --exclude /node_modules --exclude /.next --exclude '.env*' --exclude /.omp "$REPO/" "$APP/"
git -C "$REPO" rev-parse HEAD > "$RUN/commit"
git -C "$REPO" status --porcelain | shasum | cut -d' ' -f1 > "$RUN/dirty"
(cd "$APP" && npm ci --no-audit --no-fund --prefer-offline > "$RUN/npm-ci.log" 2>&1) \
  || { echo "npm ci failed in the snapshot, see $RUN/npm-ci.log" >&2; exit 1; }

echo "[2/7] helper tooling in $TOOLS (playwright-core $PLAYWRIGHT_VERSION drives installed Google Chrome; pg $PG_CLIENT_VERSION for the shim)"
if ! grep -qs "\"version\": \"$PLAYWRIGHT_VERSION\"" "$TOOLS/node_modules/playwright-core/package.json" ||
   ! grep -qs "\"version\": \"$PG_CLIENT_VERSION\"" "$TOOLS/node_modules/pg/package.json"; then
  npm install --prefix "$TOOLS" --no-audit --no-fund "playwright-core@$PLAYWRIGHT_VERSION" "pg@$PG_CLIENT_VERSION" > "$RUN/tools-install.log" 2>&1 \
    || { echo "tool install failed, see $RUN/tools-install.log" >&2; exit 1; }
fi

echo "[3/7] throwaway secrets (local only, mode 600, removed by cleanup)"
( umask 077
  cat > "$RUN/secrets.env" <<EOF
AUTH_SECRET=$(openssl rand -base64 32 | tr -d '\n')
ENCRYPTION_KEY=$(openssl rand -hex 32)
VERIFY_USER_EMAIL=verify@budget.invalid
VERIFY_USER_NAME=Verifier
VERIFY_USER_PASSWORD=$(openssl rand -hex 12)
EOF
)
# shellcheck disable=SC1091
. "$RUN/secrets.env"

echo "[4/7] private postgres on 127.0.0.1:$PG_PORT"
"$PGBIN/initdb" -D "$PGDATA" -U verify --auth=trust -E UTF8 --locale=C > "$RUN/initdb.log" 2>&1
"$PGBIN/pg_ctl" -D "$PGDATA" -l "$RUN/postgres.log" -w \
  -o "-p $PG_PORT -k $RUN -c listen_addresses=127.0.0.1 -c timezone=UTC" start > /dev/null
"$PGBIN/createdb" -h 127.0.0.1 -p "$PG_PORT" -U verify budget

echo "[5/7] schema via the app's drizzle-kit push"
(cd "$APP" && appenv DATABASE_URL="$LOCAL_DB_URL" ./node_modules/.bin/drizzle-kit push --force > "$RUN/db-push.log" 2>&1) \
  || { echo "drizzle-kit push failed, see $RUN/db-push.log" >&2; exit 1; }

echo "[6/7] neon http shim on 127.0.0.1:$SHIM_PORT, then the app's seed script through it"
env -i HOME="$HOME" PATH="$PATH" SHIM_PORT="$SHIM_PORT" SHIM_PG_URL="$LOCAL_DB_URL" TOOLS="$TOOLS" \
  nohup node "$SKILL_DIR/scripts/neon-shim.mjs" > "$RUN/shim.log" 2>&1 &
echo $! > "$RUN/shim.pid"
ps -o lstart= -p "$(cat "$RUN/shim.pid")" > "$RUN/shim.start"  # cleanup.sh refuses a pid whose start time differs
for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$SHIM_PORT/healthz" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fsS "http://127.0.0.1:$SHIM_PORT/healthz" >/dev/null || { echo "shim did not start, see $RUN/shim.log" >&2; exit 1; }
(cd "$APP" && appenv SEED_USER_EMAIL="$VERIFY_USER_EMAIL" SEED_USER_PASSWORD="$VERIFY_USER_PASSWORD" \
  SEED_USER_NAME="$VERIFY_USER_NAME" ./node_modules/.bin/tsx src/db/seed.ts > "$RUN/seed.log" 2>&1) \
  || { echo "seed failed, see $RUN/seed.log" >&2; exit 1; }

echo "[7/7] next dev on $BASE_URL"
(cd "$APP" && appenv nohup ./node_modules/.bin/next dev -H 127.0.0.1 -p "$APP_PORT" > "$RUN/next.log" 2>&1 &
 echo $! > "$RUN/next.pid")
ps -o lstart= -p "$(cat "$RUN/next.pid")" > "$RUN/next.start"

# Ready = the login page renders AND the seeded user authenticates through app -> shim -> postgres.
deadline=$((SECONDS + 240))
until curl -fsS -o /dev/null "$BASE_URL/login" 2>/dev/null; do
  [ $SECONDS -lt $deadline ] || { echo "timed out waiting for /login, see $RUN/next.log" >&2; exit 1; }
  kill -0 "$(cat "$RUN/next.pid")" 2>/dev/null || { echo "next dev exited, see $RUN/next.log" >&2; exit 1; }
  sleep 2
done
check=$(curl -fsS -X POST -H 'content-type: application/json' \
  --data "{\"email\":\"$VERIFY_USER_EMAIL\",\"password\":\"$VERIFY_USER_PASSWORD\"}" "$BASE_URL/api/auth/check") \
  || { echo "seeded user cannot authenticate, see $RUN/next.log and $RUN/shim.log" >&2; exit 1; }
echo "$check" | grep -q '"mfaRequired":false' || { echo "unexpected /api/auth/check reply: $check" >&2; exit 1; }
echo "READY $BASE_URL commit=$(cat "$RUN/commit") run=$RUN evidence=$EVIDENCE"
