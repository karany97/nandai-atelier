# Auth-proxy — same-origin cookie auth for atelier

> The default deploy ships the bundle with **no LiteLLM master key**.
> Instead, the bundle uses same-origin `fetch('/api/llm/v1/*')` calls
> that the operator's reverse-proxy validates against the existing gate
> cookie and forwards to LiteLLM with the master key injected server-side.

This is the operator-grade default. The legacy "bake the key into the
bundle" path still works but is documented as a caveated fallback because
the bundle JS is visible to anyone who can render it.

## Why same-origin

Before: bundle had `Authorization: Bearer sk-1234` baked in. PIN gate
prevented strangers from *loading* the bundle, but once loaded the master
key was visible in DevTools. A fully-public deploy (no PIN gate) would
leak the key on first visit.

After: bundle has no key. It calls `fetch('/api/llm/v1/chat/completions',
{ credentials: 'include' })`. Browser carries the existing gate cookie
to the same-origin endpoint. The proxy validates the cookie, strips any
client `Authorization` header, injects the master key from a private env
var, then forwards to LiteLLM. Bundle JS is now safe to ship publicly —
the worst a stranger can do is get 401s from `/api/llm/*`.

## The mythos-gate-atelier patch

The reference implementation extends the existing `mythos-gate-atelier`
PIN gate (FastAPI) with a new `/api/llm/{path:path}` route mounted
before the catch-all proxy.

Drop-in patch script:

```bash
# 1. Copy the patch + apply script
scp scripts/apply-litellm-proxy.sh operator@your-infra-host:~

# 2. Run it
ssh operator@your-infra-host bash apply-litellm-proxy.sh
```

Patched route handler does (in order):

1. **OPTIONS preflight** — returns `204` with CORS headers (`Access-Control-*`)
2. **Cookie verify** — HMAC-SHA256 check (same `_verify()` as the static-file proxy)
3. **Origin allow-list** — if `LITELLM_ALLOWED_ORIGIN` is set, rejects mismatched `Origin`
4. **Strip client auth** — removes any `Authorization` header the bundle sent
5. **Inject master key** — adds `Authorization: Bearer ${LITELLM_MASTER_KEY}` from systemd env
6. **Strip cookie** — removes `Cookie` header so LiteLLM logs don't see it
7. **Stream** — if the path is `chat/completions` and body has `"stream":true`, uses `httpx.AsyncClient.stream()` and `StreamingResponse` for SSE pass-through; otherwise one round-trip

Systemd env vars added to `mythos-gate-atelier.service`:

```ini
Environment=LITELLM_INTERNAL=http://127.0.0.1:8008
Environment=LITELLM_MASTER_KEY=sk-replace-with-your-key
Environment=LITELLM_PROXY_PATH=/api/llm
Environment=LITELLM_ALLOWED_ORIGIN=https://atelier.your-domain.com
```

## Bundle-side changes

Two files in `src/lib/`:

- **`connect.ts`** — `testConnection()` allows empty `apiKey` when the
  `baseUrl` starts with `/` (same-origin cookie mode). Default
  `baseUrl=''` so a fresh visitor still goes through Settings.

- **`llm.ts`** — `listModels()` and `streamChat()` use `isSameOriginPath()`
  to choose:
  - **Same-origin**: `credentials: 'include'`, no `Authorization` header
    (the proxy will inject it server-side)
  - **Cross-origin**: `Authorization: Bearer ${apiKey}`, no credentials

The connect.ts `unbake()` sentinel mechanism is unchanged; only the
*meaning* of empty values shifted.

## Smoke testing the proxy

Forge a valid gate cookie with the same secret as systemd:

```bash
COOKIE=$(python3 -c '
import hmac, hashlib, time
secret = b"<your-MYTHOS_GATE_SECRET-here>"   # match the systemd env on your gate
value = str(int(time.time()) + 3600)
sig = hmac.new(secret, value.encode(), hashlib.sha256).hexdigest()
print(value + "." + sig)
')

# Models
curl -s -H "Cookie: mythos-atelier=$COOKIE" \
  -H "Origin: https://atelier.your-domain.com" \
  https://atelier.your-domain.com/api/llm/v1/models

# A real chat completion
curl -s -H "Cookie: mythos-atelier=$COOKIE" \
  -H "Origin: https://atelier.your-domain.com" \
  -H "Content-Type: application/json" \
  -d '{"model":"nandai-fast","messages":[{"role":"user","content":"hi"}],"max_tokens":10,"stream":false}' \
  https://atelier.your-domain.com/api/llm/v1/chat/completions
```

Expected: HTTP 200 on both, model list on the first, real reply on the second.

## Threat model

| Attack | Mitigation |
|---|---|
| Strange browser loads bundle from atelier.your-domain.com | PIN gate still required to load the bundle; the bundle itself has no exploitable key |
| Strange browser hits `/api/llm/v1/*` without a cookie | Proxy returns `401 unauthorized` |
| CSRF — attacker page tries to call `/api/llm/*` from a different domain | `Access-Control-Allow-Origin` allow-list rejects; cookie has `SameSite=Lax` |
| Cookie theft via XSS | Bundle has no inline scripts, no third-party CDNs, no eval; CSP recommended in operator deploy |
| Master key leaked to LiteLLM access logs | Proxy strips `Cookie` header before forwarding |
| Replay of a stale cookie | Cookie value is a unix timestamp; expired cookies fail `_verify()` |

## What's still on the operator

- **Set `LITELLM_MASTER_KEY` in systemd, not in any file under version control.**
  The `.env` in the atelier repo can leave `NANDAI_LITELLM_KEY` empty.
- **Rotate `MYTHOS_GATE_SECRET` and `LITELLM_MASTER_KEY` yearly** (or after
  any compromise) and restart the gate.
- **Keep PIN gate enabled** until you've thought through what a fully-public
  atelier looks like for your hosting cost — the auth-proxy guards the LLM
  budget, not the visitor count.

## Falling back to bake-the-key mode

If your hosting model can't support a same-origin proxy (e.g. you serve the
bundle from GitHub Pages and LiteLLM lives on a different domain), set
`NANDAI_LITELLM_URL` to the absolute URL and `NANDAI_LITELLM_KEY` to the
master key. The bundle will detect the absolute URL and switch to Bearer
auth automatically. The key WILL be visible to anyone who loads the bundle,
so plan your access control accordingly.
