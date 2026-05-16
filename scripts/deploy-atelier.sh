#!/usr/bin/env bash
#
# deploy-atelier.sh — bake operator-specific defaults into bundle.html, then
# push it to a configured SSH host. Source code stays clean (empty defaults +
# sentinel strings); the bake + the SSH target are all driven by `.env`.
#
# Usage:
#   bash scripts/deploy-atelier.sh                 # uses ./bundle.html, auto label
#   bash scripts/deploy-atelier.sh <bundle.html>   # explicit bundle
#   bash scripts/deploy-atelier.sh <bundle> <tag>  # explicit bundle + label
#
# What it does (in order):
#   1. Resolve $BUNDLE, $LABEL.
#   2. Load `.env` from the repo root (if present) to populate:
#        NANDAI_LITELLM_URL  → __BAKED_BASE_URL__     (real LiteLLM endpoint)
#        NANDAI_LITELLM_KEY  → __BAKED_API_KEY__      (Bearer key)
#        NANDAI_TOOLS_URL    → __BAKED_TOOLS_URL__    (mcpo middleware)
#        NANDAI_KASMVNC_URL  → __BAKED_KASMVNC_URL__  (Computer pane iframe src)
#        NANDAI_DRIVER_URL   → __BAKED_DRIVER_URL__   (destiny-computer driver)
#        ATELIER_DEPLOY_HOST → SSH target (user@host or alias)
#        ATELIER_DEPLOY_KEY  → optional -i path
#        ATELIER_REMOTE_PATH → file path on host (default /srv/nandai-atelier/index.html)
#        ATELIER_REMOTE_PORT → local port on host (default 3057)
#   3. Copy bundle to a temp file and sed-replace the three sentinels.
#      The source bundle is untouched.
#   4. md5sum the baked copy.
#   5. SCP the baked copy to the target.
#   6. SSH a one-liner: sudo cp it to $ATELIER_REMOTE_PATH, md5sum it,
#      systemctl restart atelier-static.service, smoke-test the port.
#   7. Compare md5; mismatch = hard fail.
#
# Exit codes:
#   0 — deployed, md5 matched, service active
#   1 — bad input (no bundle / no .env / missing required var)
#   2 — SSH host unreachable
#   3 — scp/ssh failed mid-deploy
#   4 — md5 mismatch (corruption in flight)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="${1:-$REPO_ROOT/bundle.html}"
LABEL="${2:-tick$(date -u +%Y%m%d%H%M%S)}"

# ─── 1. Sanity ──────────────────────────────────────────────────────────────
if [ ! -f "$BUNDLE" ]; then
  echo "ERROR: bundle not found at $BUNDLE" >&2
  echo "Run \`npm run build && bash scripts/bundle-artifact.sh\` first." >&2
  exit 1
fi

# ─── 2. Load .env ───────────────────────────────────────────────────────────
ENV_FILE="$REPO_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
else
  echo "WARN: no .env file at $ENV_FILE — bundle will ship with empty defaults." >&2
  echo "      Visitors will be pushed to Settings on first load. To bake your" >&2
  echo "      endpoint, copy .env.example to .env and fill it in." >&2
fi

NANDAI_LITELLM_URL="${NANDAI_LITELLM_URL:-}"
NANDAI_LITELLM_KEY="${NANDAI_LITELLM_KEY:-}"
NANDAI_TOOLS_URL="${NANDAI_TOOLS_URL:-}"
NANDAI_KASMVNC_URL="${NANDAI_KASMVNC_URL:-}"
NANDAI_DRIVER_URL="${NANDAI_DRIVER_URL:-}"

ATELIER_DEPLOY_HOST="${ATELIER_DEPLOY_HOST:-}"
ATELIER_DEPLOY_KEY="${ATELIER_DEPLOY_KEY:-}"
ATELIER_REMOTE_PATH="${ATELIER_REMOTE_PATH:-/srv/nandai-atelier/index.html}"
ATELIER_REMOTE_PORT="${ATELIER_REMOTE_PORT:-3057}"

if [ -z "$ATELIER_DEPLOY_HOST" ]; then
  echo "ERROR: ATELIER_DEPLOY_HOST is not set. Add it to .env or export it." >&2
  exit 1
fi

# ─── 3. Bake sentinels into a working copy (source untouched) ──────────────
WORK_BUNDLE="$(mktemp -t atelier-XXXXXX).html"
trap 'rm -f "$WORK_BUNDLE" "$WORK_BUNDLE.bak"' EXIT

cp "$BUNDLE" "$WORK_BUNDLE"

# Escape any |, &, \ in URLs/keys for sed safety
esc() { printf '%s' "$1" | sed -e 's/[\/&|]/\\&/g'; }

# Always sed each sentinel (empty value → empty string). This keeps the
# sentinel from appearing in the published bundle, which would look like
# a misconfiguration to anyone reading the source. Empty baseUrl + empty
# apiKey + relative paths is the valid "same-origin cookie auth" mode.
sed -i.bak "s|__BAKED_BASE_URL__|$(esc "${NANDAI_LITELLM_URL:-}")|g" "$WORK_BUNDLE"
sed -i.bak "s|__BAKED_API_KEY__|$(esc "${NANDAI_LITELLM_KEY:-}")|g" "$WORK_BUNDLE"
sed -i.bak "s|__BAKED_TOOLS_URL__|$(esc "${NANDAI_TOOLS_URL:-}")|g" "$WORK_BUNDLE"
sed -i.bak "s|__BAKED_KASMVNC_URL__|$(esc "${NANDAI_KASMVNC_URL:-}")|g" "$WORK_BUNDLE"
sed -i.bak "s|__BAKED_DRIVER_URL__|$(esc "${NANDAI_DRIVER_URL:-}")|g" "$WORK_BUNDLE"
rm -f "$WORK_BUNDLE.bak"

# ─── 4. Fingerprint ─────────────────────────────────────────────────────────
LOCAL_MD5=$(md5 -q "$WORK_BUNDLE" 2>/dev/null || md5sum "$WORK_BUNDLE" | awk '{print $1}')
LOCAL_SIZE=$(wc -c < "$WORK_BUNDLE" | tr -d ' ')
LOCAL_KB=$((LOCAL_SIZE / 1024))

echo "[deploy-atelier] bundle=$BUNDLE size=${LOCAL_KB}KB md5=$LOCAL_MD5 label=$LABEL"
echo "[deploy-atelier] target=$ATELIER_DEPLOY_HOST path=$ATELIER_REMOTE_PATH"

# ─── 5. SCP ────────────────────────────────────────────────────────────────
SSH_OPTS=(-o IdentitiesOnly=yes -o ConnectTimeout=10)
SCP_OPTS=(-q -o IdentitiesOnly=yes -o ConnectTimeout=10)
if [ -n "$ATELIER_DEPLOY_KEY" ]; then
  SSH_OPTS+=(-i "$ATELIER_DEPLOY_KEY")
  SCP_OPTS+=(-i "$ATELIER_DEPLOY_KEY")
fi

REMOTE_STAGING="/tmp/atelier-bundle-${LABEL}.html"
if ! scp "${SCP_OPTS[@]}" "$WORK_BUNDLE" "$ATELIER_DEPLOY_HOST:$REMOTE_STAGING"; then
  echo "ERROR: scp to $ATELIER_DEPLOY_HOST:$REMOTE_STAGING failed" >&2
  exit 3
fi
echo "[deploy-atelier] uploaded → $REMOTE_STAGING"

# ─── 6. Install, restart, smoke-test in one SSH round-trip ─────────────────
REMOTE_RESULT=$(ssh "${SSH_OPTS[@]}" "$ATELIER_DEPLOY_HOST" bash -s <<EOF || true
set -e
sudo cp "$REMOTE_STAGING" "$ATELIER_REMOTE_PATH"
REMOTE_MD5=\$(md5sum "$ATELIER_REMOTE_PATH" | awk '{print \$1}')
sudo systemctl restart atelier-static.service 2>/dev/null || true
sleep 1
HTTP_CODE=\$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${ATELIER_REMOTE_PORT}/")
echo "MD5=\$REMOTE_MD5"
echo "HTTP=\$HTTP_CODE"
echo "SVC=\$(systemctl is-active atelier-static.service 2>/dev/null || echo not-managed)"
EOF
)

REMOTE_MD5=$(echo "$REMOTE_RESULT" | grep '^MD5=' | cut -d= -f2)
HTTP_CODE=$(echo "$REMOTE_RESULT" | grep '^HTTP=' | cut -d= -f2)
SVC_STATE=$(echo "$REMOTE_RESULT" | grep '^SVC=' | cut -d= -f2)

if [ -z "$REMOTE_MD5" ]; then
  echo "ERROR: remote install did not report an md5 — ssh chain likely failed" >&2
  echo "Raw output: $REMOTE_RESULT" >&2
  exit 3
fi

# ─── 7. Verify md5 ─────────────────────────────────────────────────────────
if [ "$REMOTE_MD5" != "$LOCAL_MD5" ]; then
  echo "ERROR: md5 mismatch — local=$LOCAL_MD5 remote=$REMOTE_MD5" >&2
  exit 4
fi

echo "[deploy-atelier] OK md5=$LOCAL_MD5 size=${LOCAL_KB}KB http=$HTTP_CODE svc=$SVC_STATE"
