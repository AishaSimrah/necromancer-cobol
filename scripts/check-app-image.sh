#!/usr/bin/env bash
# Builds Dockerfile.app and checks the image in four run configurations.
# Usage: ./scripts/check-app-image.sh
#
# 1. Node version: the image must run Node 22 (esbuild target node22). Fails fast.
# 2. default, --tmpfs /tmp, read-only root: each must reach oracle "ready" within 60 s.
# 3. noexec: Work_Root on a noexec tmpfs must give status "degraded" (oracle "unavailable")
#    and a log line naming the Work_Root path.
# Prints image size and idle memory (docker stats --no-stream) for each run.
set -euo pipefail

# Git Bash on Windows would rewrite "/tmp" style arguments into Windows paths.
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."

IMAGE=necromancer-app
POLL_SECONDS=60
CONTAINERS=()

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found. Install Docker first." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "docker daemon is not reachable. Start Docker first." >&2
  exit 1
fi

cleanup() {
  local c
  for c in "${CONTAINERS[@]:-}"; do
    [ -n "$c" ] && docker rm -f "$c" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Host URL of the container's port 10000 (published on a random loopback port).
host_url() {
  local mapping
  mapping="$(docker port "$1" 10000/tcp | head -n 1)"
  echo "http://127.0.0.1:${mapping##*:}"
}

# Polls /api/health?probe=1 until the body matches $2 (an extended regex) or 60 s pass.
# Prints the last body on success. Returns 1 on timeout.
poll_health() {
  local name="$1" pattern="$2" url body="" i
  url="$(host_url "$name")"
  for ((i = 0; i < POLL_SECONDS; i++)); do
    body="$(curl -fsS --max-time 5 "$url/api/health?probe=1" 2>/dev/null || true)"
    if [ -n "$body" ] && echo "$body" | grep -Eq "$pattern"; then
      echo "$body"
      return 0
    fi
    sleep 1
  done
  echo "last health body: ${body:-<none>}" >&2
  return 1
}

# Starts a detached container. Args: label, then extra docker run options.
start() {
  local label="$1"
  shift
  local name="necromancer-check-${label}-$$"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" -p 127.0.0.1::10000 "$@" "$IMAGE" >/dev/null
  CONTAINERS+=("$name")
  echo "$name"
}

report_memory() {
  echo "idle memory: $(docker stats --no-stream --format '{{.MemUsage}} ({{.MemPerc}})' "$1")"
}

stop() {
  docker rm -f "$1" >/dev/null
}

# Requests each static asset and fails unless the status is 200.
check_static_assets() {
  local name="$1" url path code
  url="$(host_url "$name")"
  for path in /app.js /app.css /fonts/jetbrains-mono-400.woff2 /decor/skeleton.svg; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url$path" || true)"
    [ "$code" = "200" ] || fail "static asset $path returned HTTP ${code:-none}, expected 200"
    echo "asset ok: $path"
  done
}

expect_ready() {
  local label="$1"
  shift
  echo "== ${label}: expect oracle ready =="
  local name body
  name="$(start "$label" "$@")"
  if ! body="$(poll_health "$name" '"oracle" *: *"ready"')"; then
    docker logs "$name" >&2 || true
    fail "${label}: oracle not ready within ${POLL_SECONDS}s"
  fi
  echo "health: $body"
  check_static_assets "$name"
  report_memory "$name"
  stop "$name"
  echo "ok: ${label}"
}

echo "== build $IMAGE =="
docker build -f Dockerfile.app -t "$IMAGE" .
echo "image size: $(docker image inspect "$IMAGE" --format '{{.Size}}' | awk '{ printf "%.1f MB\n", $1 / 1000000 }')"

echo "== node version =="
NODE_VERSION="$(docker run --rm --entrypoint node "$IMAGE" --version)" \
  || fail "node does not run in the image"
echo "node: $NODE_VERSION"
case "$NODE_VERSION" in
  v22*) ;;
  *) fail "expected Node v22.x, got '$NODE_VERSION'" ;;
esac

expect_ready default

expect_ready tmpfs-tmp --tmpfs /tmp

expect_ready read-only \
  --read-only --tmpfs /tmp \
  --tmpfs /home/necro/work:rw,exec,nosuid,uid=10001,gid=10001,mode=0700,size=128m

echo "== noexec: expect degraded and a log line naming the work root =="
NOEXEC_ROOT=/tmp/work
name="$(start noexec --tmpfs /tmp:rw,noexec -e "NECROMANCER_WORK_ROOT=${NOEXEC_ROOT}")"
if ! body="$(poll_health "$name" '"status" *: *"degraded"')"; then
  docker logs "$name" >&2 || true
  fail "noexec: health did not become degraded within ${POLL_SECONDS}s"
fi
echo "health: $body"
echo "$body" | grep -Eq '"oracle" *: *"unavailable"' \
  || fail "noexec: expected oracle \"unavailable\" in $body"
if ! docker logs "$name" 2>&1 | grep -F "work root ${NOEXEC_ROOT}" | grep -q "does not allow executing"; then
  docker logs "$name" >&2 || true
  fail "noexec: log line naming ${NOEXEC_ROOT} not found"
fi
echo "log: $(docker logs "$name" 2>&1 | grep -F "work root ${NOEXEC_ROOT}" | head -n 1)"
report_memory "$name"
stop "$name"
echo "ok: noexec"

echo
echo "All image checks passed."
