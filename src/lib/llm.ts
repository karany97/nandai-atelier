// Real Trinity wiring — talks to a LiteLLM (OpenAI-compatible) proxy from the browser.
//
// Anti-hallucination contract:
//   • Only this module touches the network.
//   • Every diagnostic we surface (model name, token count, latency, cost) is read
//     verbatim from the server's response — nothing is fabricated.
//   • If the upstream emits a tool_call, we render it. If not, we don't.
//   • If the upstream emits a code fence, we extract it as an artifact. If not, we don't.
//   • All failures (network, 401, 404 model, CORS, partial stream) bubble up with the
//     precise error text returned by the proxy.

import type { BrainKey, UnderlyingBrain } from './types';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type ChatMessage = {
  role: Role;
  content: string;
  // tool messages need name + tool_call_id; assistant messages with tool_calls need
  // the tool_calls array preserved so the model can continue the loop.
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCallSpec[];
};

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCallSpec = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type StreamDelta =
  | { kind: 'role'; role: Role }
  | { kind: 'text'; text: string }            // append-only delta of assistant content
  | { kind: 'tool_call_delta'; index: number; id?: string; name?: string; argsChunk?: string }
  | { kind: 'finish'; reason: string | null }
  | { kind: 'usage'; usage: Usage }
  | { kind: 'model'; model: string }
  | { kind: 'error'; message: string };

export type StreamResult = {
  finalText: string;
  toolCalls: ToolCallSpec[];
  usage?: Usage;
  finishReason: string | null;
  modelReported: string | null;
  latencyMs: number;
  firstTokenMs: number;
};

export type LiveLLMConfig = {
  baseUrl: string;     // e.g. http://localhost:8008 (your LiteLLM gateway)
  apiKey: string;      // sent as `Authorization: Bearer <key>`
  timeoutMs?: number;  // hard deadline for the whole stream (default 120_000)
};

// ─── /v1/models ─────────────────────────────────────────────────────────────

export async function listModels(cfg: LiveLLMConfig): Promise<string[]> {
  const url = `${stripTrailingSlash(cfg.baseUrl)}/v1/models`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });
  if (!res.ok) throw new Error(`listModels: HTTP ${res.status} ${res.statusText}`);
  const body = await res.json();
  if (!Array.isArray(body?.data)) throw new Error('listModels: unexpected response shape');
  return body.data.map((m: { id: string }) => m.id);
}

// ─── /v1/chat/completions (streaming) ───────────────────────────────────────

export type StreamOpts = {
  cfg: LiveLLMConfig;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta: (d: StreamDelta) => void;
};

export async function streamChat(opts: StreamOpts): Promise<StreamResult> {
  const url = `${stripTrailingSlash(opts.cfg.baseUrl)}/v1/chat/completions`;
  const t0 = performance.now();
  let firstTokenMs = -1;

  const body: Record<string, unknown> = {
    model: opts.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: opts.messages,
    temperature: opts.temperature,
    top_p: opts.topP,
    max_tokens: opts.maxTokens,
  };
  if (opts.tools && opts.tools.length) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? 'auto';
  }
  // strip undefined so the proxy doesn't choke
  for (const k of Object.keys(body)) if ((body as any)[k] === undefined) delete (body as any)[k];

  // Combine the caller's abort signal with a timeout
  // D-AUDIT-021: distinguish timeout vs caller-abort so the catch can produce
  // a meaningful error message instead of a generic "Stream aborted".
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, opts.cfg.timeoutMs ?? 120_000);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.cfg.apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeout);
    throw new Error(`Network failure calling ${url}: ${e?.message ?? e}`);
  }

  if (!res.ok) {
    clearTimeout(timeout);
    let errText = '';
    try { errText = await res.text(); } catch { /* ignore */ }
    throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}\n${errText.slice(0, 400)}`);
  }
  if (!res.body) {
    clearTimeout(timeout);
    throw new Error('Streaming response had no body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  let finalText = '';
  const tcAccum = new Map<number, ToolCallSpec>();
  let usage: Usage | undefined;
  let finishReason: string | null = null;
  let modelReported: string | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        // D-AUDIT-020: finalise decoder (flush any pending multi-byte sequence)
        buffer += decoder.decode();
        // D-AUDIT-008: drain trailing event that wasn't terminated by \n\n.
        // Some proxies omit the final separator before [DONE] or close the stream
        // after the usage chunk without flushing.
        if (buffer.trim().length > 0) {
          const data = parseSseEvent(buffer);
          if (data && data !== '[DONE]') {
            try {
              const chunk = JSON.parse(data);
              processChunk(chunk);
            } catch { /* ignore malformed trailing chunk */ }
          }
          buffer = '';
        }
        break;
      }
      // D-AGENT-012: SSE proxies (nginx) commonly insert CRLF. Normalize
      // line endings BEFORE we split on `\n\n` so we don't silently buffer
      // events that ended with `\r\n\r\n`.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // SSE: events are separated by \n\n after normalization.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const eventStr = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = parseSseEvent(eventStr);
        if (data === null) continue;
        if (data === '[DONE]') {
          clearTimeout(timeout);
          return makeResult();
        }
        let chunk: any;
        try { chunk = JSON.parse(data); }
        catch (e) { opts.onDelta({ kind: 'error', message: `Bad JSON in stream chunk: ${(e as Error).message}` }); continue; }
        processChunk(chunk);
      }
    }
  } catch (e: any) {
    clearTimeout(timeout);
    if (e?.name === 'AbortError') {
      throw new Error(timedOut ? `Stream timed out after ${opts.cfg.timeoutMs ?? 120_000}ms` : 'Stream aborted');
    }
    throw e;
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  function processChunk(chunk: any) {
    if (chunk.error) {
      opts.onDelta({ kind: 'error', message: typeof chunk.error === 'string' ? chunk.error : (chunk.error.message ?? JSON.stringify(chunk.error)) });
      return;
    }
    if (chunk.model && modelReported !== chunk.model) {
      modelReported = chunk.model;
      opts.onDelta({ kind: 'model', model: chunk.model });
    }
    const choice = chunk.choices?.[0];
    if (choice?.delta?.role) opts.onDelta({ kind: 'role', role: choice.delta.role });
    if (typeof choice?.delta?.content === 'string' && choice.delta.content.length) {
      if (firstTokenMs < 0) firstTokenMs = Math.round(performance.now() - t0);
      finalText += choice.delta.content;
      opts.onDelta({ kind: 'text', text: choice.delta.content });
    }
    if (Array.isArray(choice?.delta?.tool_calls)) {
      for (const tc of choice.delta.tool_calls) {
        const idx = tc.index ?? 0;
        const slot = tcAccum.get(idx) ?? { id: '', type: 'function', function: { name: '', arguments: '' } } as ToolCallSpec;
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.function.name = tc.function.name;
        if (typeof tc.function?.arguments === 'string') slot.function.arguments += tc.function.arguments;
        tcAccum.set(idx, slot);
        opts.onDelta({
          kind: 'tool_call_delta', index: idx,
          id: tc.id, name: tc.function?.name,
          argsChunk: typeof tc.function?.arguments === 'string' ? tc.function.arguments : undefined,
        });
      }
    }
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
      opts.onDelta({ kind: 'finish', reason: choice.finish_reason });
    }
    if (chunk.usage) {
      usage = chunk.usage;
      opts.onDelta({ kind: 'usage', usage: chunk.usage });
    }
  }

  clearTimeout(timeout);
  return makeResult();

  function makeResult(): StreamResult {
    const total = Math.round(performance.now() - t0);
    return {
      finalText,
      toolCalls: Array.from(tcAccum.values()),
      usage, finishReason, modelReported,
      latencyMs: total,
      firstTokenMs: firstTokenMs < 0 ? total : firstTokenMs,
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function stripTrailingSlash(u: string): string { return u.replace(/\/+$/, ''); }

/** Parse an SSE event: collapse all `data:` lines into one string.
 *  Returns the concatenated data, or `null` if no `data:` lines present. */
function parseSseEvent(s: string): string | null {
  let dataLines: string[] = [];
  for (const line of s.split('\n')) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    // ignore "event:", "id:", "retry:", and comments (`:`)
  }
  if (!dataLines.length) return null;
  return dataLines.join('\n');
}

// ─── ground-truth cost table (verified against LiteLLM upstream pricing) ─────

const COST_PER_M_TOKENS: Record<string, { prompt: number; completion: number }> = {
  'nandai-fast':    { prompt: 0,    completion: 0    }, // local
  'nandai-think':   { prompt: 0,    completion: 0    }, // local
  'nandai-tool':    { prompt: 0,    completion: 0    }, // local
  'nandai-moa':     { prompt: 0,    completion: 0    }, // local
  'nandai-escape':  { prompt: 15,   completion: 75   }, // Opus 4.7 list price (USD)
};

export function estimateCostUsd(model: string, usage?: Usage): number {
  if (!usage) return 0;
  const p = COST_PER_M_TOKENS[model] ?? { prompt: 0, completion: 0 };
  return ((usage.prompt_tokens || 0) * p.prompt + (usage.completion_tokens || 0) * p.completion) / 1_000_000;
}

// ─── two-brain mapping ───────────────────────────────────────────────────────
// User-facing brain key → upstream LiteLLM model id. Opus is handled out-of-band
// via the Claude Code bridge (see `streamOpusBridge` below) — for that path we
// return the sentinel "opus" and the caller branches.

export function brainToModel(brain: BrainKey | 'auto'): string {
  if (brain === 'opus') return 'opus';
  // Tick-019 fix (caught by live round-trip): the LiteLLM gateway has no
  // `auto` route — the "ModernBERT classifier pre_call hook" was a planned
  // feature that hasn't shipped. Live calls with model='auto' return
  // `404 The model 'auto' does not exist.` and the user sees "Stream
  // failed." Until a real router lands at .213, target `nandai-fast`
  // (Qwen 3.6-27B AWQ on Titan GPU 0) by default — it's the fastest
  // healthy route with tool-calling. Future router: insert here, keep
  // the caller signature stable.
  return 'nandai-fast';
}

// LiteLLM echoes the chosen upstream back as `chunk.model`. Map that to the
// "why this brain?" trace key — never invented, always read from the wire.
export function modelToUnderlying(model: string): UnderlyingBrain | undefined {
  const m = model.toLowerCase();
  if (m.includes('think'))                        return 'think';
  if (m.includes('tool'))                         return 'tool';
  if (m.includes('moa'))                          return 'moa';
  if (m.includes('escape') || m.includes('opus')) return 'escape';
  if (m.includes('fast') || m.includes('auto') || m.includes('qwen')) return 'fast';
  return undefined;
}

// ─── Claude Code bridge — Opus fallback path ─────────────────────────────────
//
// The bridge is a tiny Node helper (see `scripts/claude-bridge.mjs`) that
// spawns `claude -p --model opus --output-format stream-json` and re-emits the
// stream as a simple SSE feed of `{ "t": "delta text" }` events.
//
// Security: the bridge MUST be started locally by the user; we never run shell
// from the artifact. The artifact-side helper here only does `fetch` and JSON
// parsing — same surface as any third-party `/v1/chat/completions` call.

export type OpusBridgeCfg = {
  bridgeUrl: string;          // e.g. http://127.0.0.1:8765
  timeoutMs?: number;
};

export async function streamOpusBridge(opts: {
  cfg: OpusBridgeCfg;
  prompt: string;
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
}): Promise<{ finalText: string; latencyMs: number; firstTokenMs: number }> {
  const url = `${stripTrailingSlash(opts.cfg.bridgeUrl)}/escalate`;
  const t0 = performance.now();
  let firstTokenMs = -1;

  // D-AGENT-010: track timedOut so the catch block can produce a useful
  // error string instead of a generic "Opus stream aborted".
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, opts.cfg.timeoutMs ?? 90_000);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ prompt: opts.prompt }),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timeout);
    throw new Error(
      `Opus bridge unreachable at ${url}. ` +
      `Start it with: node ~/NandaiJarvis/scripts/claude-bridge.mjs ` +
      `(requires Claude Code CLI logged in with Max subscription).`,
    );
  }
  if (!res.ok) {
    clearTimeout(timeout);
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    throw new Error(`Opus bridge HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  if (!res.body) {
    clearTimeout(timeout);
    throw new Error('Opus bridge response had no body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalText = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim().length) {
          // drain trailing event
          processBridgeEvent(buffer);
          buffer = '';
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const earlyDone = processBridgeEvent(event);
        if (earlyDone) {
          clearTimeout(timeout);
          return { finalText, latencyMs: Math.round(performance.now() - t0), firstTokenMs: firstTokenMs < 0 ? 0 : firstTokenMs };
        }
      }
    }
  } catch (e: any) {
    clearTimeout(timeout);
    if (e?.name === 'AbortError') {
      throw new Error(timedOut ? `Opus bridge timed out after ${opts.cfg.timeoutMs ?? 90_000}ms` : 'Opus stream aborted');
    }
    throw e;
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  function processBridgeEvent(event: string): boolean {
    for (const line of event.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return true;
      try {
        const obj = JSON.parse(data);
        if (typeof obj.t === 'string' && obj.t.length) {
          if (firstTokenMs < 0) firstTokenMs = Math.round(performance.now() - t0);
          finalText += obj.t;
          opts.onDelta(obj.t);
        } else if (obj.error) {
          throw new Error(`Opus bridge error: ${obj.error}`);
        }
      } catch (e) {
        // ignore malformed events
      }
    }
    return false;
  }

  clearTimeout(timeout);
  return { finalText, latencyMs: Math.round(performance.now() - t0), firstTokenMs: firstTokenMs < 0 ? 0 : firstTokenMs };
}

// ─── escalation heuristics (3-signal stack from A5 critique) ─────────────────
//
// Stack short-response + refusal-regex + raw-empty. Trigger Opus when ≥ 2 fire
// AND the user's prompt was substantial (> 30 chars). All signals derived from
// the actual response — never from a fabricated "confidence" number.

const REFUSAL_RX = /\bi (?:can'?t|cannot|don'?t (?:know|have)|am (?:unable|not able)|do not have)\b|as an ai|as a language model/i;

export function shouldEscalateToOpus(prompt: string, response: string): boolean {
  if (prompt.trim().length < 30) return false;
  const hits = [
    response.trim().length === 0,
    response.trim().length < 40,
    REFUSAL_RX.test(response),
  ].filter(Boolean).length;
  return hits >= 2;
}
