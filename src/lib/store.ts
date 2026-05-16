// Tiny store — reducer + listeners. No external deps so the bundle stays slim.
//
// Two-brain architecture (refactored 2026-05-15):
//   • brain "nandai"  → routes to LiteLLM gateway, `model: 'auto'` so the
//     gateway's classifier picks the underlying expert (fast/think/tool/moa).
//     The echoed model name is captured into `underlying` for the "why this brain?"
//     trace under each reply — never invented.
//   • brain "opus"    → routes to the local Claude Code bridge at bridgeUrl.
//     Either chosen explicitly via Composer, or auto-escalated when Nandai-One
//     emits a short/empty/refusal response (3-signal stack in shouldEscalateToOpus).
//
// Anti-hallucination: every metric (tokens, latency, cost, brain trace) reads
// from a real response. The fabricated "result" placeholder on tool calls was
// REMOVED (D-AUDIT-007) — UI now shows tool calls without faking the result.

import { useEffect, useRef, useState } from 'react';
import type {
  AssistantMessage, BrainKey, Conversation, Message, ScriptedConversation, Status, ToolCall, UnderlyingBrain,
} from './types';
import { SCRIPTED_CONVOS } from './script';
import {
  streamChat, streamOpusBridge, brainToModel, estimateCostUsd, modelToUnderlying, shouldEscalateToOpus,
  type ChatMessage, type StreamDelta, type ToolDefinition,
} from './llm';
import { extractArtifact } from './artifact-extract';
import {
  loadConnection, saveConnection, testConnection, testBridge,
  type Connection, type ConnectStatus, type BridgeStatus, type ToolBridgeStatus,
} from './connect';
import {
  fetchTools, executeToolCalls, resultsToToolMessages, probeToolBridge,
  logChatTurn, type ChatTurnLog,
} from './tool-bridge';
import {
  loadAllConversations, saveManyConversations, deleteConversationFromDB,
  clearAllConversations as _clearAllConversationsFromDB,
} from './persist';

let _idSeq = 0;
export const nextId = (prefix = 'id') => `${prefix}-${++_idSeq}-${Date.now().toString(36)}`;

// ─── TELEMETRY persistence (tick-008) ────────────────────────────────────
// Counters live in localStorage so they survive refreshes. Pure synchronous
// I/O — these are tiny ints, no point in IndexedDB.
const TELEMETRY_KEY = 'nandai-chat:telemetry';
function loadTelemetry(): Telemetry {
  const blank: Telemetry = { escalationsManual: 0, escalationsAuto: 0, rerunsWithTools: 0, since: Date.now() };
  if (typeof localStorage === 'undefined') return blank;
  try {
    const raw = localStorage.getItem(TELEMETRY_KEY);
    if (!raw) return blank;
    const parsed = JSON.parse(raw);
    return {
      escalationsManual: Number.isFinite(parsed?.escalationsManual) ? parsed.escalationsManual : 0,
      escalationsAuto:   Number.isFinite(parsed?.escalationsAuto)   ? parsed.escalationsAuto   : 0,
      // New in tick-011; missing in older payloads → default to 0 cleanly.
      rerunsWithTools:   Number.isFinite(parsed?.rerunsWithTools)   ? parsed.rerunsWithTools   : 0,
      since:             Number.isFinite(parsed?.since)             ? parsed.since             : Date.now(),
    };
  } catch { return blank; }
}
function saveTelemetry(t: Telemetry): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(TELEMETRY_KEY, JSON.stringify(t)); } catch { /* quota */ }
}
/** Public reset — wired to a small button in the dashboard. */
export function resetTelemetry(): void {
  const t: Telemetry = { escalationsManual: 0, escalationsAuto: 0, rerunsWithTools: 0, since: Date.now() };
  saveTelemetry(t);
  setState(() => ({ telemetry: t }));
}

export type Settings = {
  theme: 'dark' | 'light';
  /** Which brain to use. 'nandai' = local Trinity (auto-routed), 'opus' = Claude Code bridge. */
  routeMode: BrainKey;
  systemPrompt: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  showThinking: boolean;
  reduceMotion: boolean;
  fontSize: 'compact' | 'comfortable';
};

export type Telemetry = {
  /** Times the operator clicked "Escalate to Opus" on a message. */
  escalationsManual: number;
  /** Times the sentinel verdict auto-triggered the Opus dispatch. */
  escalationsAuto: number;
  /** Times the sentinel auto-fired a `rerun_with_tools` (tick-011). */
  rerunsWithTools: number;
  /** Wall-clock epoch ms when the counters started accumulating. Carried
   *  across refreshes so the dashboard can show "since <date>". */
  since: number;
};

export type State = {
  conversations: Conversation[];
  activeConvId: string | null;
  activeArtifactMsgId: string | null;
  artifactTab: 'render' | 'source';
  sidebarOpen: boolean;
  paletteOpen: boolean;
  settingsOpen: boolean;
  helpOpen: boolean;
  dashboardOpen: boolean;
  settings: Settings;
  telemetry: Telemetry;
  // Live connection
  connection: Connection;
  connectStatus: ConnectStatus;
  bridgeStatus: BridgeStatus;
  toolBridgeStatus: ToolBridgeStatus;
  /** OpenAI-shape tool list fetched from the executor at boot + on demand. */
  tools: ToolDefinition[];
  // ephemeral
  composer: string;
  streamingMsgId: string | null;
  // tracks which scripted turn-index per convo we are at (only used when offline=true)
  scriptCursor: Record<string, number>;
};

const DEFAULT_SETTINGS: Settings = {
  // Light-first by default — matches Claude.ai's restraint
  theme: 'light',
  routeMode: 'nandai',
  systemPrompt:
    'You are Destiny Atelier on the Trinity stack. Answer with substance, cite sources when ' +
    'reasoning, and prefer code or JSON artifacts over long prose. ' +
    // Added 2026-05-16 post-overnight: Qwen 3.6 was emitting tool_calls then ' +
    // refusing to narrate the result. This explicit rule fixes the empty-' +
    // post-tool-call hang and satisfies the wire-truth contract by requiring ' +
    // grounding to the actual tool output.' +
    'When you call a tool, ALWAYS read the result and narrate it back to the ' +
    'user in 1-2 sentences. Never call a tool and leave the response empty. ' +
    'Quote concrete values from the tool result rather than restating the ' +
    'question.',
  temperature: 0.7,
  topP: 0.95,
  // Bumped from 4096 → 16384 after the live website-build test (D-FOUND-021)
  // showed the model hitting max_tokens on a ~400-line HTML artifact. 16k is
  // safe on all our backends (Qwen 3.6 native 32k, Hermes 16k effective).
  maxTokens: 16_384,
  showThinking: true,
  reduceMotion: false,
  fontSize: 'comfortable',
};

function bootstrap(): State {
  const now = Date.now();
  const convos: Conversation[] = SCRIPTED_CONVOS.map((sc) => ({
    id: sc.id,
    title: sc.title,
    folder: sc.folder,
    pinned: !!sc.pinned,
    createdAt: now - sc.ageHours * 3600_000,
    updatedAt: now - sc.ageHours * 3600_000,
    messages: [],
  }));
  const newId = nextId('conv');
  convos.unshift({
    id: newId, title: 'New conversation', pinned: false,
    createdAt: now, updatedAt: now, messages: [],
  });
  return {
    conversations: convos,
    activeConvId: newId,
    activeArtifactMsgId: null,
    artifactTab: 'render',
    sidebarOpen: true,
    paletteOpen: false,
    settingsOpen: false,
    helpOpen: false,
    dashboardOpen: false,
    settings: DEFAULT_SETTINGS,
    telemetry: loadTelemetry(),
    connection: loadConnection(),
    connectStatus: { kind: 'unconfigured' },
    bridgeStatus: { kind: 'unknown' },
    toolBridgeStatus: { kind: 'unknown' },
    tools: [],
    composer: '',
    streamingMsgId: null,
    scriptCursor: {},
  };
}

type Listener = (s: State) => void;
const listeners = new Set<Listener>();
let state: State = bootstrap();

export function getState(): State { return state; }
function emit() { for (const l of listeners) l(state); }
export function setState(updater: (s: State) => Partial<State>): void {
  const patch = updater(state);
  state = { ...state, ...patch };
  emit();
}
export function subscribe(l: Listener): () => void {
  listeners.add(l); return () => listeners.delete(l);
}

// D-AUDIT-004: stable selector with Object.is identity guard.
// Stale React closures over `sel` would have skipped updates; capture the
// latest selector in a ref and only re-render when the projection actually
// changes (Object.is) — same contract as Zustand's useStore.
export function useStore<T>(sel: (s: State) => T): T {
  const selRef = useRef(sel);
  selRef.current = sel;
  const [v, setV] = useState(() => selRef.current(state));
  useEffect(() => {
    let last = selRef.current(state);
    setV(last);
    return subscribe((s) => {
      const next = selRef.current(s);
      if (!Object.is(next, last)) { last = next; setV(next); }
    });
  }, []);
  return v;
}

// ---------------- selectors / actions ----------------

export const selectActive = (s: State): Conversation | null =>
  s.conversations.find((c) => c.id === s.activeConvId) ?? null;

export const selectActiveArtifact = (s: State) => {
  const conv = selectActive(s);
  if (!conv || !s.activeArtifactMsgId) return null;
  const msg = conv.messages.find((m) => m.id === s.activeArtifactMsgId);
  return (msg && msg.role === 'assistant') ? (msg.artifact ?? null) : null;
};

export function newConversation(title = 'New conversation'): string {
  const id = nextId('conv');
  setState((s) => ({
    conversations: [
      { id, title, pinned: false, createdAt: Date.now(), updatedAt: Date.now(), messages: [] },
      ...s.conversations,
    ],
    activeConvId: id,
    activeArtifactMsgId: null,
  }));
  return id;
}

export function selectConversation(id: string) {
  setState(() => ({ activeConvId: id, activeArtifactMsgId: null, paletteOpen: false }));
}

export function deleteConversation(id: string) {
  setState((s) => {
    const next = s.conversations.filter((c) => c.id !== id);
    const isActive = s.activeConvId === id;
    // D-AGENT-014: clear activeArtifactMsgId if it pointed into the deleted conv,
    // otherwise the side pane dangles on a phantom message id.
    const deletedConv = s.conversations.find((c) => c.id === id);
    const artifactInDeleted = !!deletedConv?.messages.some((m) => m.id === s.activeArtifactMsgId);
    return {
      conversations: next.length ? next : [{ id: nextId('conv'), title: 'New conversation', pinned: false, createdAt: Date.now(), updatedAt: Date.now(), messages: [] }],
      activeConvId: isActive ? (next[0]?.id ?? null) : s.activeConvId,
      activeArtifactMsgId: artifactInDeleted ? null : s.activeArtifactMsgId,
    };
  });
  // Also evict from disk — otherwise a refresh would resurrect it. The
  // promise is intentionally not awaited (UI already updated).
  void deleteConversationFromDB(id);
  // Cancel any pending save for this id — already deleted.
  _dirtyConvs.delete(id);
  // Tick-014: tell sibling tabs to drop the conv too.
  _broadcastSync({ op: 'delete', convIds: [id] });
}

export function togglePin(id: string) {
  setState((s) => ({
    conversations: s.conversations.map((c) => c.id === id ? { ...c, pinned: !c.pinned } : c),
  }));
  _scheduleSave(id);
}

/* ─── DATA MANAGEMENT (tick-006) ──────────────────────────────────────────
 * Three operations the user can run from Settings → Data & privacy:
 *   clearAllChats — wipe IDB + reset to a single empty conv
 *   exportAllChats — serialize state to a self-describing JSON payload
 *   importChats — merge a JSON payload back into IDB + state
 * All three are non-destructive in the same tick: clear prompts a confirm
 * in the UI layer, export downloads, import only adds (existing convs
 * with the same id get overwritten by the import — last-write-wins).
 */

/** Wipe every saved conversation (IDB + in-memory) and reset to a fresh
 *  empty conv. Returns the number of convs that were cleared. */
export async function clearAllChats(): Promise<number> {
  const before = getState().conversations.filter((c) => c.messages.length > 0).length;
  await _clearAllConversationsFromDB();
  _dirtyConvs.clear();
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  const id = nextId('conv');
  setState(() => ({
    conversations: [{ id, title: 'New conversation', pinned: false, createdAt: Date.now(), updatedAt: Date.now(), messages: [] }],
    activeConvId: id,
    activeArtifactMsgId: null,
  }));
  // Tick-014: tell sibling tabs they should also reset to a fresh empty conv.
  _broadcastSync({ op: 'clear' });
  return before;
}

/** Serialize every non-empty conv into a JSON payload suitable for download.
 *  Schema version is included so future imports can migrate cleanly. */
export function exportAllChats(): { json: string; count: number; bytes: number } {
  const s = getState();
  const convs = s.conversations.filter((c) => c.messages.length > 0);
  const payload = {
    schema: 'nandai-chat.conversations',
    version: 1,
    exportedAt: Date.now(),
    count: convs.length,
    conversations: convs,
  };
  const json = JSON.stringify(payload, null, 2);
  return { json, count: convs.length, bytes: json.length };
}

/** Import a JSON blob produced by exportAllChats (or hand-edited matching
 *  the same shape). Existing convs with the same id are overwritten —
 *  this is intentional so re-imports of a backup restore exactly. */
export async function importChats(json: string): Promise<{ added: number; skipped: number; errors: number }> {
  let payload: any;
  try { payload = JSON.parse(json); } catch { return { added: 0, skipped: 0, errors: 1 }; }
  const arr = Array.isArray(payload) ? payload : payload?.conversations;
  if (!Array.isArray(arr)) return { added: 0, skipped: 0, errors: 1 };
  let added = 0, skipped = 0;
  const validConvs: Conversation[] = [];
  for (const c of arr) {
    if (!c || typeof c.id !== 'string' || !Array.isArray(c.messages)) { skipped++; continue; }
    validConvs.push({
      id: c.id,
      title: typeof c.title === 'string' ? c.title : 'Imported conversation',
      folder: c.folder,
      pinned: !!c.pinned,
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
      messages: c.messages,
    });
    added++;
  }
  if (validConvs.length) {
    await saveManyConversations(validConvs);
    // Merge into in-memory state so the sidebar updates immediately, no
    // refresh required. Imports win on id collision (matches IDB write).
    setState((s) => {
      const byId = new Map<string, Conversation>();
      for (const c of s.conversations) byId.set(c.id, c);
      for (const c of validConvs) byId.set(c.id, c);
      const merged = Array.from(byId.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      // Keep the active conv at top if it's still there.
      const activeIdx = merged.findIndex((c) => c.id === s.activeConvId);
      if (activeIdx > 0) {
        const [active] = merged.splice(activeIdx, 1);
        merged.unshift(active);
      }
      return { conversations: merged };
    });
  }
  return { added, skipped, errors: 0 };
}

export function setComposer(v: string) { setState(() => ({ composer: v })); }
export function setActiveArtifact(msgId: string | null) {
  setState((s) => ({
    activeArtifactMsgId: msgId,
    artifactTab: msgId !== s.activeArtifactMsgId ? 'render' : s.artifactTab,
  }));
}
export function setArtifactTab(t: 'render' | 'source') { setState(() => ({ artifactTab: t })); }
export function toggleSidebar()  { setState((s) => ({ sidebarOpen: !s.sidebarOpen })); }
export function setPalette(v: boolean)   { setState(() => ({ paletteOpen: v })); }
export function setSettings(v: boolean)  { setState(() => ({ settingsOpen: v })); }
export function setHelp(v: boolean)      { setState(() => ({ helpOpen: v })); }
export function setDashboard(v: boolean) { setState(() => ({ dashboardOpen: v })); }
export function patchSettings(p: Partial<Settings>) {
  setState((s) => ({ settings: { ...s.settings, ...p } }));
}
export function setTheme(t: 'light' | 'dark') {
  setState((s) => ({ settings: { ...s.settings, theme: t } }));
  if (typeof document !== 'undefined') {
    document.body.classList.toggle('dark', t === 'dark');
  }
}

// Connection management
export function setConnection(c: Partial<Connection>) {
  const prev = getState().connection;
  const next = { ...prev, ...c };
  saveConnection(next);
  // D-AGENT-009: if the user changed endpoint / key / bridge URL, the
  // previously-cached "connected · N models" pill is stale and could
  // mislead them into thinking the new endpoint works. Reset to
  // unconfigured so the next probe shows real status.
  const patch: Partial<State> = { connection: next };
  if (c.baseUrl !== undefined && c.baseUrl !== prev.baseUrl)     patch.connectStatus = { kind: 'unconfigured' };
  if (c.apiKey  !== undefined && c.apiKey  !== prev.apiKey)      patch.connectStatus = { kind: 'unconfigured' };
  if (c.bridgeUrl !== undefined && c.bridgeUrl !== prev.bridgeUrl) patch.bridgeStatus = { kind: 'unknown' };
  setState(() => patch);
}
export async function probeConnection(): Promise<ConnectStatus> {
  const c = getState().connection;
  setState(() => ({ connectStatus: { kind: 'connecting' } }));
  const status = await testConnection(c);
  setState(() => ({ connectStatus: status }));
  return status;
}
export async function probeBridge(): Promise<BridgeStatus> {
  const c = getState().connection;
  setState(() => ({ bridgeStatus: { kind: 'probing' } }));
  const status = await testBridge(c);
  setState(() => ({ bridgeStatus: status }));
  return status;
}
export async function probeToolExecutor(): Promise<ToolBridgeStatus> {
  const c = getState().connection;
  setState(() => ({ toolBridgeStatus: { kind: 'probing' } }));
  const res = await probeToolBridge({ baseUrl: c.toolBridgeUrl });
  const status: ToolBridgeStatus = res.kind === 'ready'
    ? { kind: 'ready', n_tools: res.n_tools ?? 0, checkedAt: Date.now() }
    : { kind: 'down', message: res.message ?? 'unreachable', checkedAt: Date.now() };
  setState(() => ({ toolBridgeStatus: status }));
  if (status.kind === 'ready') void refreshTools();
  return status;
}
export async function refreshTools(): Promise<void> {
  const c = getState().connection;
  try {
    const tools = await fetchTools({ baseUrl: c.toolBridgeUrl, timeoutMs: 10_000 });
    setState(() => ({ tools }));
  } catch (e) {
    // Leave tools empty — chat falls back to non-agentic mode silently.
  }
}
// Auto-probe on boot (don't block render)
if (typeof window !== 'undefined') {
  queueMicrotask(() => { void probeConnection(); void probeBridge(); void probeToolExecutor(); });
}

// ─── PERSISTENCE — IndexedDB sync ────────────────────────────────────────────
//
// HANDOFF-003 #3 (audit's #1 ship-blocker): refresh used to wipe every
// conversation. Fix: persist convos to IndexedDB and merge them on boot.
//
// Save model — debounced + coalesced:
//   • every mutation that touches a conv (pushMessage / patchAssistant /
//     togglePin / loadScripted) adds the convId to a dirty set.
//   • a 600 ms trailing-edge timer flushes the set in ONE indexeddb txn.
//   • empty convos (no messages) are skipped — keeps storage tidy.
//   • on `pagehide` we synchronously kick off any pending save so a refresh
//     doesn't lose the last typed turn.
//
// Load model — non-blocking, race-safe:
//   • bootstrap() returns the scripted demos + "New conversation" instantly
//     (no flash of empty UI while the DB opens).
//   • a queueMicrotask follow-up reads every persisted conv and merges it
//     into state; the merge prefers the in-memory version when both have
//     the same id (so concurrent typing isn't clobbered by an older snapshot).
const _dirtyConvs = new Set<string>();
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function _flushSaves() {
  const ids = Array.from(_dirtyConvs);
  _dirtyConvs.clear();
  _saveTimer = null;
  if (!ids.length) return;
  const s = getState();
  const toSave = ids
    .map((id) => s.conversations.find((c) => c.id === id))
    .filter((c): c is Conversation => !!c && c.messages.length > 0);
  if (!toSave.length) return;

  // Tick-017 — two-part fix for the streaming-sticky cross-tab bug from
  // HANDOFF-016 #35:
  //
  // 1. AWAIT the IDB write BEFORE broadcasting, so any sibling tab that
  //    reacts to the broadcast via loadAllConversations() reads the
  //    just-committed state, not a stale pre-write snapshot.
  // 2. Filter out convs whose latest message is still streaming. We DO
  //    save them to IDB (preserves recovery on refresh mid-stream), but
  //    we DON'T broadcast — sibling tabs would render a half-baked state
  //    with `msg.streaming=true` even though IDB will eventually have
  //    the non-streaming version. The final debounced save (600 ms after
  //    the stream completes) carries `streaming:false` and IS broadcast.
  //
  // Together: Tab A's local IDB stays up-to-date for recovery; Tab B
  // only learns about a conv once it's fully baked.
  saveManyConversations(toSave).then(() => {
    const broadcastIds = toSave
      .filter((c) => {
        const last = c.messages[c.messages.length - 1];
        return !last || last.role !== 'assistant' || !last.streaming;
      })
      .map((c) => c.id);
    if (broadcastIds.length) {
      _broadcastSync({ op: 'save', convIds: broadcastIds });
    }
  }).catch(() => { /* swallow — best-effort */ });
}
function _scheduleSave(convId: string) {
  if (typeof window === 'undefined') return;
  _dirtyConvs.add(convId);
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_flushSaves, 600);
}

// ─── CROSS-TAB SYNC via BroadcastChannel (tick-014) ──────────────────────────
// When the operator has two tabs open and saves/deletes a conv in tab A,
// tab B's in-memory state goes stale until a manual refresh. This channel
// pipes save/delete/clear notifications between tabs so they stay coherent.
//
// Protocol — minimal, three ops:
//   { op: 'save',   convIds: string[] }  → other tab(s) re-read those ids from IDB and merge
//   { op: 'delete', convIds: string[] }  → other tab(s) drop those ids from state
//   { op: 'clear'                    }   → other tab(s) reset to a fresh empty conv
//
// BroadcastChannel does NOT echo to the sending context, so we're safe from
// self-loops without any nonce-tracking ceremony.
type SyncMessage =
  | { op: 'save'; convIds: string[] }
  | { op: 'delete'; convIds: string[] }
  | { op: 'clear' }
  // Tick-015: when one tab fetches a sentinel verdict for a turn, fan it out
  // to sibling tabs so they don't run their own redundant 3-attempt poll.
  // Verdict shape is loosely typed here to avoid a circular import with
  // tool-bridge.ts — the receiver (AuditPill) knows the actual shape.
  | { op: 'verdict'; msgId: string; verdict: unknown };

let _syncChannel: BroadcastChannel | null = null;
function _broadcastSync(msg: SyncMessage): void {
  if (!_syncChannel) return;
  try { _syncChannel.postMessage(msg); } catch { /* serializer / closed-channel */ }
}

// ─── Verdict cache (tick-016) ────────────────────────────────────────────────
// Module-level Map keyed by msgId. Populated by:
//   • broadcastVerdict (publisher caches locally)
//   • the main channel listener below (subscriber caches every received broadcast)
// Read by AuditPill on mount via getCachedVerdict — lets a late-arriving pill
// pick up a verdict that was broadcast while it wasn't subscribed (the most
// common gap caught in tick-015's verification).
//
// Soft cap of 500 entries — Map preserves insertion order, so we evict
// the first-inserted on overflow (poor-man's LRU; cache-touches re-insert
// to bump to "most recent"). 500 * ~2 KB/verdict = 1 MB worst case.
const _verdictCache = new Map<string, unknown>();
const VERDICT_CACHE_CAP = 500;
function _cacheVerdict(msgId: string, verdict: unknown): void {
  if (_verdictCache.size >= VERDICT_CACHE_CAP) {
    const firstKey = _verdictCache.keys().next().value;
    if (firstKey !== undefined) _verdictCache.delete(firstKey);
  }
  _verdictCache.delete(msgId);  // bump insertion order if re-cached
  _verdictCache.set(msgId, verdict);
}

/** Synchronous read for the cached sentinel verdict, if any.
 *  Returns null on miss — AuditPill falls back to polling. */
export function getCachedVerdict(msgId: string): unknown | null {
  return _verdictCache.get(msgId) ?? null;
}

/** Tick-015 — public API for the AuditPill cross-tab verdict sharing.
 *  AuditPill calls this after a fresh fetch lands. Tick-016: also caches
 *  locally so a same-tab AuditPill that mounts AFTER the broadcast can
 *  still pick the verdict up via getCachedVerdict. */
export function broadcastVerdict(msgId: string, verdict: unknown): void {
  _cacheVerdict(msgId, verdict);
  _broadcastSync({ op: 'verdict', msgId, verdict });
}

/** Subscribe to incoming sibling-tab verdicts. Returns an unsubscribe fn.
 *  AuditPill mounts a listener and stops polling once a sibling delivers. */
export function subscribeVerdicts(handler: (msgId: string, verdict: unknown) => void): () => void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined' || !_syncChannel) {
    return () => {};
  }
  const listener = (ev: MessageEvent<SyncMessage>) => {
    if (ev.data && ev.data.op === 'verdict') handler(ev.data.msgId, ev.data.verdict);
  };
  _syncChannel.addEventListener('message', listener);
  return () => { if (_syncChannel) _syncChannel.removeEventListener('message', listener); };
}

if (typeof window !== 'undefined') {
  // Best-effort flush on tab close / refresh / nav-away. pagehide fires more
  // reliably than beforeunload on mobile Safari, and the IndexedDB put is
  // queued synchronously even though the promise won't resolve.
  window.addEventListener('pagehide', () => { if (_dirtyConvs.size) _flushSaves(); });

  if (typeof BroadcastChannel !== 'undefined') {
    _syncChannel = new BroadcastChannel('nandai-chat:sync');
    _syncChannel.addEventListener('message', async (ev: MessageEvent<SyncMessage>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.op === 'clear') {
        const id = nextId('conv');
        setState(() => ({
          conversations: [{ id, title: 'New conversation', pinned: false, createdAt: Date.now(), updatedAt: Date.now(), messages: [] }],
          activeConvId: id,
          activeArtifactMsgId: null,
        }));
        return;
      }
      if (msg.op === 'delete' && Array.isArray(msg.convIds)) {
        const ids = new Set(msg.convIds);
        setState((s) => {
          const next = s.conversations.filter((c) => !ids.has(c.id));
          const activeWasDeleted = s.activeConvId != null && ids.has(s.activeConvId);
          const activeArtifactInDeleted = s.conversations
            .filter((c) => ids.has(c.id))
            .some((c) => c.messages.some((m) => m.id === s.activeArtifactMsgId));
          return {
            conversations: next.length ? next : [{
              id: nextId('conv'), title: 'New conversation', pinned: false,
              createdAt: Date.now(), updatedAt: Date.now(), messages: [],
            }],
            activeConvId: activeWasDeleted ? (next[0]?.id ?? null) : s.activeConvId,
            activeArtifactMsgId: activeArtifactInDeleted ? null : s.activeArtifactMsgId,
          };
        });
        return;
      }
      if (msg.op === 'verdict' && typeof msg.msgId === 'string') {
        // Tick-016: cache the broadcast even if no AuditPill is currently
        // mounted to receive it via subscribeVerdicts. A late-mounting pill
        // picks it up synchronously via getCachedVerdict.
        _cacheVerdict(msg.msgId, msg.verdict);
        return;
      }
      if (msg.op === 'save' && Array.isArray(msg.convIds)) {
        // Re-read the affected convs from IDB and merge. Newer updatedAt wins
        // (matches the bootstrap contract; covers a tab that saved an even
        // newer revision in the same window).
        const all = await loadAllConversations();
        const updated = new Map(all.map((c) => [c.id, c]));
        setState((s) => {
          const byId = new Map<string, Conversation>();
          for (const c of s.conversations) byId.set(c.id, c);
          for (const id of msg.convIds) {
            const fresh = updated.get(id);
            if (!fresh) continue;
            const existing = byId.get(id);
            if (!existing || (fresh.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
              byId.set(id, fresh);
            }
          }
          const merged = Array.from(byId.values())
            .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
          const activeIdx = merged.findIndex((c) => c.id === s.activeConvId);
          if (activeIdx > 0) {
            const [active] = merged.splice(activeIdx, 1);
            merged.unshift(active);
          }
          return { conversations: merged };
        });
        return;
      }
    });
  }

  // Async hydrate after first paint — never blocks the initial render.
  queueMicrotask(async () => {
    const saved = await loadAllConversations();
    if (!saved.length) return;
    setState((s) => {
      const byId = new Map<string, Conversation>();
      for (const c of saved) byId.set(c.id, c);
      // In-memory version wins on collision (covers the user-typed-while-loading race).
      for (const c of s.conversations) {
        const existing = byId.get(c.id);
        if (!existing || (c.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
          byId.set(c.id, c);
        }
      }
      const merged = Array.from(byId.values())
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      // Keep the active conv visible at the top — most often it's the empty
      // "New conversation" the user can immediately type into.
      const activeIdx = merged.findIndex((c) => c.id === s.activeConvId);
      if (activeIdx > 0) {
        const [active] = merged.splice(activeIdx, 1);
        merged.unshift(active);
      }
      return { conversations: merged };
    });
  });
}

// ---------------- streaming engine ----------------

// D-AUDIT-009: per-run controller so a cancel-then-resend race can't tank the
// new run. The catch in each run captures its own controller locally; the
// module-level `cancelCurrent` is only the latest one.
let cancelCurrent: (() => void) | null = null;
let userAborted = false;

export function stopGenerating() {
  if (!cancelCurrent) return;
  userAborted = true;
  cancelCurrent();
  cancelCurrent = null;
}

function pickDemoForPrompt(prompt: string): ScriptedConversation {
  const p = prompt.toLowerCase();
  const score = (s: ScriptedConversation) => {
    const tokens = s.title.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
    return tokens.reduce((acc, t) => acc + (p.includes(t) ? 1 : 0), 0);
  };
  const ranked = SCRIPTED_CONVOS.map((s) => ({ s, n: score(s) })).sort((a, b) => b.n - a.n);
  return ranked[0]?.n > 0 ? ranked[0].s : SCRIPTED_CONVOS.find((s) => s.id === 'demo-refactor') ?? SCRIPTED_CONVOS[0];
}

export function sendUserMessage(text: string, scripted?: ScriptedConversation) {
  const trimmed = text.trim();
  if (!trimmed) return;
  // Belt-and-braces double-send guard
  if (getState().streamingMsgId) return;

  setState(() => ({ composer: '' }));

  const conv = selectActive(getState());
  if (!conv) return;
  const userMsg: Message = { id: nextId('msg'), role: 'user', text: trimmed, createdAt: Date.now() };
  pushMessage(conv.id, userMsg);

  const s = getState();
  const useLive =
    !scripted && !s.connection.offline && s.connectStatus.kind === 'connected';

  if (useLive) {
    // Route to the chosen brain
    if (s.settings.routeMode === 'opus') {
      runOpusFallback(conv.id, trimmed);
    } else {
      runLiveCompletion(conv.id);
    }
  } else {
    runScriptedCompletion(conv.id, trimmed, scripted);
  }
}

/* ─── LIVE PATH — Nandai-One via LiteLLM ──────────────────────────────────── */

async function runLiveCompletion(convId: string, opts: { forceTools?: boolean; rerunReason?: string } = {}) {
  const s0 = getState();
  const conv = s0.conversations.find((c) => c.id === convId);
  if (!conv) return;

  const model = brainToModel('nandai'); // → 'auto'

  const history: ChatMessage[] = [];
  if (s0.settings.systemPrompt.trim()) {
    history.push({ role: 'system', content: s0.settings.systemPrompt });
  }
  for (const m of conv.messages) {
    if (m.role === 'user') history.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant') {
      const msg: ChatMessage = { role: 'assistant', content: m.text };
      if (m.toolCalls?.length) msg.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id, type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      }));
      history.push(msg);
      // D-AUDIT-006: round-trip tool results as synthetic `tool` role messages.
      // Most upstream models expect this shape; without it, the next turn loses
      // the result and the model re-fires the same call.
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          if (tc.result !== undefined) {
            history.push({
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.name,
              content: typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result),
            });
          }
        }
      }
    }
  }

  const asstId = nextId('msg');
  const placeholder: AssistantMessage = {
    id: asstId, role: 'assistant', brain: 'nandai',
    text: '', streaming: true, status: 'queued', createdAt: Date.now(),
  };
  pushMessage(convId, placeholder);
  setState(() => ({ streamingMsgId: asstId }));

  // RAF batching for high-frequency token deltas
  let textBuf = '';
  let raf: number | null = null;
  const flush = () => {
    if (!textBuf) { raf = null; return; }
    const chunk = textBuf;
    textBuf = '';
    patchAssistant(convId, asstId, { text: getCurrentText(convId, asstId) + chunk });
    raf = null;
  };
  const schedule = () => {
    if (raf == null && typeof requestAnimationFrame !== 'undefined') {
      raf = requestAnimationFrame(flush);
    }
  };
  // D-AUDIT-023: flush before any non-text patch so token order isn't shuffled.
  const flushNow = () => {
    if (raf != null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(raf); raf = null;
    }
    if (textBuf) {
      patchAssistant(convId, asstId, { text: getCurrentText(convId, asstId) + textBuf });
      textBuf = '';
    }
  };

  const abort = new AbortController();
  // D-AUDIT-009: capture this run's controller locally so cancel-then-resend
  // doesn't have the second run abort itself when the first's catch fires.
  const myCancel = () => abort.abort();
  cancelCurrent = myCancel;

  patchAssistant(convId, asstId, { status: 'thinking', statusNote: `→ ${model}` });

  // Snapshot tools array if agentic mode is enabled and the executor is ready.
  // We intentionally fetch the array once and ship the SAME array for every
  // turn of this run so tool ids stay stable.
  const wantTools = s0.connection.useTools && s0.toolBridgeStatus.kind === 'ready' && s0.tools.length > 0;
  const toolsForRun = wantTools ? s0.tools : undefined;

  try {
    const result = await streamChat({
      cfg: { baseUrl: s0.connection.baseUrl, apiKey: s0.connection.apiKey, timeoutMs: s0.connection.timeoutMs },
      model,
      messages: history,
      tools: toolsForRun,
      // Tick-011: when re-firing on sentinel's `rerun_with_tools`, force the
      // model to actually call a tool (`tool_choice: 'required'`). Otherwise
      // stay on 'auto' — letting the model decide whether tools are needed.
      toolChoice: toolsForRun ? (opts.forceTools ? 'required' : 'auto') : undefined,
      temperature: s0.settings.temperature,
      topP: s0.settings.topP,
      maxTokens: s0.settings.maxTokens,
      signal: abort.signal,
      onDelta: (d: StreamDelta) => {
        if (d.kind === 'text') {
          textBuf += d.text;
          schedule();
          if (getMsg(convId, asstId)?.status === 'thinking') {
            patchAssistant(convId, asstId, { status: 'generating', statusNote: undefined });
          }
        } else if (d.kind === 'model') {
          // Surface the underlying upstream for the "why this brain?" trace
          flushNow();
          const underlying = modelToUnderlying(d.model);
          patchAssistant(convId, asstId, { underlying, statusNote: d.model });
        } else if (d.kind === 'tool_call_delta') {
          flushNow();
          patchAssistant(convId, asstId, { status: 'tool-calling', statusNote: d.name });
        } else if (d.kind === 'usage') {
          patchAssistant(convId, asstId, {
            tokens: { prompt: d.usage.prompt_tokens, completion: d.usage.completion_tokens },
          });
        } else if (d.kind === 'error') {
          // D-FOUND-006: flushNow is already first — keeps error text strictly
          // AFTER all buffered tokens that arrived before the error event, never
          // before. We also leave a trailing newline so subsequent deltas
          // (if any) start on a fresh line.
          flushNow();
          patchAssistant(convId, asstId, {
            text: (getCurrentText(convId, asstId) || '') + `\n\n**Error from gateway:** ${d.message}\n`,
          });
        }
      },
    });

    flushNow();

    const ex = extractArtifact(result.finalText);
    // D-FOUND-021: surface real `finish_reason: 'length'` so the user knows
    // the model was cut off (vs naturally stopped). Append a calm note to the
    // prose body — never invent a continuation.
    let body = ex.body;
    if (result.finishReason === 'length') {
      body = body + `\n\n_— response truncated at max_tokens (${s0.settings.maxTokens}). Raise the ceiling in Settings to let the model finish._`;
    }
    const update: Partial<AssistantMessage> = {
      text: body,
      streaming: false,
      status: null,
      statusNote: undefined,
      latencyMs: result.latencyMs,
      tokens: result.usage
        ? { prompt: result.usage.prompt_tokens, completion: result.usage.completion_tokens }
        : undefined,
      costUsd: result.modelReported ? estimateCostUsd(result.modelReported, result.usage) : undefined,
    };
    if (ex.artifact) update.artifact = { ...ex.artifact, id: nextId('art'), version: 1 };
    if (result.toolCalls.length) {
      // D-AUDIT-007: NO fake `result` field. UI must show "result pending" badge
      // until a real tool runner fills it. Frontend will not invent success.
      update.toolCalls = result.toolCalls.map((tc) => ({
        id: tc.id || nextId('tc'),
        name: tc.function.name,
        args: safeParse(tc.function.arguments),
        result: undefined,
        durationMs: undefined,
      }) as ToolCall);
    }
    patchAssistant(convId, asstId, update);
    // D-AGENT-006: only auto-open the side pane when nothing else is open.
    if (ex.artifact && getState().activeArtifactMsgId == null) setActiveArtifact(asstId);

    // ─── AGENTIC TOOL LOOP ─────────────────────────────────────────────────
    // If the model emitted tool_calls AND we have a tool executor ready,
    // execute them, append results as `role: 'tool'` messages, and recurse
    // into another streamChat() call. Loop until finish_reason !== 'tool_calls'
    // or we hit MAX_TOOL_ROUNDS to prevent runaway loops.
    if (
      wantTools &&
      result.toolCalls.length &&
      result.finishReason === 'tool_calls' &&
      !userAborted
    ) {
      try {
        await runToolLoop(convId, asstId, history, result.toolCalls, toolsForRun!, model, abort.signal);
      } catch (toolErr: any) {
        // Tick-019 B5 fix: error to structured field, not concatenated to body
        patchAssistant(convId, asstId, {
          error: `Tool loop failed: ${(toolErr?.message ?? String(toolErr)).slice(0, 400)}`,
        });
      }
    }
    setState(() => ({ streamingMsgId: null }));

    // Auto-escalate to Opus if the response is empty/short/refusal AND user enabled it.
    // D-AGENT-013: if the user opted in but the bridge is down, surface a calm
    // note on the existing message instead of silently dropping the escalation.
    //
    // 2026-05-16 tick-002 fix: if the assistant emitted tool_calls AND at least
    // one returned a successful result, DO NOT auto-escalate. The tool gave
    // the answer; the model just failed to narrate it. Auto-escalating would
    // be misleading (the data is in the tool-call card right above the body).
    // The sentinel will still flag fully_addressed=no, so we don't lose
    // observability — we just don't ping Opus for tool-result-narration miss.
    const last = conv.messages[conv.messages.length - 1];
    const userPrompt = last && last.role === 'user' ? last.text : '';
    const finalMsg = getMsg(convId, asstId);
    const hasSuccessfulToolResult = !!finalMsg?.toolCalls?.some(
      (tc) => tc.result !== undefined && !(tc.result as any)?.error,
    );
    // ─── SENTINEL TURN LOG ────────────────────────────────────────────────
    // Fire-and-forget POST to the sentinel inbox AFTER the tool loop completes
    // so the logged response reflects what the user actually sees (not the
    // empty round-1 response that runToolLoop fills in via round-2 narration).
    // Tick-002 fix: prior log point captured pre-loop emptiness and the
    // sentinel kept flagging fully_addressed=no incorrectly.
    {
      const finalText = getCurrentText(convId, asstId);
      const finalMsgForLog = getMsg(convId, asstId);
      const turn: ChatTurnLog = {
        id: asstId,
        ts: Math.round(Date.now() / 1000),
        session_id: convId,
        user_prompt: userPrompt,
        model_response: finalText,
        brain_route: result.modelReported ?? 'nandai-fast',
        tool_calls: (finalMsgForLog?.toolCalls || []).map((tc) => ({
          name: tc.name, result_present: tc.result !== undefined,
        })),
        latency_ms: result.latencyMs,
        tokens_out: result.usage?.completion_tokens,
      };
      void logChatTurn({ baseUrl: s0.connection.toolBridgeUrl }, turn);
    }

    if (
      getState().connection.autoEscalate &&
      !hasSuccessfulToolResult &&
      shouldEscalateToOpus(userPrompt, ex.body)
    ) {
      if (getState().bridgeStatus.kind === 'ready') {
        patchAssistant(convId, asstId, { escalated: true });
        void runOpusFallback(convId, userPrompt, { reason: 'auto: short / refusal' });
      } else {
        // Use post-loop current text, not round-1 ex.body (was overwriting
        // the model's tool-result narration). Tick-002 fix.
        const currentBody = getCurrentText(convId, asstId);
        patchAssistant(convId, asstId, {
          text: currentBody + `\n\n_— auto-escalation suggested but the Opus bridge is offline. Start it (\`node ~/NandaiJarvis/scripts/claude-bridge.mjs\`) and click_ **Escalate to Opus** _to retry._`,
        });
      }
    }

  } catch (e: any) {
    flushNow();
    if (userAborted) {
      patchAssistant(convId, asstId, {
        text: (getCurrentText(convId, asstId) || '') + ' — [stopped]',
        streaming: false, status: null, statusNote: undefined,
      });
    } else {
      const msg = (e?.message ?? String(e)).slice(0, 600);
      // Tick-019 B5 fix: error to structured field, not concatenated to body
      patchAssistant(convId, asstId, {
        error: `Stream failed: ${msg}`,
        streaming: false, status: null, statusNote: undefined,
      });
    }
    setState(() => ({ streamingMsgId: null }));
  } finally {
    // D-AUDIT-009: only clear if WE are still the latest run
    if (cancelCurrent === myCancel) cancelCurrent = null;
    userAborted = false;
  }
}

/* ─── OPUS FALLBACK — Claude Code bridge over localhost ───────────────────── */

export async function runOpusFallback(
  convId: string,
  prompt: string,
  opts: { reason?: string } = {},
) {
  const s0 = getState();
  const conv = s0.conversations.find((c) => c.id === convId);
  if (!conv) return;
  // Guard against double-stream
  if (s0.streamingMsgId) return;

  const asstId = nextId('msg');
  const placeholder: AssistantMessage = {
    id: asstId, role: 'assistant', brain: 'opus',
    underlying: 'escape',
    text: '', streaming: true, status: 'thinking',
    statusNote: opts.reason ? `escalation · ${opts.reason}` : 'Opus via Claude Code bridge',
    escalated: true,
    createdAt: Date.now(),
  };
  pushMessage(convId, placeholder);
  setState(() => ({ streamingMsgId: asstId }));

  let textBuf = '';
  let raf: number | null = null;
  const flush = () => {
    if (!textBuf) { raf = null; return; }
    const chunk = textBuf; textBuf = '';
    patchAssistant(convId, asstId, { text: getCurrentText(convId, asstId) + chunk });
    raf = null;
  };
  const schedule = () => {
    if (raf == null && typeof requestAnimationFrame !== 'undefined') {
      raf = requestAnimationFrame(flush);
    }
  };
  const flushNow = () => {
    if (raf != null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(raf); raf = null;
    }
    if (textBuf) {
      patchAssistant(convId, asstId, { text: getCurrentText(convId, asstId) + textBuf });
      textBuf = '';
    }
  };

  const abort = new AbortController();
  const myCancel = () => abort.abort();
  cancelCurrent = myCancel;

  try {
    const result = await streamOpusBridge({
      cfg: { bridgeUrl: s0.connection.bridgeUrl, timeoutMs: 180_000 },
      prompt,
      signal: abort.signal,
      onDelta: (t) => {
        if (getMsg(convId, asstId)?.status === 'thinking') {
          patchAssistant(convId, asstId, { status: 'generating', statusNote: undefined });
        }
        textBuf += t;
        schedule();
      },
    });
    flushNow();
    const ex = extractArtifact(result.finalText);
    const update: Partial<AssistantMessage> = {
      text: ex.body,
      streaming: false,
      status: null,
      statusNote: undefined,
      latencyMs: result.latencyMs,
      // Bridge is Max-sub backed so cost is $0 from the artifact's pov
      costUsd: 0,
    };
    if (ex.artifact) update.artifact = { ...ex.artifact, id: nextId('art'), version: 1 };
    patchAssistant(convId, asstId, update);
    // D-AGENT-006: preserve existing pane (see runLiveCompletion).
    if (ex.artifact && getState().activeArtifactMsgId == null) setActiveArtifact(asstId);
    setState(() => ({ streamingMsgId: null }));
  } catch (e: any) {
    flushNow();
    if (userAborted) {
      patchAssistant(convId, asstId, {
        text: (getCurrentText(convId, asstId) || '') + ' — [stopped]',
        streaming: false, status: null, statusNote: undefined,
      });
    } else {
      const msg = (e?.message ?? String(e)).slice(0, 600);
      // Tick-019 B5 fix: error to structured field, not concatenated to body
      patchAssistant(convId, asstId, {
        error: `Opus bridge failed: ${msg}`,
        streaming: false, status: null, statusNote: undefined,
      });
    }
    setState(() => ({ streamingMsgId: null }));
  } finally {
    if (cancelCurrent === myCancel) cancelCurrent = null;
    userAborted = false;
  }
}

/* ─── AGENTIC TOOL LOOP ─────────────────────────────────────────────────────
 * Round-trips tool_calls through the executor middleware and feeds the
 * results back to the model. Loops until finish_reason !== 'tool_calls' or
 * MAX_TOOL_ROUNDS hits (8 rounds, configurable). Streams subsequent
 * assistant text into the same message bubble for a cohesive turn.
 */
const MAX_TOOL_ROUNDS = 8;

async function runToolLoop(
  convId: string,
  asstId: string,
  baseHistory: ChatMessage[],
  initialToolCalls: { id: string; type: 'function'; function: { name: string; arguments: string } }[],
  toolsForRun: ToolDefinition[],
  model: string,
  signal: AbortSignal,
) {
  const s = getState();
  let history: ChatMessage[] = [...baseHistory];
  let pendingCalls = initialToolCalls;
  // Push the assistant's pending tool-call message as the first new history entry
  history.push({
    role: 'assistant',
    content: '',
    tool_calls: pendingCalls.map((tc) => ({ id: tc.id, type: 'function', function: tc.function })),
  });

  for (let round = 0; round < MAX_TOOL_ROUNDS && !signal.aborted; round++) {
    // 1. Execute the pending tool calls
    patchAssistant(convId, asstId, { status: 'tool-calling', statusNote: `executing ${pendingCalls.length} tool(s) · round ${round + 1}` });
    const execResults = await executeToolCalls(
      { baseUrl: s.connection.toolBridgeUrl, timeoutMs: 120_000 },
      pendingCalls.map((tc) => ({
        call_id: tc.id,
        tool_name: tc.function.name,
        args: safeParse(tc.function.arguments),
      })),
      signal,
    );
    // 2. Render results inline on the assistant message
    const existing = getMsg(convId, asstId)?.toolCalls ?? [];
    const updatedToolCalls = existing.map((tc) => {
      const r = execResults.find((er) => er.tool_name === tc.name && (er.call_id === tc.id || er.call_id == null));
      if (!r) return tc;
      return {
        ...tc,
        result: r.ok ? (r.result as ToolCall['result']) : { error: r.error, status: r.status_code },
        durationMs: r.latency_ms,
      } as ToolCall;
    });
    // Also add fresh tool calls (later rounds)
    for (const tc of pendingCalls) {
      if (!existing.some((e) => e.id === tc.id)) {
        const r = execResults.find((er) => er.call_id === tc.id);
        updatedToolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: safeParse(tc.function.arguments),
          result: r ? (r.ok ? (r.result as ToolCall['result']) : { error: r.error, status: r.status_code }) : undefined,
          durationMs: r?.latency_ms,
        });
      }
    }
    patchAssistant(convId, asstId, { toolCalls: updatedToolCalls });

    // 3. Append role:'tool' messages to history
    const toolMsgs = resultsToToolMessages(pendingCalls as any, execResults);
    history = [...history, ...toolMsgs];

    // 3b. Append a user-side hint to drive the next round.
    //
    //  • All successes (existing path): tell the model to narrate the result.
    //    Fixes the Qwen 3.6 "calls tool, returns empty" failure mode caught by
    //    sentinel 2026-05-16 tick-001 (msg-3-mp80bxwv, failed_axes=
    //    [fully_addressed], suggested_action=escalate_to_opus).
    //  • Any failures (tick-010 — issue #7): name the failing tool(s) and the
    //    exact error string, ask the model to inspect args and retry. Models
    //    often get it right on the second pass when given a concrete error.
    //
    // Sending the hint as a user message instead of system because Qwen
    // pays more attention to recent user turns than to the rolling system
    // prompt — same reasoning as the tick-001 fix.
    const errs = execResults.filter((r) => !r.ok);
    const errSummary = errs
      .map((r) => `${r.tool_name}: ${r.error || `HTTP ${r.status_code}`}`)
      .join('; ');
    let hint: string;
    if (errs.length === execResults.length && errs.length > 0) {
      // All tool calls failed
      hint =
        `[All tool call(s) FAILED: ${errSummary}. Inspect your arguments — ` +
        `common fixes are wrong field names, missing required parameters, ` +
        `or invalid enum values. Re-fire the failed tool(s) with corrected ` +
        `arguments. If the error is unrecoverable (e.g. service down or ` +
        `authentication), narrate that to the user instead of retrying.]`;
    } else if (errs.length > 0) {
      // Partial failure: some worked, some didn't
      hint =
        `[Mixed result: ${errs.length} tool call(s) FAILED (${errSummary}); ` +
        `${execResults.length - errs.length} succeeded. Use the successful ` +
        `results in your answer, retry the failing ones with corrected args, ` +
        `or note them as unavailable. Keep the answer to 1-2 sentences ` +
        `unless retrying.]`;
    } else {
      // Pure success (the original narration nudge)
      hint =
        '[Tool results received above. Now answer my original question in ' +
        '1-2 sentences, quoting concrete values from the tool result. Do ' +
        'not call another tool unless absolutely required; just summarise ' +
        'what you got.]';
    }
    history.push({ role: 'user', content: hint });

    // 4. Stream the next turn from the model
    patchAssistant(convId, asstId, { status: 'generating', statusNote: `round ${round + 1} continuing` });
    let textBuf = '';
    let raf: number | null = null;
    const flush = () => {
      if (!textBuf) { raf = null; return; }
      const chunk = textBuf; textBuf = '';
      patchAssistant(convId, asstId, { text: getCurrentText(convId, asstId) + chunk });
      raf = null;
    };
    const schedule = () => { if (raf == null && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(flush); };
    const flushNow = () => {
      if (raf != null && typeof cancelAnimationFrame !== 'undefined') { cancelAnimationFrame(raf); raf = null; }
      if (textBuf) { patchAssistant(convId, asstId, { text: getCurrentText(convId, asstId) + textBuf }); textBuf = ''; }
    };
    const turnResult = await streamChat({
      cfg: { baseUrl: s.connection.baseUrl, apiKey: s.connection.apiKey, timeoutMs: s.connection.timeoutMs },
      model,
      messages: history,
      tools: toolsForRun,
      toolChoice: 'auto',
      temperature: s.settings.temperature,
      topP: s.settings.topP,
      maxTokens: s.settings.maxTokens,
      signal,
      onDelta: (d) => {
        if (d.kind === 'text') { textBuf += d.text; schedule(); }
        else if (d.kind === 'usage') {
          patchAssistant(convId, asstId, { tokens: { prompt: d.usage.prompt_tokens, completion: d.usage.completion_tokens } });
        }
      },
    });
    flushNow();

    if (turnResult.finishReason !== 'tool_calls' || !turnResult.toolCalls.length) {
      // Natural stop — we're done. Client-side narration fallback: if the
      // model emitted no text after the tool result (Qwen 3.6 quirk we caught
      // via sentinel msg-3-mp80bxwv / mp81ccpc), surface a calm one-line
      // summary that quotes the result. Never invents — only renders what
      // mcpo actually returned. Tagged as auto-generated so the operator can
      // tell it apart from real model output.
      const currentText = getCurrentText(convId, asstId);
      if (!currentText.trim()) {
        const successful = execResults.filter((r) => r.ok && r.result != null);
        if (successful.length) {
          const summary = successful.map((r) => {
            const val = typeof r.result === 'string'
              ? r.result.slice(0, 200)
              : JSON.stringify(r.result).slice(0, 280);
            return `**${r.tool_name}** → \`${val}\``;
          }).join('\n');
          patchAssistant(convId, asstId, {
            text: `_(model ran the tool but did not narrate — surfacing the result verbatim)_\n\n${summary}`,
            status: null,
            statusNote: undefined,
          });
          return;
        }
      }
      patchAssistant(convId, asstId, {
        status: null,
        statusNote: undefined,
      });
      return;
    }
    // More tool calls — push assistant message and loop
    history.push({
      role: 'assistant',
      content: turnResult.finalText || '',
      tool_calls: turnResult.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: tc.function })),
    });
    pendingCalls = turnResult.toolCalls;
  }
  patchAssistant(convId, asstId, {
    text: getCurrentText(convId, asstId) + `\n\n_— tool loop hit ${MAX_TOOL_ROUNDS}-round cap. Stopping to avoid runaway. Ask again to continue._`,
    status: null,
    statusNote: undefined,
  });
}

/** Manual or sentinel-triggered escalate: find the nearest user message
 *  preceding this assistant turn and dispatch Opus on it. Wired to the
 *  "Escalate to Opus" button on each msg AND to the AuditPill's
 *  auto-trigger when the sentinel verdict suggests it.
 *  D-AGENT-005: only flip the `escalated` flag once the guard checks pass,
 *  otherwise a silent no-op (e.g. mid-stream click) still pollutes state.
 *  Tick-005: opts.reason now flows through so the Opus message header can
 *  distinguish operator-initiated from sentinel-initiated escalations. */
export function escalateToOpus(msgId: string, opts: { reason?: string } = {}): boolean {
  const s = getState();
  // Guard early: don't pollute state if a stream is already live.
  // Tick-009: returns boolean so callers (AuditPill) can know whether the
  // dispatch actually ran — eliminates the chip-vs-counter divergence.
  if (s.streamingMsgId) return false;
  if (s.bridgeStatus.kind !== 'ready') return false;
  const conv = selectActive(s);
  if (!conv) return false;
  const idx = conv.messages.findIndex((m) => m.id === msgId);
  if (idx < 0) return false;
  // Walk back to nearest user message
  let userText = '';
  for (let i = idx; i >= 0; i--) {
    if (conv.messages[i].role === 'user') { userText = (conv.messages[i] as any).text; break; }
  }
  if (!userText) return false;
  // Now safe to flip flag + dispatch
  patchAssistant(conv.id, msgId, { escalated: true });
  void runOpusFallback(conv.id, userText, { reason: opts.reason ?? 'manual escalate' });
  // Tick-008: telemetry. Treat `sentinel auto` (the string AuditPill passes)
  // as auto; anything else as manual. Persist immediately so the count
  // survives a refresh.
  const isAuto = opts.reason === 'sentinel auto';
  setState((s) => {
    const next: Telemetry = {
      ...s.telemetry,
      escalationsManual: s.telemetry.escalationsManual + (isAuto ? 0 : 1),
      escalationsAuto:   s.telemetry.escalationsAuto   + (isAuto ? 1 : 0),
    };
    saveTelemetry(next);
    return { telemetry: next };
  });
  return true;
}

/**
 * rerunWithTools (tick-011) — sentinel's other recommendation path.
 *
 * Sometimes the sentinel flags `suggested_action: 'rerun_with_tools'`,
 * meaning: the model answered without using a tool, but a tool was
 * available that would have produced a better answer. This re-fires the
 * original turn with `tool_choice: 'required'`, forcing the model to
 * call at least one tool.
 *
 * Differs from `escalateToOpus`:
 *  • stays on the local Trinity brain (no Opus bridge needed)
 *  • requires `toolBridgeStatus.kind === 'ready'` + at least one tool loaded
 *  • leaves the original assistant message alone (it stays visible);
 *    a new assistant reply is appended below
 *
 * Returns true iff the dispatch fired.
 */
export function rerunWithTools(msgId: string, opts: { reason?: string } = {}): boolean {
  const s = getState();
  if (s.streamingMsgId) return false;
  if (s.toolBridgeStatus.kind !== 'ready') return false;
  if (s.tools.length === 0) return false;
  const conv = selectActive(s);
  if (!conv) return false;
  const idx = conv.messages.findIndex((m) => m.id === msgId);
  if (idx < 0) return false;
  // Tag the original asst as "rerun requested" so AuditPill doesn't
  // dispatch a SECOND rerun on the same msg later. (Mirrors how
  // escalateToOpus tags `escalated: true`.)
  patchAssistant(conv.id, msgId, { reranWithTools: true });
  // Tick-019 (B2 fix from chat E2E agent): bump telemetry BEFORE the
  // runLiveCompletion dispatch. runLiveCompletion's setState (placeholder
  // push) was being interleaved ahead of our telemetry setState in the
  // dispatcher microtask order, leaving the chip rendered for ~15 s while
  // the counter still read 0. Doing the counter bump first makes the
  // chip-vs-counter agreement atomic on the React commit boundary.
  setState((s) => {
    const next: Telemetry = {
      ...s.telemetry,
      rerunsWithTools: s.telemetry.rerunsWithTools + 1,
    };
    saveTelemetry(next);
    return { telemetry: next };
  });
  // Fire — runLiveCompletion will look at conv.messages, build history,
  // append a new placeholder, stream the next assistant reply.
  void runLiveCompletion(conv.id, { forceTools: true, rerunReason: opts.reason ?? 'sentinel rerun' });
  return true;
}

function getMsg(convId: string, msgId: string): AssistantMessage | null {
  const c = getState().conversations.find((x) => x.id === convId);
  const m = c?.messages.find((x) => x.id === msgId);
  return (m && m.role === 'assistant') ? m : null;
}
function getCurrentText(convId: string, msgId: string): string {
  return getMsg(convId, msgId)?.text ?? '';
}
function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return { _raw: s }; }
}

/* ─── SCRIPTED PATH — used when offline or no connection ──────────────────── */

function runScriptedCompletion(convId: string, prompt: string, scripted?: ScriptedConversation) {
  const conv = getState().conversations.find((c) => c.id === convId);
  if (!conv) return;
  const cursor = getState().scriptCursor[conv.id] ?? 0;
  let script = scripted ?? SCRIPTED_CONVOS.find((s) => s.id === conv.id);
  let turn = script?.turns.slice(cursor).find((t) => t.role === 'assistant');

  if (!turn || turn.role !== 'assistant') {
    script = pickDemoForPrompt(prompt);
    turn = script.turns.find((t) => t.role === 'assistant');
    if (!turn || turn.role !== 'assistant') return;
    setState((s) => ({ scriptCursor: { ...s.scriptCursor, [conv.id]: 0 } }));
  }

  const asstId = nextId('msg');
  const placeholder: AssistantMessage = {
    id: asstId, role: 'assistant', brain: turn.brain,
    underlying: turn.underlying,
    text: '', thinking: turn.thinking,
    toolCalls: turn.toolCalls?.map((tc) => ({ ...tc, id: nextId('tc') })),
    artifact: turn.artifact && { ...turn.artifact, id: nextId('art'), version: 1 },
    followups: turn.followups, tokens: turn.tokens, latencyMs: turn.latencyMs, costUsd: turn.costUsd,
    streaming: true, status: 'queued', createdAt: Date.now(),
  };
  pushMessage(conv.id, placeholder);
  setState(() => ({ streamingMsgId: asstId, scriptCursor: { ...getState().scriptCursor, [conv.id]: cursor + 2 } }));
  if (placeholder.artifact) setActiveArtifact(asstId);

  // D-AGENT-003: any early `return` from the loop below used to leave
  // `streamingMsgId` stuck on the scripted message — the composer was then
  // jammed in Stop-mode permanently until the user refreshed. Centralise
  // cleanup in `finalize()` and call it on every exit path (cancel or natural).
  let cancelled = false;
  const finalize = (opts: { stopped?: boolean } = {}) => {
    patchAssistant(conv.id, asstId, {
      streaming: false,
      status: null,
      statusNote: undefined,
      text: opts.stopped ? ((getMsg(conv.id, asstId)?.text || '') + ' — [stopped]') : (getMsg(conv.id, asstId)?.text || ''),
    });
    setState(() => ({ streamingMsgId: null }));
    if (cancelCurrent) cancelCurrent = null;
  };
  cancelCurrent = () => { cancelled = true; finalize({ stopped: true }); };

  (async () => {
    for (const beat of turn!.statuses) {
      if (cancelled) return;
      patchAssistant(conv.id, asstId, { status: beat.kind, statusNote: beat.note });
      await sleep(beat.ms);
    }
    if (cancelled) return;
    patchAssistant(conv.id, asstId, { status: null, statusNote: undefined });
    const full = turn!.text;
    const chunkSize = Math.max(1, Math.round(full.length / 320));
    for (let i = chunkSize; i <= full.length; i += chunkSize) {
      if (cancelled) return;
      patchAssistant(conv.id, asstId, { text: full.slice(0, i) });
      await sleep(14);
    }
    if (cancelled) return;
    patchAssistant(conv.id, asstId, { text: full });
    finalize();
  })();
}

function pushMessage(convId: string, m: Message) {
  setState((s) => ({
    conversations: s.conversations.map((c) => {
      if (c.id !== convId) return c;
      // D-005: preserve curated titles. Only auto-title when the conversation
      // is still on the default placeholder.
      const shouldRetitle =
        c.messages.length === 0 &&
        m.role === 'user' &&
        c.title.trim().toLowerCase() === 'new conversation';
      return {
        ...c,
        messages: [...c.messages, m],
        updatedAt: Date.now(),
        title: shouldRetitle ? truncateTitle(m.text) : c.title,
      };
    }),
  }));
  _scheduleSave(convId);
}
function patchAssistant(convId: string, msgId: string, patch: Partial<AssistantMessage>) {
  setState((s) => ({
    conversations: s.conversations.map((c) => c.id !== convId ? c
      : { ...c, messages: c.messages.map((m) => m.id === msgId && m.role === 'assistant' ? { ...m, ...patch } : m) }),
  }));
  // Most token-by-token deltas fall inside the 600 ms debounce window so we
  // only commit once when the stream finishes — cheap, but covers the case
  // where a refresh lands mid-stream too.
  _scheduleSave(convId);
}
function truncateTitle(t: string) { return t.length > 60 ? t.slice(0, 57) + '…' : t; }
function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

// Public action: load a scripted conversation into the active slot
export function loadScripted(id: string) {
  const script = SCRIPTED_CONVOS.find((s) => s.id === id);
  if (!script) return;
  setState((s) => {
    if (s.conversations.some((c) => c.id === id)) {
      return { activeConvId: id, activeArtifactMsgId: null, paletteOpen: false };
    }
    return {};
  });
  const conv = selectActive(getState());
  if (!conv) return;
  setState((s) => ({
    conversations: s.conversations.map((c) => c.id === conv.id ? { ...c, messages: [] } : c),
    scriptCursor: { ...s.scriptCursor, [conv.id]: 0 },
  }));
  for (let i = 0; i < script.turns.length; i++) {
    const t = script.turns[i];
    if (t.role === 'user') {
      pushMessage(conv.id, { id: nextId('msg'), role: 'user', text: t.text, createdAt: Date.now() });
    } else {
      pushMessage(conv.id, {
        id: nextId('msg'), role: 'assistant', brain: t.brain,
        underlying: t.underlying,
        text: t.text, thinking: t.thinking,
        toolCalls: t.toolCalls?.map((tc) => ({ ...tc, id: nextId('tc') })),
        artifact: t.artifact && { ...t.artifact, id: nextId('art'), version: 1 },
        followups: t.followups, tokens: t.tokens, latencyMs: t.latencyMs, costUsd: t.costUsd,
        streaming: false, status: null, createdAt: Date.now(),
      });
    }
  }
  setState((s) => ({ scriptCursor: { ...s.scriptCursor, [conv.id]: script.turns.length } }));
  const latest = selectActive(getState())?.messages.slice().reverse().find((m) => m.role === 'assistant' && m.artifact);
  if (latest && latest.role === 'assistant' && latest.artifact) setActiveArtifact(latest.id);
}

export type Status_ = Status;
export type { UnderlyingBrain };
