// MCP tool bridge — talks to the tool-executor middleware (mcpo) at the
// URL configured in Settings → Tools (e.g. https://tools.example.com or
// http://localhost:8767 on the same host as mcpo). The chat fetches the
// OpenAI-shape
// `tools: [...]` array at boot, ships it on every chat-completions request,
// then round-trips any tool_calls back through /execute and feeds the
// results to the model as `role: 'tool'` messages until the model emits
// `finish_reason: 'stop'`.
//
// Anti-hallucination contract:
//   • Only this module touches /tools and /execute.
//   • Every tool result rendered in the UI is the verbatim JSON the
//     middleware returned. No fabrication. No fake `{ok: true}` placeholders.
//   • If the middleware is unreachable, the chat falls back to the original
//     "result pending" amber pane (no tool loop, no execution).

import type { ToolDefinition, ToolCallSpec, ChatMessage } from './llm';

export type ToolBridgeCfg = {
  baseUrl: string;     // e.g. https://tools.example.com or http://localhost:8767
  apiKey?: string;     // optional Bearer
  timeoutMs?: number;
};

export type ExecResult = {
  call_id: string | null;
  tool_name: string;
  ok: boolean;
  status_code: number;
  latency_ms: number;
  result: unknown | null;
  result_id: string | null;
  truncated: boolean;
  bytes_total: number;
  error: string | null;
};

const strip = (u: string) => u.replace(/\/+$/, '');

export async function fetchTools(cfg: ToolBridgeCfg): Promise<ToolDefinition[]> {
  const url = `${strip(cfg.baseUrl)}/tools`;
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), cfg.timeoutMs ?? 8_000);
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    if (!res.ok) throw new Error(`fetchTools HTTP ${res.status}`);
    const body = await res.json();
    // Executor returns either { tools: [...] } (current shape) or a bare array
    // (older shape). Accept both.
    const arr = Array.isArray(body) ? body : (body as any)?.tools;
    if (!Array.isArray(arr)) throw new Error('fetchTools: unexpected shape');
    return arr as ToolDefinition[];
  } finally { clearTimeout(t); }
}

export async function executeToolCalls(
  cfg: ToolBridgeCfg,
  calls: { call_id: string; tool_name: string; args: Record<string, unknown> }[],
  signal?: AbortSignal,
): Promise<ExecResult[]> {
  const url = `${strip(cfg.baseUrl)}/execute`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const body = JSON.stringify({ calls });
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), cfg.timeoutMs ?? 120_000);
  if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true });
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: ac.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`executeToolCalls HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const out = await res.json();
    return (out.results ?? []) as ExecResult[];
  } finally { clearTimeout(t); }
}

/** Convert ExecResults into OpenAI `role: 'tool'` messages for the next turn. */
export function resultsToToolMessages(specs: ToolCallSpec[], results: ExecResult[]): ChatMessage[] {
  const byId = new Map<string, ExecResult>();
  for (let i = 0; i < specs.length; i++) {
    const r = results[i];
    if (r) byId.set(specs[i].id, r);
  }
  return specs.map((spec) => {
    const r = byId.get(spec.id);
    const content = r
      ? (r.ok
          ? (typeof r.result === 'string' ? r.result : JSON.stringify(r.result))
          : `tool error: ${r.error || `HTTP ${r.status_code}`}`)
      : `tool result unavailable (executor did not return a result for ${spec.id})`;
    return {
      role: 'tool',
      tool_call_id: spec.id,
      name: spec.function.name,
      content,
    } as ChatMessage;
  });
}

export type ChatTurnLog = {
  id: string;
  ts: number;                  // seconds since epoch
  session_id: string;
  user_prompt: string;
  model_response: string;
  brain_route?: string;
  tool_calls?: Array<{ name: string; result_present: boolean }>;
  latency_ms?: number;
  tokens_out?: number;
};

/** Fire-and-forget POST every completed assistant turn to the sentinel inbox.
 *  Never blocks the chat; swallows network errors. */
export async function logChatTurn(cfg: ToolBridgeCfg, turn: ChatTurnLog): Promise<void> {
  try {
    const url = `${strip(cfg.baseUrl)}/log-turn`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(turn),
      // Don't await; even on error we silently drop — the sentinel is a
      // best-effort observability surface, never user-blocking.
      keepalive: true,
    });
  } catch { /* swallow */ }
}

export type SentinelVerdict = {
  axes?: Record<string, { verdict: string; why?: string; span?: string }>;
  failed_axes?: string[];
  suggested_action?: string;
  turn_id?: string;
  ts?: number;
  [k: string]: any;
};

/** Fetch the sentinel verdict for one turn id. Returns null if not yet judged. */
export async function fetchSentinelVerdict(cfg: ToolBridgeCfg, turnId: string): Promise<SentinelVerdict | null> {
  try {
    const url = `${strip(cfg.baseUrl)}/sentinel/${encodeURIComponent(turnId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as SentinelVerdict;
  } catch { return null; }
}

/** Health probe — used by the connection pill in the sidebar. */
export async function probeToolBridge(cfg: ToolBridgeCfg): Promise<{
  kind: 'ready' | 'down';
  n_tools?: number;
  message?: string;
}> {
  try {
    const url = `${strip(cfg.baseUrl)}/health`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return { kind: 'down', message: `HTTP ${res.status}` };
    const body = await res.json();
    if (body?.ok && typeof body?.n_tools === 'number') {
      return { kind: 'ready', n_tools: body.n_tools };
    }
    return { kind: 'down', message: 'health endpoint returned ok:false' };
  } catch (e: any) {
    return { kind: 'down', message: e?.message ?? 'unreachable' };
  }
}
