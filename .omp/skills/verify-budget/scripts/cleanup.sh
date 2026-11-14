#!/usr/bin/env bash
# Tear down what launch.sh started and delete scratch state. Evidence under $EVIDENCE is never
# touched; server logs are archived into it first.
# A recorded PID is signalled only if it is still the process launch.sh started: same start time
# (`ps -o lstart`, recorded at launch) and this run's command line / working directory. A stale
# pid file pointing at a reused PID is refused, never killed.
# Usage: cleanup.sh [--all]   (--all also removes the playwright-core/pg cache in $TOOLS)
set -uo pipefail
. "$(dirname "$0")/env.sh"

if [ -d "$RUN" ]; then
  logs="$EVIDENCE/run-logs-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$logs"
  for f in next.log shim.log seed.log db-push.log postgres.log egress-blocked.log commit; do
    [ -f "$RUN/$f" ] && cp "$RUN/$f" "$logs/"
  done
  echo "archived run logs -> $logs"
fi

is_ours() { # name pid -> 0 only if pid is the process this run started
  local name=$1 pid=$2 want got cmd cwd
  want=$(cat "$RUN/$name.start" 2>/dev/null) || { echo "REFUSE $name pid $pid: no recorded start time"; return 1; }
  got=$(ps -o lstart= -p "$pid" 2>/dev/null) || { echo "skip $name pid $pid: not running"; return 2; }
  if [ "$got" != "$want" ]; then
    echo "REFUSE $name pid $pid: started '$got' but launch recorded '$want' (PID reused?)"; return 1
  fi
  cmd=$(ps -o command= -p "$pid" 2>/dev/null)
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  case $name in
    next) [ "$cwd" = "$APP" ] && [[ $cmd == *next* ]] ;;
    shim) [[ $cmd == *"$SKILL_DIR/scripts/neon-shim.mjs"* ]] ;;
    *) false ;;
  esac || { echo "REFUSE $name pid $pid: command '$cmd' / cwd '$cwd' do not belong to this run"; return 1; }
}

for name in next shim; do
  pid=$(cat "$RUN/$name.pid" 2>/dev/null || true)
  [ -n "$pid" ] || continue
  is_ours "$name" "$pid"; rc=$?
  [ "$rc" = 0 ] || { [ "$rc" = 1 ] && refused=1; continue; }
  # Descendants of the verified root are ours. Remember each one's start time so the SIGKILL
  # pass below cannot hit a PID that exited and was reused in between.
  pids=$(pid_tree "$pid")
  starts=""
  for p in $pids; do starts="$starts$p=$(ps -o lstart= -p "$p" 2>/dev/null | tr ' ' _);"; done
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null && echo "stopped $name (pids: $(echo $pids))"
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
  for p in $pids; do
    now=$(ps -o lstart= -p "$p" 2>/dev/null | tr ' ' _)
    [ -n "$now" ] && case "$starts" in *"$p=$now;"*) kill -9 "$p" 2>/dev/null && echo "force-killed $name pid $p" ;; esac
  done
done

# pg_ctl only acts on the postmaster recorded in this run's own data directory.
if [ -f "$PGDATA/postmaster.pid" ]; then
  "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null && echo "stopped postgres ($PGDATA)"
fi

rm -rf "$RUN" "$APP" "$PGDATA"
[ "${1:-}" = "--all" ] && rm -rf "$TOOLS"

busy=${refused:-0}
for p in "$PG_PORT" "$SHIM_PORT" "$APP_PORT"; do
  if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then echo "WARN port $p still has a listener"; busy=1; fi
done
echo "cleanup done; evidence kept in $EVIDENCE"
exit $busy
