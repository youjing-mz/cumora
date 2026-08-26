#!/usr/bin/env bash
#
# Cloud Agent install step for Cumora.
#
# Idempotent, durable, source-tied setup that produces the baseline the agent
# boots from: system services (Postgres + Redis), Node dependencies (root +
# the email-gate Worker), a local Postgres role/database, and a local .env.
# Per-boot process startup lives in start.sh; the dev servers live in the
# `terminals` of environment.json.
#
# Assumes the standard Cloud Agent Ubuntu image (passwordless sudo, `ubuntu`
# user). Safe to run repeatedly.
set -euo pipefail

cd "$(dirname "$0")/.."

DB_USER="${USER:-ubuntu}"

echo "[install] Ensuring system packages (postgresql, redis-server)…"
if ! command -v psql >/dev/null 2>&1 || ! command -v redis-server >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    postgresql postgresql-contrib redis-server
fi

echo "[install] Installing Node dependencies (root + workers/email-gate)…"
npm run setup

# --- Postgres: bring the cluster up so we can provision role + database ---
PG_VER="$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $1}')"
PG_CLUSTER="$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $2}')"
: "${PG_VER:=16}"
: "${PG_CLUSTER:=main}"

if ! pg_lsclusters -h 2>/dev/null | awk '{print $4}' | grep -q online; then
  sudo pg_ctlcluster "$PG_VER" "$PG_CLUSTER" start || true
fi

echo "[install] Waiting for Postgres to accept connections…"
for _ in $(seq 1 30); do
  if sudo -u postgres psql -tAc 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "[install] Ensuring role '$DB_USER' and database 'cumora'…"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE \"$DB_USER\" WITH LOGIN SUPERUSER;"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='cumora'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" cumora
fi

# Password-less local TCP auth so the default DATABASE_URL
# (postgres://$USER@localhost:5432/cumora) connects without a password — the
# README's documented local-dev convention. Dev VM only.
HBA="$(sudo -u postgres psql -tAc 'SHOW hba_file')"
sudo sed -i -E 's@^(host[[:space:]]+all[[:space:]]+all[[:space:]]+127\.0\.0\.1/32[[:space:]]+)(scram-sha-256|md5|peer)@\1trust@' "$HBA"
sudo sed -i -E 's@^(host[[:space:]]+all[[:space:]]+all[[:space:]]+::1/128[[:space:]]+)(scram-sha-256|md5|peer)@\1trust@' "$HBA"
sudo pg_ctlcluster "$PG_VER" "$PG_CLUSTER" reload || true

# --- Local .env (never overwrite a developer/secret-provided one) ---
# The server hard-requires OPENAI_API_KEY to boot (server/src/env.ts). A real
# key set as a Cloud Agent secret lands in the process environment and wins
# over this file (dotenv semantics). The placeholder only lets the app boot,
# seed its starter team, and serve the UI/API when no key is configured.
if [ ! -f .env ]; then
  echo "[install] Writing local .env"
  cat > .env <<EOF
DATABASE_URL=postgres://$DB_USER@localhost:5432/cumora
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=sk-local-dev-placeholder
EOF
fi

echo "[install] Done."
