#!/usr/bin/env bash
#
# apply-litellm-proxy.sh
#
# Applies the LiteLLM same-origin auth-proxy patch to mythos-gate-atelier
# on the .213 infra box. Run this from the Mac (it ssh's in).
#
# What it does:
#   1. Backs up the current $HOME/services/mythos-gate/app.py
#   2. Patches in the LITELLM_* env-var block + new @app.api_route handler
#      (idempotent — checks for marker; skips if already applied)
#   3. Backs up + updates /etc/systemd/system/mythos-gate-atelier.service
#      with new LITELLM_* env vars
#   4. systemctl daemon-reload + restart mythos-gate-atelier
#   5. Smoke-test: curl localhost:3058/api/llm/v1/models with a freshly
#      minted gate cookie; expect 200 + a JSON model list
#
# Exit codes:
#   0 — patched, service restarted, smoke-test passed
#   1 — backup failed (refuses to proceed without rollback path)
#   2 — patch markers not found (mythos-gate version drift)
#   3 — service failed to restart
#   4 — smoke-test failed (rollback recommended)

set -euo pipefail

HOST="${1:-operator@(internal-tailscale)}"

ssh -o IdentitiesOnly=yes "$HOST" bash -s <<'REMOTE'
set -euo pipefail

APP=$HOME/services/mythos-gate/app.py
UNIT=/etc/systemd/system/mythos-gate-atelier.service
TS=$(date -u +%Y%m%d-%H%M%S)

# ─── 1. Backups ─────────────────────────────────────────────────────────────
cp "$APP" "${APP}.bak-${TS}"
sudo cp "$UNIT" "${UNIT}.bak-${TS}"
echo "[1/5] backed up app.py → ${APP}.bak-${TS}"
echo "[1/5] backed up unit  → ${UNIT}.bak-${TS}"

# ─── 2. Patch app.py ───────────────────────────────────────────────────────
if grep -q "LITELLM_MASTER_KEY" "$APP"; then
  echo "[2/5] patch already present in app.py — skipping"
else
  # Insert env-var block after the EXTRA_HEADERS line
  python3 <<'PY'
import re

APP = "$HOME/services/mythos-gate/app.py"
src = open(APP).read()

ENV_BLOCK = '''
# ─── LiteLLM proxy (auth-proxy mode) ──────────────────────────────────────
LITELLM_INTERNAL = os.environ.get("LITELLM_INTERNAL", "http://127.0.0.1:8008")
LITELLM_MASTER_KEY = os.environ.get("LITELLM_MASTER_KEY", "")
LITELLM_PROXY_PATH = os.environ.get("LITELLM_PROXY_PATH", "/api/llm")
LITELLM_ALLOWED_ORIGIN = os.environ.get("LITELLM_ALLOWED_ORIGIN", "")
'''

HANDLER_BLOCK = '''
# ─── LiteLLM auth-proxy route ───────────────────────────────────────────────
if LITELLM_MASTER_KEY:

    @app.api_route(
        LITELLM_PROXY_PATH + "/{path:path}",
        methods=["GET", "POST", "OPTIONS"],
    )
    async def litellm_proxy(request: Request, path: str) -> Response:
        if request.method == "OPTIONS":
            return Response(
                status_code=204,
                headers={
                    "access-control-allow-origin": request.headers.get("origin", "*"),
                    "access-control-allow-methods": "GET, POST, OPTIONS",
                    "access-control-allow-headers": "content-type, authorization",
                    "access-control-allow-credentials": "true",
                    "access-control-max-age": "86400",
                },
            )

        cookie = request.cookies.get(COOKIE_NAME)
        if not _verify(cookie):
            return Response(
                content='{"error":"unauthorized","detail":"gate cookie missing or invalid"}',
                status_code=401,
                media_type="application/json",
            )

        if LITELLM_ALLOWED_ORIGIN:
            origin = request.headers.get("origin", "")
            if origin and origin != LITELLM_ALLOWED_ORIGIN:
                return Response(
                    content='{"error":"forbidden","detail":"origin not allowed"}',
                    status_code=403,
                    media_type="application/json",
                )

        upstream_url = f"{LITELLM_INTERNAL}/{path}"
        if request.url.query:
            upstream_url += "?" + request.url.query

        headers = {
            k: v for k, v in request.headers.items()
            if k.lower() not in HOP_BY_HOP and k.lower() != "authorization"
        }
        headers["authorization"] = f"Bearer {LITELLM_MASTER_KEY}"
        headers.pop("cookie", None)

        body = await request.body()

        is_stream = (
            path.endswith("chat/completions")
            and body
            and (b'"stream":true' in body or b'"stream": true' in body)
        )

        timeout = httpx.Timeout(600.0, connect=10.0, read=600.0)
        client = httpx.AsyncClient(timeout=timeout, follow_redirects=False)

        if is_stream:
            async def streamer():
                try:
                    async with client.stream(
                        method=request.method,
                        url=upstream_url,
                        headers=headers,
                        content=body,
                    ) as r:
                        async for chunk in r.aiter_raw():
                            yield chunk
                finally:
                    await client.aclose()

            return StreamingResponse(
                streamer(),
                status_code=200,
                media_type="text/event-stream",
                headers={
                    "cache-control": "no-cache",
                    "x-accel-buffering": "no",
                    "access-control-allow-origin": request.headers.get("origin", "*"),
                    "access-control-allow-credentials": "true",
                },
            )

        try:
            r = await client.request(
                method=request.method,
                url=upstream_url,
                headers=headers,
                content=body,
            )
        except httpx.RequestError as e:
            await client.aclose()
            return Response(
                content=f'{{"error":"upstream_unreachable","detail":"{e}"}}',
                status_code=502,
                media_type="application/json",
            )
        await client.aclose()

        _STRIP = HOP_BY_HOP | {"content-encoding", "content-length"}
        resp_headers = {
            k: v for k, v in r.headers.items() if k.lower() not in _STRIP
        }
        resp_headers["access-control-allow-origin"] = request.headers.get("origin", "*")
        resp_headers["access-control-allow-credentials"] = "true"

        return Response(
            content=r.content,
            status_code=r.status_code,
            headers=resp_headers,
        )
'''

# 1) Insert env block after EXTRA_HEADERS = ... line
m1 = re.search(r"^EXTRA_HEADERS\s*=.*$", src, re.MULTILINE)
if not m1:
    print("ERROR: could not find EXTRA_HEADERS marker in app.py", file=__import__('sys').stderr)
    raise SystemExit(2)
src = src[:m1.end()] + "\n" + ENV_BLOCK + src[m1.end():]

# 2) Insert handler block before the catch-all proxy. Anchor: the
# "@app.api_route(\"/{path:path}\", methods=" line.
catchall = re.search(r"^@app\.api_route\(\"/\{path:path\}\", methods=", src, re.MULTILINE)
if not catchall:
    print("ERROR: could not find catch-all proxy marker in app.py", file=__import__('sys').stderr)
    raise SystemExit(2)
src = src[:catchall.start()] + HANDLER_BLOCK + "\n\n" + src[catchall.start():]

open(APP, "w").write(src)
print("  app.py patched ({} bytes)".format(len(src)))
PY
  echo "[2/5] patched app.py"
fi

# ─── 3. Update systemd unit ─────────────────────────────────────────────────
if sudo grep -q "LITELLM_MASTER_KEY" "$UNIT"; then
  echo "[3/5] unit already has LITELLM_* env vars — skipping"
else
  sudo python3 <<'PY'
UNIT = "/etc/systemd/system/mythos-gate-atelier.service"
src = open(UNIT).read()

block = """
# Auth-proxy mode (NEW 2026-05-16) — same-origin /api/llm/* proxy
Environment=LITELLM_INTERNAL=http://127.0.0.1:8008
Environment=LITELLM_MASTER_KEY=sk-1234
Environment=LITELLM_PROXY_PATH=/api/llm
Environment=LITELLM_ALLOWED_ORIGIN=https://atelier.nandai.org
"""
# Insert before the ExecStart line
src = src.replace("ExecStart=", block + "\nExecStart=", 1)
open(UNIT, "w").write(src)
PY
  echo "[3/5] patched $UNIT"
fi

# ─── 4. Daemon-reload + restart ─────────────────────────────────────────────
sudo systemctl daemon-reload
sudo systemctl restart mythos-gate-atelier.service
sleep 2
STATE=$(systemctl is-active mythos-gate-atelier.service)
if [ "$STATE" != "active" ]; then
  echo "[4/5] ERROR: mythos-gate-atelier failed to restart (state=$STATE)" >&2
  echo "Last 20 log lines:" >&2
  journalctl -u mythos-gate-atelier.service --no-pager -n 20 >&2
  exit 3
fi
echo "[4/5] mythos-gate-atelier active"

# ─── 5. Smoke-test ─────────────────────────────────────────────────────────
# Forge a valid gate cookie (HMAC-SHA256 over a future timestamp)
COOKIE=$(python3 -c '
import hmac, hashlib, time
secret = b"***REDACTED-rotated-2026-05-16***"
value = str(int(time.time()) + 3600)
sig = hmac.new(secret, value.encode(), hashlib.sha256).hexdigest()
print(value + "." + sig)
')

HTTP=$(curl -s -o /tmp/proxy-smoketest.json -w "%{http_code}" \
  -H "Cookie: mythos-atelier=$COOKIE" \
  -H "Origin: https://atelier.nandai.org" \
  http://127.0.0.1:3058/api/llm/v1/models)

if [ "$HTTP" = "200" ]; then
  MODELS=$(python3 -c 'import json; d=json.load(open("/tmp/proxy-smoketest.json")); print(",".join(m["id"] for m in d.get("data", [])[:5]))')
  echo "[5/5] OK http=200, models=[$MODELS]"
  rm -f /tmp/proxy-smoketest.json
  exit 0
else
  echo "[5/5] FAIL http=$HTTP" >&2
  cat /tmp/proxy-smoketest.json >&2
  rm -f /tmp/proxy-smoketest.json
  exit 4
fi
REMOTE
