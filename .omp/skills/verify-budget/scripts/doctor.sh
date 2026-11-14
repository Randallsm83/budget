#!/usr/bin/env bash
# Read-only health check: is the verify-budget instance worth driving? Exit 0 only if every check passes.
set -uo pipefail
. "$(dirname "$0")/env.sh"
fail=0
ok()  { echo "OK   $*"; }
bad() { echo "FAIL $*"; fail=1; }

owns_port() { # pid port -> true if the pid or one of its descendants listens on port
  local p
  for p in $(pid_tree "$1"); do
    lsof -a -nP -p "$p" -iTCP:"$2" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  done
  return 1
}

[ -f "$RUN/secrets.env" ] || { echo "FAIL no instance: $RUN/secrets.env missing. Run launch.sh."; exit 1; }
# shellcheck disable=SC1091
. "$RUN/secrets.env"

pg_pid=$(head -1 "$PGDATA/postmaster.pid" 2>/dev/null || true)
if [ -n "$pg_pid" ] && owns_port "$pg_pid" "$PG_PORT"; then ok "postgres pid $pg_pid owns :$PG_PORT"; else bad "postgres not listening on :$PG_PORT from $PGDATA"; fi
for svc in shim:$SHIM_PORT next:$APP_PORT; do
  name=${svc%%:*}; port=${svc##*:}
  pid=$(cat "$RUN/$name.pid" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && owns_port "$pid" "$port"; then ok "$name pid $pid owns :$port"
  else bad "$name (pid ${pid:-none}) is not the listener on :$port"; fi
done

users=$("$PGBIN/psql" "$LOCAL_DB_URL" -Atc "select count(*) from users" 2>/dev/null) \
  && ok "local db reachable, users=$users" || bad "cannot query $LOCAL_DB_URL"
served() { curl -fsS "http://127.0.0.1:$SHIM_PORT/healthz" 2>/dev/null | sed -n 's/.*"served":\([0-9]*\).*/\1/p'; }
before=$(served)
[ -n "$before" ] && ok "shim /healthz up (served=$before)" || bad "shim /healthz"

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/login")
[ "$code" = 200 ] && ok "GET /login 200" || bad "GET /login -> $code"
check=$(curl -s -X POST -H 'content-type: application/json' \
  --data "{\"email\":\"$VERIFY_USER_EMAIL\",\"password\":\"$VERIFY_USER_PASSWORD\"}" "$BASE_URL/api/auth/check")
echo "$check" | grep -q '"mfaRequired"' && ok "seeded user authenticates: $check" || bad "POST /api/auth/check -> $check"
# The auth check is a DB read; if it did not reach the shim, the app is talking to some other database.
after=$(served)
[ -n "$before" ] && [ -n "$after" ] && [ "$after" -gt "$before" ] \
  && ok "app DB traffic lands on the local shim (served $before -> $after)" \
  || bad "app DB read did not reach the local shim (served $before -> $after): app may be on another database"

if [ "$(git -C "$REPO" rev-parse HEAD)" = "$(cat "$RUN/commit")" ] &&
   [ "$(git -C "$REPO" status --porcelain | shasum | cut -d' ' -f1)" = "$(cat "$RUN/dirty")" ]; then
  ok "snapshot matches checkout $(cut -c1-7 "$RUN/commit")"
else
  bad "checkout changed since launch (snapshot is $(cut -c1-7 "$RUN/commit")); cleanup.sh && launch.sh to pick it up"
fi

if [ -s "$RUN/egress-blocked.log" ]; then
  echo "WARN blocked egress attempts (the guard worked; the feature that tried it cannot be proven locally):"
  sed 's/^/     /' "$RUN/egress-blocked.log"
else
  ok "no live-service egress attempted"
fi
exit $fail
