#!/usr/bin/env bash
# Model-check how Plaid transactions reach the register. SKILL.md explains the results.
#   check.sh              read the statement order from src/, run TLC on every line of
#                         expected.tsv, and compare the results with that file
#   check.sh --self-test  show that every rule can fail, on broken and repaired statement orders
# Exit: 0 as recorded | 1 a result changed | 2 could not run | 3 only the code map changed
set -euo pipefail
export LC_ALL=C

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
out=${XDG_STATE_HOME:-$HOME/.local/state}/verify-budget/formal-plaid-sync/$(date +%Y%m%dT%H%M%S)-$$
jar=${TLA_JAR:-$HOME/.cache/tlaplus/tla2tools-1.7.4.jar}
jar_sha256=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
java_tool=java@temurin-21.0.13+9.0.LTS

sync_ts=src/lib/plaid-sync.ts
repair_ts=src/app/api/plaid/repair/route.ts
clear_ts=src/app/api/plaid/clear-account-transactions/route.ts
covered=("$sync_ts" "$repair_ts" "$clear_ts" src/app/api/plaid/sync/route.ts
  src/app/api/plaid/webhook/route.ts src/app/api/plaid/exchange-token/route.ts
  src/db/index.ts src/db/schema.ts)
# Every file that calls syncTransactions or writes import_connections.cursor.
known_touching="src/app/api/plaid/create-accounts/route.ts
src/app/api/plaid/exchange-token/route.ts
src/app/api/plaid/repair/route.ts
src/app/api/plaid/sync/route.ts
src/app/api/plaid/webhook/route.ts
src/lib/actions.ts
src/lib/plaid-sync.ts"

die() { echo "check.sh: $*" >&2; exit 2; }

# ---- tools ----------------------------------------------------------------
[ -f "$jar" ] || die "no TLC jar at $jar. Fetch the v1.7.4 release:
  mkdir -p ~/.cache/tlaplus && curl -fsSL -o ~/.cache/tlaplus/tla2tools-1.7.4.jar https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"
if command -v sha256sum >/dev/null 2>&1; then sha=$(sha256sum "$jar"); else sha=$(shasum -a 256 "$jar"); fi
[ "${sha%% *}" = "$jar_sha256" ] || die "$jar is not tla2tools.jar v1.7.4 (sha256 ${sha%% *})"
if [ -n "${JAVA_BIN:-}" ]; then java=$JAVA_BIN
else java=$(mise where "$java_tool" 2>/dev/null || true)/bin/java; fi
[ -x "$java" ] || die "no Java. Run: mise install $java_tool   (or set JAVA_BIN to a Java 11+ binary)"

# ---- code map: source files -> CodeShape.tla ------------------------------
# one FILE TEXT FROM TO: the number of the only line in FROM..TO of FILE that contains TEXT.
one() {
  local n
  n=$(awk -v a="$3" -v b="$4" -v s="$2" 'NR >= a && NR <= b && index($0, s) { print NR }' "$root/$1")
  [ "$(printf '%s' "$n" | grep -c .)" = 1 ] ||
    die "code map: want exactly one \"$2\" in $1 lines $3-$4, found at: ${n:-nowhere}. See SKILL.md, \"When the code map stops\"."
  echo "$n"
}
# "LINE name" pairs on stdin -> "name", "name", ... in line order
in_order() { sort -n | awk '{ printf "%s\"%s\"", (NR > 1 ? ", " : ""), $2 } END { print "" }'; }

read_code() {
  local a b ins upd del cur body sync wipe reset load
  a=$(one "$sync_ts" 'export async function syncTransactions(' 1 100000)
  b=$(awk -v a="$a" 'NR > a && /^}/ { print NR; exit }' "$root/$sync_ts")
  ins=$(one "$sync_ts" 'db.insert(transactions)' "$a" "$b")
  upd=$(one "$sync_ts" 'db.update(transactions)' "$a" "$b")
  del=$(one "$sync_ts" 'db.delete(transactions)' "$a" "$b")
  cur=$(one "$sync_ts" '.set({ cursor' "$a" "$b")
  apply=$(printf '%s insert\n%s update\n%s delete\n%s cursor\n' "$ins" "$upd" "$del" "$cur" | in_order)
  body=$(awk -v a="$a" -v b="$b" 'NR >= a && NR <= b' "$root/$sync_ts")
  case $body in
    *onConflictDoNothing*) conflict=nothing ;;
    *onConflictDoUpdate*) conflict=update ;;
    *) conflict=error ;;
  esac

  sync=$(one "$repair_ts" 'await syncTransactions(' 1 100000)
  wipe=$(one "$repair_ts" '.delete(transactions)' 1 100000)
  reset=$(one "$repair_ts" 'cursor: null' 1 100000)
  # The rows that reach syncTransactions come from the last read before the call.
  load=$(awk -v b="$sync" 'NR < b && index($0, "importConnections.find") { n = NR } END { print n }' "$root/$repair_ts")
  [ -n "$load" ] || die "code map: $repair_ts does not read importConnections before it calls syncTransactions"
  repair=$(printf '%s load\n%s wipe\n%s reset\n%s sync\n' "$load" "$wipe" "$reset" "$sync" | in_order)

  wipe=$(one "$clear_ts" '.delete(transactions)' 1 100000)
  reset=$(awk 'index($0, "cursor: null") { print NR }' "$root/$clear_ts")
  [ "$(printf '%s' "$reset" | grep -c .)" -le 1 ] || die "code map: more than one \"cursor: null\" in $clear_ts"
  clear=$({ echo "$wipe wipe"; [ -z "$reset" ] || echo "$reset reset"; } | in_order)
}

# write_shape DIR APPLY CONFLICT REPAIR CLEAR
write_shape() {
  mkdir -p "$1"
  cat > "$1/CodeShape.tla" <<EOF
----------------------------- MODULE CodeShape -----------------------------
\* Written by check.sh from the source files. Do not edit by hand:
\* run check.sh, and copy its CodeShape.tla here once you agree with it.
ApplySteps == <<$2>>
OnConflict == "$3"
RepairSteps == <<$4>>
ClearSteps == <<$5>>
=============================================================================
EOF
}

# ---- TLC ------------------------------------------------------------------
# cell DIR SCENARIO RULE: run TLC once with DIR/CodeShape.tla.
# Leaves pass | violated | error in DIR/SCENARIO-RULE/result, and TLC's output in tlc.log.
cell() {
  local d=$1/$2-$3 code=0
  mkdir -p "$d/tmp"
  cp "$here/model/PlaidSync.tla" "$1/CodeShape.tla" "$d/"
  { grep -v '^INVARIANTS' "$here/model/$2.cfg"; echo "INVARIANTS TypeOK $3"; } > "$d/$2-$3.cfg"
  # A private tmpdir: TLC unpacks its standard modules there, and parallel runs collide in a shared one.
  (cd "$d" && "$java" -XX:+UseParallelGC -Xmx1g -Djava.io.tmpdir="$d/tmp" -cp "$jar" tlc2.TLC \
    -workers 1 -fp 0 -metadir "$d/states" -config "$2-$3.cfg" PlaidSync.tla) > "$d/tlc.log" 2>&1 || code=$?
  rm -rf "$d/tmp" "$d/states"
  if [ "$code" = 0 ] && grep -q 'No error has been found' "$d/tlc.log"; then echo pass
  elif [ "$code" = 12 ] && grep -q "Invariant $3 is violated" "$d/tlc.log"; then echo violated
  else echo error; fi > "$d/result"
}

changed=0 errors=0
# report NAME WANT DIR NOTE: one line of the result table; counts what differs.
report() {
  local got mark=$4
  read -r got < "$3/result"
  if [ "$got" = error ]; then errors=$((errors + 1)); mark="<-- TLC did not finish: $3/tlc.log"
  elif [ "$got" != "$2" ]; then
    changed=$((changed + 1))
    if [ "$got" = violated ]; then mark="<-- NEW VIOLATION, trace in $3/tlc.log"
    else mark="<-- no longer violated (was: $4)"; fi
  fi
  printf '%-40s %-9s %-9s %s\n' "$1" "$2" "$got" "$mark"
}

self_test() {
  local A='"insert", "update", "delete", "cursor"' R='"load", "wipe", "reset", "sync"' C='"wipe"'
  local table name scen rule want apply conflict repair clear
  # name | scenario | rule | expected | ApplySteps | OnConflict | RepairSteps | ClearSteps
  table="broken: cursor saved first|Crash|NoMissing|violated|\"cursor\", \"insert\", \"update\", \"delete\"|nothing|$R|$C
broken: removed loop dropped|Serial|NoGhost|violated|\"insert\", \"update\", \"cursor\"|nothing|$R|$C
broken: modified loop dropped|Serial|NoStale|violated|\"insert\", \"delete\", \"cursor\"|nothing|$R|$C
broken: conflict clause dropped|Crash|NoRejectedInsert|violated|$A|error|$R|$C
repaired: insert updates on conflict|Crash|NoStale|pass|$A|update|$R|$C
not enough: insert updates on conflict|Overlap|NoStale|violated|$A|update|$R|$C
repaired: Repair reads rows after reset|Repair|NoMissing|pass|$A|nothing|\"wipe\", \"reset\", \"load\", \"sync\"|$C
repaired: Clear resets the cursor|Clear|NoMissing|pass|$A|nothing|$R|\"wipe\", \"reset\""
  while IFS='|' read -r name scen rule want apply conflict repair clear; do
    write_shape "$out/${name//[: ]/-}" "$apply" "$conflict" "$repair" "$clear"
    cell "$out/${name//[: ]/-}" "$scen" "$rule" &
  done <<< "$table"
  wait
  printf '%-40s %-9s %-9s %s\n' "statement order" expected got "scenario/rule"
  while IFS='|' read -r name scen rule want apply conflict repair clear; do
    report "$name" "$want" "$out/${name//[: ]/-}/$scen-$rule" "$scen/$rule"
  done <<< "$table"
  echo "evidence: $out"
  [ "$errors" = 0 ] || exit 2
  [ "$changed" = 0 ] || { echo "SELF-TEST FAILED: the model lost the ability to tell these orders apart."; exit 1; }
  echo "self-test ok: each rule fails on its broken order, and each repaired order passes."
}

# ---- main -----------------------------------------------------------------
mkdir -p "$out"
if [ "${1:-}" = --self-test ]; then self_test; exit 0; fi

read_code
write_shape "$out" "$apply" "$conflict" "$repair" "$clear"
drift=0
if ! cmp -s "$here/model/CodeShape.tla" "$out/CodeShape.tla"; then
  drift=1
  echo "CODE MAP CHANGED: src/ no longer runs the statements in the recorded order (< recorded, > now):"
  diff "$here/model/CodeShape.tla" "$out/CodeShape.tla" || true
  echo
fi
(cd "$root" && grep -rlE 'await syncTransactions\(|cursor: null|\.set\(\{ cursor' src | sort) > "$out/touching.txt"
if [ "$(< "$out/touching.txt")" != "$known_touching" ]; then
  drift=1
  echo "CODE MAP CHANGED: the files that call syncTransactions or write the cursor (< recorded, > now):"
  diff <(echo "$known_touching") "$out/touching.txt" || true
  echo
fi
# shellcheck disable=SC2016  # the backticks are Markdown, not a command
sync_commit=$(sed -n 's/^Sync commit: `\([0-9a-f]*\)`.*/\1/p' "$here/SKILL.md")
if [ -n "$sync_commit" ] && git -C "$root" cat-file -e "$sync_commit^{commit}" 2>/dev/null; then
  stat=$(cd "$root" && git diff --stat "$sync_commit" -- "${covered[@]}")
  [ -z "$stat" ] || printf 'NOTICE: covered files differ from sync commit %s. Read that diff before you trust a pass:\n%s\n\n' "${sync_commit:0:7}" "$stat"
else
  printf 'NOTICE: sync commit %s is not in this checkout, so check.sh cannot list what changed since.\n\n' "${sync_commit:-(none recorded)}"
fi

while IFS=$'\t' read -r scen rule want note; do
  case $scen in '' | '#'*) continue ;; esac
  cell "$out" "$scen" "$rule" &
done < "$here/expected.tsv"
wait
total=0 findings=0
printf '%-40s %-9s %-9s %s\n' scenario/rule expected got ""
while IFS=$'\t' read -r scen rule want note; do
  case $scen in '' | '#'*) continue ;; esac
  total=$((total + 1))
  [ "$want" != violated ] || findings=$((findings + 1))
  report "$scen/$rule" "$want" "$out/$scen-$rule" "${note:-}"
done < "$here/expected.tsv"
echo
echo "$total checks, $findings known findings, $changed changed, $errors errors. Evidence: $out"

[ "$errors" = 0 ] || exit 2
if [ "$changed" != 0 ]; then
  echo "RESULT CHANGED. SKILL.md, \"Read the result\", says how to tell a bug from a modeling error."
  exit 1
fi
if [ "$drift" != 0 ]; then
  echo "Results are as recorded, but the code map changed. SKILL.md, \"Update the verification\"."
  exit 3
fi
echo "OK: the code gives the recorded results."
