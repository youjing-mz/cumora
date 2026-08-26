#!/usr/bin/env bash
#
# Cloud Agent start step for Cumora.
#
# Per-boot startup for the system daemons the app depends on. Package install,
# dependency install, and DB/role provisioning are one-time work and live in
# install.sh; this script only (re)starts Postgres + Redis and waits until
# they are ready. Idempotent — tolerates already-running services.
set -euo pipefail

# --- Redis ---
if ! redis-cli ping >/dev/null 2>&1; then
  echo "[start] Starting Redis…"
  sudo redis-server /etc/redis/redis.conf --daemonize yes || true
fi

# --- Postgres ---
PG_VER="$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $1}')"
PG_CLUSTER="$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $2}')"
: "${PG_VER:=16}"
: "${PG_CLUSTER:=main}"

if ! pg_lsclusters -h 2>/dev/null | awk '{print $4}' | grep -q online; then
  echo "[start] Starting Postgres cluster $PG_VER/$PG_CLUSTER…"
  sudo pg_ctlcluster "$PG_VER" "$PG_CLUSTER" start || true
fi

echo "[start] Waiting for services to be ready…"
for _ in $(seq 1 30); do
  if pg_isready -q -h localhost -p 5432 && redis-cli ping >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

pg_isready -h localhost -p 5432 && echo "[start] Postgres ready" || echo "[start] WARN: Postgres not ready"
redis-cli ping >/dev/null 2>&1 && echo "[start] Redis ready" || echo "[start] WARN: Redis not ready"
