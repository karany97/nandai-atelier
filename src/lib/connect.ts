// Connection state + diagnostics. Stored in localStorage so the user doesn't
// have to re-enter the endpoint each load.
//
// Two upstreams:
//   1. LiteLLM gateway (baseUrl + apiKey) — Nandai-One's local Trinity stack.
//      Health = GET /v1/models returns ≥ 1 model id.
//   2. Claude Code bridge (bridgeUrl) — Opus fallback over local Max sub.
//      Health = GET ${bridgeUrl}/health returns 200 + { ok: true }.
//
// Both probes are non-blocking and run on boot. Each surfaces its own status
// so the sidebar pill can say things like:
//   "Nandai-One online · Opus bridge: ready"      (both green)
//   "Nandai-One online · Opus bridge: down"       (gateway up, bridge missing)
//   "Nandai-One unreachable · Opus bridge: ready" (gateway down, bridge fine)

import { listModels, type LiveLLMConfig } from './llm';

const LS_KEY = 'nandai-chat:connection-v2';

export type ConnectStatus =
  | { kind: 'unconfigured' }
  | { kind: 'connecting' }
  | { kind: 'connected'; models: string[]; checkedAt: number }
  | { kind: 'error'; message: string; checkedAt: number };

export type BridgeStatus =
  | { kind: 'unknown' }
  | { kind: 'probing' }
  | { kind: 'ready'; checkedAt: number; version?: string }
  | { kind: 'down'; message: string; checkedAt: number };

export type ToolBridgeStatus =
  | { kind: 'unknown' }
  | { kind: 'probing' }
  | { kind: 'ready'; checkedAt: number; n_tools: number }
  | { kind: 'down'; message: string; checkedAt: number };

export type Connection = {
  /** LiteLLM gateway URL — Nandai-One's local Trinity stack */
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  /** offline = stay scripted even if connected */
  offline: boolean;
  /** Claude Code bridge URL — Opus fallback (default http://127.0.0.1:8765) */
  bridgeUrl: string;
  /** When true, auto-escalate to Opus when Nandai-One returns short/empty/refusal */
  autoEscalate: boolean;
  /** MCP tool-executor middleware (108 tools across 15 mcpo servers) */
  toolBridgeUrl: string;
  /** When true, ship the full tools array on every chat-completions call */
  useTools: boolean;
};

// ─── Deploy-time bake sentinels ────────────────────────────────────────────
// These strings get sed-replaced by scripts/deploy-atelier.sh just before
// the bundle ships, so a private deploy can ship with the operator's real
// endpoint baked in WITHOUT putting it in source.
//
// Why sentinels (not env-var inlining at build time)? Because we want ONE
// `npm run build` to produce a bundle that works for both:
//   - public release (sentinels survive untouched → unbake() returns '' →
//     fresh visitors see Settings → "Open settings to point me at your
//     LiteLLM gateway"), and
//   - private deploy (deploy.sh seds sentinels → real values → bundle
//     boots straight into the operator's stack).
//
// Minification preserves these string literals verbatim, so post-build sed
// against the minified bundle reliably finds them. Comments don't survive
// minification, so the sentinel HAS to be in the string itself.
const BAKED_BASE_URL  = '__BAKED_BASE_URL__';   // deploy.sh: NANDAI_LITELLM_URL
const BAKED_API_KEY   = '__BAKED_API_KEY__';    // deploy.sh: NANDAI_LITELLM_KEY
const BAKED_TOOLS_URL = '__BAKED_TOOLS_URL__';  // deploy.sh: NANDAI_TOOLS_URL

/** If the sentinel is still present (no operator-bake happened), treat as empty. */
function unbake(s: string): string {
  return s.startsWith('__BAKED_') ? '' : s;
}

const DEFAULT: Connection = {
  // NOTE: do NOT append /v1 to baseUrl. listModels() and streamChat() build
  // `${baseUrl}/v1/models` and `${baseUrl}/v1/chat/completions` themselves —
  // appending /v1 here gives /v1/v1/* and 404s.
  baseUrl: unbake(BAKED_BASE_URL),
  apiKey:  unbake(BAKED_API_KEY),
  timeoutMs: 120_000,
  offline: false,
  // Opus bridge runs on the operator's Mac (default Claude Code bridge port).
  bridgeUrl: 'http://127.0.0.1:8765',
  autoEscalate: true,
  toolBridgeUrl: unbake(BAKED_TOOLS_URL),
  useTools: true,
};

export function loadConnection(): Connection {
  if (typeof localStorage === 'undefined') return DEFAULT;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      // Migrate v1 → v2 if present (preserve user's gateway/key)
      const v1 = localStorage.getItem('nandai-chat:connection-v1');
      if (v1) {
        try {
          const parsed = JSON.parse(v1);
          const merged = { ...DEFAULT, ...parsed };
          localStorage.setItem(LS_KEY, JSON.stringify(merged));
          return merged;
        } catch { /* ignore */ }
      }
      return DEFAULT;
    }
    const parsed = JSON.parse(raw);
    return { ...DEFAULT, ...parsed };
  } catch { return DEFAULT; }
}

export function saveConnection(c: Connection): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* quota */ }
}

/** Same-origin endpoints (paths starting with `/`) authenticate via cookies
 *  carried by `credentials: 'include'`, so the apiKey field is optional in
 *  that mode — the upstream proxy injects the master key server-side. */
function isSameOriginPath(baseUrl: string): boolean {
  return baseUrl.startsWith('/');
}

export async function testConnection(c: Connection): Promise<ConnectStatus> {
  if (!c.baseUrl) return { kind: 'unconfigured' };
  // Cookie-auth (relative baseUrl) doesn't need an apiKey — the auth-proxy
  // injects the master key on the server side. Cross-origin (https://) still
  // requires a key because the browser won't share cookies cross-origin.
  if (!isSameOriginPath(c.baseUrl) && !c.apiKey) return { kind: 'unconfigured' };
  const cfg: LiveLLMConfig = { baseUrl: c.baseUrl, apiKey: c.apiKey, timeoutMs: 8_000 };
  try {
    const models = await listModels(cfg);
    return { kind: 'connected', models, checkedAt: Date.now() };
  } catch (e: any) {
    return { kind: 'error', message: e?.message ?? String(e), checkedAt: Date.now() };
  }
}

/** Probe the Claude Code bridge. Bridge MUST expose GET /health → `{ ok: true, version?: string }`. */
export async function testBridge(c: Connection): Promise<BridgeStatus> {
  if (!c.bridgeUrl) return { kind: 'unknown' };
  const url = c.bridgeUrl.replace(/\/+$/, '') + '/health';
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 3_000);
  try {
    const res = await fetch(url, { method: 'GET', signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) {
      return { kind: 'down', message: `HTTP ${res.status}`, checkedAt: Date.now() };
    }
    const body = await res.json().catch(() => ({}));
    if (body?.ok === true) {
      return { kind: 'ready', checkedAt: Date.now(), version: body.version };
    }
    return { kind: 'down', message: 'health endpoint returned ok:false', checkedAt: Date.now() };
  } catch (e: any) {
    clearTimeout(t);
    return { kind: 'down', message: e?.message ?? 'unreachable', checkedAt: Date.now() };
  }
}
