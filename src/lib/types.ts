// Two logical brains exposed to the user — internal expert routing is hidden.
// The "underlying" key is the legacy upstream that actually answered, surfaced as
// a "why this brain?" trace under each reply.
export type BrainKey = 'nandai' | 'opus';
export type UnderlyingBrain = 'fast' | 'think' | 'tool' | 'moa' | 'escape';

export type Status = 'queued' | 'thinking' | 'researching' | 'generating' | 'tool-calling' | 'reflecting';

export type ArtifactKind = 'code' | 'html' | 'mermaid' | 'json' | 'markdown' | 'svg';

export type Artifact = {
  id: string;
  kind: ArtifactKind;
  title: string;
  lang?: string;       // for code: python / typescript / bash / json
  body: string;
  version?: number;
};

export type ToolCall = {
  id: string;
  name: string;        // e.g. 'shopify.inventory'
  args: Record<string, unknown>;
  result?: Record<string, unknown> | string;
  durationMs?: number;
};

export type StatusBeat = { kind: Status; ms: number; note?: string };

export type UserMessage = {
  id: string;
  role: 'user';
  text: string;
  createdAt: number;
};

export type AssistantMessage = {
  id: string;
  role: 'assistant';
  brain: BrainKey;
  underlying?: UnderlyingBrain;   // "why this brain?" trace — actual upstream that answered
  text: string;
  thinking?: string;              // expandable inner reasoning trace
  toolCalls?: ToolCall[];
  artifact?: Artifact;
  followups?: string[];
  status: Status | null;
  statusNote?: string;
  streaming: boolean;
  createdAt: number;
  escalated?: boolean;            // true if Opus was the final answerer
  /** Tick-011: tagged when the sentinel auto-fired a `rerun_with_tools` on
   *  THIS message. Prevents AuditPill from dispatching a second rerun on the
   *  same turn when the user navigates back later and the verdict re-loads. */
  reranWithTools?: boolean;
  /** Tick-019 (B5 fix from chat E2E agent): structured error text. Set when a
   *  stream / tool-loop / Opus dispatch failed. Rendered as a small red
   *  banner BELOW the body; never concatenated into msg.text (that path
   *  used to dump raw HTTP JSON into the conv body and persist it to IDB,
   *  polluting the operator's history on reload). */
  error?: string;
  tokens?: { prompt: number; completion: number };
  latencyMs?: number;
  costUsd?: number;
};

export type Message = UserMessage | AssistantMessage;

export type Conversation = {
  id: string;
  title: string;
  pinned: boolean;
  folder?: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
};

export type ScriptedTurn =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      brain: BrainKey;
      underlying?: UnderlyingBrain;
      statuses: StatusBeat[];
      text: string;
      thinking?: string;
      toolCalls?: Omit<ToolCall, 'id'>[];
      artifact?: Omit<Artifact, 'id'>;
      followups?: string[];
      tokens?: { prompt: number; completion: number };
      latencyMs?: number;
      costUsd?: number;
    };

export type ScriptedConversation = {
  id: string;
  title: string;
  folder?: string;
  pinned?: boolean;
  ageHours: number;     // for relative createdAt
  turns: ScriptedTurn[];
};

// USER-FACING BRAINS — exactly two, by design (collapsed from the legacy 5)
export const BRAIN_META: Record<BrainKey, { label: string; tagline: string; color: string; ring: string; }> = {
  nandai: {
    label:   'Nandai-One',
    tagline: 'Local unified brain · 10M-token archive · ~64k working ctx',
    color:   'hsl(25 75% 38%)',          // accent copper
    ring:    'ring-amber-400/40',
  },
  opus:   {
    label:   'Opus 4.7',
    tagline: 'Anthropic fallback via Claude Code (your Max subscription)',
    color:   'hsl(214 60% 48%)',
    ring:    'ring-sky-400/40',
  },
};

// Underlying upstream models (shown in the "why this brain?" trace only)
export const UNDERLYING_META: Record<UnderlyingBrain, { label: string; tagline: string }> = {
  fast:   { label: 'nandai-fast',   tagline: 'Qwen 3.6 · 27B · AWQ-INT4'  },
  think:  { label: 'nandai-think',  tagline: 'Hermes 4.3 · 36B · Q4_K_M'  },
  tool:   { label: 'nandai-tool',   tagline: 'ToolACE-2 · 8B · BFCL 91.4%' },
  moa:    { label: 'nandai-moa',    tagline: 'Self-MoA aggregator · +6.6% AlpacaEval' },
  escape: { label: 'nandai-escape', tagline: 'Opus 4.7 via API'           },
};

export const STATUS_LABEL: Record<Status, string> = {
  queued: 'Queued',
  thinking: 'Thinking',
  researching: 'Researching',
  generating: 'Generating',
  'tool-calling': 'Calling tools',
  reflecting: 'Reflecting',
};
