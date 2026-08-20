#!/usr/bin/env bash
set -euo pipefail

# Push the current branch, copy the operator-only local env file, and deploy
# that exact branch on the prepared Ubuntu host. The remote working tree is
# deliberately kept clean so a deploy can never overwrite uncommitted work.

REMOTE_HOST="${REMOTE_HOST:?Set REMOTE_HOST to the deployment host before running this script}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/cumora}"
BRANCH="${1:-$(git branch --show-current)}"
ADMIN_ENV_FILE="${ADMIN_ENV_FILE:-.env.local}"

if [[ -z "$BRANCH" || "$BRANCH" == "HEAD" || ! "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "Invalid branch: $BRANCH" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Local worktree is not clean; commit changes before deploying." >&2
  git status --short >&2
  exit 1
fi

if [[ ! -f "$ADMIN_ENV_FILE" ]]; then
  echo "Missing $ADMIN_ENV_FILE; refusing to deploy without the admin env file." >&2
  exit 1
fi

echo "Pushing $BRANCH to origin…"
git push origin "$BRANCH"

echo "Copying $ADMIN_ENV_FILE to $REMOTE_HOST:$REMOTE_DIR/.env.local…"
scp "$ADMIN_ENV_FILE" "$REMOTE_HOST:$REMOTE_DIR/.env.local"

ssh "$REMOTE_HOST" bash -s -- "$REMOTE_DIR" "$BRANCH" <<'REMOTE'
set -euo pipefail

deploy_dir="$1"
deploy_branch="$2"
cd "$deploy_dir"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Remote tracked worktree is not clean; refusing to overwrite it." >&2
  git status --short >&2
  exit 1
fi

git fetch origin "$deploy_branch"
if git show-ref --verify --quiet "refs/heads/$deploy_branch"; then
  git checkout "$deploy_branch"
else
  git checkout -b "$deploy_branch" "origin/$deploy_branch"
fi
if git merge-base --is-ancestor "$deploy_branch" "origin/$deploy_branch"; then
  git pull --ff-only origin "$deploy_branch"
else
  echo "Remote branch history diverged; aligning the clean checkout to origin/$deploy_branch."
  git reset --hard "origin/$deploy_branch"
fi

chmod 600 "$deploy_dir/.env.local"

sudo -n install -d /etc/systemd/system/cumora.service.d
sudo -n tee /etc/systemd/system/cumora.service.d/env-local.conf >/dev/null <<SYSTEMD
[Service]
EnvironmentFile=-$deploy_dir/.env.local
SYSTEMD
sudo -n systemctl daemon-reload

npm ci
npm ci --prefix workers/email-gate

# .env.production points at the public API host. The colocated nginx build
# must use relative /api URLs, so temporarily hide that file for this build.
production_env=".env.production"
if [[ -f "$production_env" ]]; then
  hidden_env="$(mktemp /tmp/cumora-env-production.XXXXXX)"
  mv "$production_env" "$hidden_env"
  restore_env() {
    mv "$hidden_env" "$production_env"
  }
  trap restore_env EXIT
fi
env -u VITE_CUMORA_API_BASE npm run build
if [[ -n "${hidden_env:-}" ]]; then
  restore_env
  trap - EXIT
fi

sudo -n systemctl restart cumora
sudo -n systemctl reload nginx
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1/api/health; then
    echo
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    echo "Cumora did not become healthy after restart." >&2
    exit 1
  fi
  sleep 1
done
echo "deployed $(git rev-parse --short HEAD) on $deploy_branch"
REMOTE
