# Shared by run.sh and its own checks (lib-checks.sh): process and port handling for the browser checks.
# Only ever stops this run's own server (its process group, started with setsid), never a port owner or PID 0, and
# always keeps the run's real exit status (Codex 2026-11-07).

# port_free PORT: 0 when nothing listens on it.
port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# stop_server PID: stops the process group PID leads (setsid), if it is still there.
stop_server() {
  local pid="${1:-}"
  [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null || return 0
  kill -TERM -- "-$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 -- "-$pid" 2>/dev/null || return 0; sleep 0.5; done
  kill -KILL -- "-$pid" 2>/dev/null || true
}

# cleanup: the EXIT trap. Keeps the exit status; never stops halfway.
cleanup() {
  local status=$?
  set +e
  stop_server "${SERVER:-}"
  [ -n "${WORK:-}" ] && rm -rf "$WORK"
  exit "$status"
}
