#!/usr/bin/env bash
# Checks for scripts/browser/lib.sh (Codex 2026-11-07): cleanup keeps the run's exit status and always removes the work
# folder, even when the server already stopped, was never started, or a cleanup step fails; it stops only this run's
# own process group; an occupied port is detected. Uses only throwaway sleep processes and a local listener.
set -u
LIB="$(cd "$(dirname "$0")" && pwd)/lib.sh"
fails=0; checks=0
ok() { checks=$((checks+1)); if eval "$1"; then :; else echo "FAIL $2"; fails=$((fails+1)); fi; }

# 1. Passing run, server already gone: status 0, work folder removed.
W=$(mktemp -d); sleep 0.1 & DEAD=$!; wait $DEAD
bash -c "set -euo pipefail; . '$LIB'; SERVER=$DEAD; WORK='$W'; trap cleanup EXIT; exit 0"; s=$?
ok "[ $s -eq 0 ] && [ ! -e '$W' ]" "a passing run with its server already stopped stays passing (status $s) and removes its folder"

# 2. Failure before the server was started: status kept, nothing else killed (this script must survive), folder removed.
W=$(mktemp -d)
bash -c "set -euo pipefail; . '$LIB'; SERVER=''; WORK='$W'; trap cleanup EXIT; exit 3"; s=$?
ok "[ $s -eq 3 ] && [ ! -e '$W' ]" "a failure before the server started keeps its status (3, got $s) and removes its folder"

# 3. A cleanup step that fails does not change the result.
W=$(mktemp -d)
bash -c "set -euo pipefail; . '$LIB'; SERVER=''; WORK='$W'; rm() { return 1; }; trap cleanup EXIT; exit 0"; s=$?
ok "[ $s -eq 0 ]" "a failing cleanup step leaves a passing run passing (got $s)"
command rm -rf "$W"

# 4. stop_server stops its own process group (leader and children) and nothing else.
setsid bash -c 'sleep 60 & sleep 60' & OWN=$!
sleep 60 & OTHER=$!
sleep 0.5
bash -c ". '$LIB'; stop_server $OWN"
sleep 0.3
ok "! kill -0 -- -$OWN 2>/dev/null" "stop_server stops its own group"
ok "kill -0 $OTHER 2>/dev/null" "stop_server leaves an unrelated process alone"
kill $OTHER 2>/dev/null

# 5. stop_server never acts on an empty id, 0 or 1.
for bad in "" 0 1; do bash -c ". '$LIB'; stop_server '$bad'"; done
ok "kill -0 $$ 2>/dev/null" "stop_server with an empty id, 0 or 1 does nothing"

# 6. port_free sees a listener.
PORT=38211
node -e "require('net').createServer().listen($PORT,'127.0.0.1')" & L=$!
sleep 0.8
bash -c ". '$LIB'; port_free $PORT"; busy=$?
kill $L; wait $L 2>/dev/null; sleep 0.3
bash -c ". '$LIB'; port_free $PORT"; free=$?
ok "[ $busy -ne 0 ] && [ $free -eq 0 ]" "port_free: in use ($busy) then free ($free)"

if [ $fails -gt 0 ]; then echo "browser lib checks: $fails of $checks FAILED"; exit 1; fi
echo "browser lib checks: $checks checks pass"
