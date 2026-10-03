#!/usr/bin/env bash
# Boots the production server the way the Dockerfile's CMD does, against the Postgres in
# DATABASE_URL, waits for /api/health (the compose healthcheck's URL: it answers once Postgres does), then stops it with SIGTERM
# as `docker stop` does and requires it to exit by itself, with code 0, within STOP_SECONDS.
# Run after `pnpm build` with the production environment set (CI's "Smoke boot" step).
# server.prod.ts and src/db/migrate.ts run unbundled under Node's type stripping, so a syntax it
# can't strip, a missing file in the image or a failing migration only shows when they start; and a
# server that doesn't stop on SIGTERM would make every deploy wait for Docker's SIGKILL.
# Keep the command below the same as the Dockerfile's CMD and the compose `command`.
set -euo pipefail

port="${PORT:-3000}"
stop_seconds="${STOP_SECONDS:-15}"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

sh -c 'node src/db/migrate.ts && exec node server.prod.ts' >"$log" 2>&1 &
pid=$!

# Running, not just present: an exited child stays a zombie (and answers `kill -0`) until reaped.
alive() {
  local state
  state="$(ps -o stat= -p "$pid" 2>/dev/null)" || return 1
  [[ -n "$state" && "$state" != Z* ]]
}

ok=
for _ in $(seq 1 60); do
  if curl --silent --fail --max-time 2 "http://127.0.0.1:${port}/api/health" >/dev/null; then
    ok=1
    break
  fi
  # Gone already: it exited (a migration or env error, say) and won't ever answer.
  alive || break
  sleep 1
done

# Stop it as Docker does, and give it a bound: a process that outlives SIGTERM is the failure.
hung=
if alive; then
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 $((stop_seconds * 4))); do
    alive || break
    sleep 0.25
  done
  if alive; then
    hung=1
    kill -KILL "$pid" 2>/dev/null || true
  fi
fi
code=0
wait "$pid" 2>/dev/null || code=$?

echo "::group::server log"
cat "$log"
echo "::endgroup::"

if [ -z "$ok" ]; then
  echo "::error title=Smoke boot failed::The production server did not answer /api/health (log above)"
  exit 1
fi
if [ -n "$hung" ]; then
  echo "::error title=Smoke boot failed::The server was still running ${stop_seconds}s after SIGTERM and was killed (log above)"
  exit 1
fi
if [ "$code" -ne 0 ]; then
  echo "::error title=Smoke boot failed::The server exited with code ${code} after SIGTERM, not 0 (log above)"
  exit 1
fi
echo "Smoke boot ok: migrations applied, /api/health answered, SIGTERM stopped the server cleanly"
