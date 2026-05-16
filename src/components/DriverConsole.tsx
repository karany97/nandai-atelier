// DriverConsole.tsx — the "tell the AI what to do" footer inside the
// Computer pane. Lives below the KasmVNC iframe.
//
// Talks to the destiny-computer driver (default :8090). Three jobs:
//
//   1. Show a single-line goal input + "Run" button. Click submits to
//      POST /api/task. Returns 202 + task_id.
//   2. Subscribe to /api/task/{id}/stream (Server-Sent-Events) and render
//      each step record as a one-line entry: "step 3 · click(612,431) · ok".
//   3. Show running task status: model used, total cost, step count.
//
// Why a separate component (not inside ComputerPane.tsx)? Two reasons:
//   - ComputerPane is purely the iframe + chrome — keep that file under
//     200 LOC and easy to reason about visually
//   - The driver console may someday move into the message thread itself
//     (so the AI's actions interleave with the conversation). Keeping it
//     as a standalone component makes that refactor a one-line move.
//
// Failure modes are explicit so the operator doesn't blame the chat for
// a driver-side issue:
//   - 503 desktop unreachable → "the desktop container is offline"
//   - 402 budget exceeded     → "today's $X cap reached, try tomorrow"
//   - network error           → "couldn't reach driver at {url}"
//   - SSE close before end    → "stream ended unexpectedly"

import { useEffect, useRef, useState } from 'react';
import { Send, AlertCircle, CheckCircle2, Activity, DollarSign } from 'lucide-react';

export type DriverStep = {
  task_id: string;
  step: number;
  action: Record<string, unknown> | null;
  result: string | null;
  text: string | null;
  cost_usd: number;
  total_cost_usd: number;
  status: string;
};

type Props = {
  /** Base URL of the destiny-computer driver (e.g. https://pc-you.example.com/ or http://127.0.0.1:8090). */
  driverUrl: string;
};

type ConsoleState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'running'; taskId: string; steps: DriverStep[]; totalUsd: number; lastStatus: string }
  | { kind: 'completed'; taskId: string; steps: DriverStep[]; totalUsd: number; finalText: string | null }
  | { kind: 'error'; message: string };

export function DriverConsole({ driverUrl }: Props) {
  const [goal, setGoal] = useState('');
  const [state, setState] = useState<ConsoleState>({ kind: 'idle' });
  const esRef = useRef<EventSource | null>(null);
  const stepsRef = useRef<HTMLDivElement>(null);

  // Close the SSE on unmount so we don't leak connections when the pane
  // is hidden mid-task.
  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  // Auto-scroll the step list to the bottom as new steps arrive.
  useEffect(() => {
    if (stepsRef.current && state.kind === 'running') {
      stepsRef.current.scrollTop = stepsRef.current.scrollHeight;
    }
  }, [state]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = goal.trim();
    if (!trimmed) return;
    if (!driverUrl) {
      setState({ kind: 'error', message: 'No driver URL configured. Add it in Settings → Computer.' });
      return;
    }

    // Close any stale stream
    esRef.current?.close();
    esRef.current = null;

    setState({ kind: 'submitting' });
    let taskId: string;
    try {
      const base = driverUrl.replace(/\/+$/, '');
      const res = await fetch(`${base}/api/task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal: trimmed }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // 402 = budget exceeded, 503 = desktop unreachable
        const human =
          res.status === 402 ? "Today's spending cap is reached — try again tomorrow." :
          res.status === 503 ? 'The desktop container is offline.' :
          res.status === 400 ? `Bad request: ${text}` :
          `Driver returned HTTP ${res.status}: ${text.slice(0, 200)}`;
        setState({ kind: 'error', message: human });
        return;
      }
      const body = await res.json();
      taskId = body.task_id;
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err);
      setState({ kind: 'error', message: `Couldn't reach driver: ${m}` });
      return;
    }

    setState({ kind: 'running', taskId, steps: [], totalUsd: 0, lastStatus: 'running' });
    setGoal('');

    // Open the SSE stream. EventSource is built into all evergreen browsers.
    const base = driverUrl.replace(/\/+$/, '');
    const es = new EventSource(`${base}/api/task/${taskId}/stream`);
    esRef.current = es;

    es.addEventListener('step', (ev: MessageEvent) => {
      try {
        const step = JSON.parse(ev.data) as DriverStep;
        setState((prev) =>
          prev.kind === 'running'
            ? {
                kind: 'running',
                taskId: prev.taskId,
                steps: [...prev.steps, step].slice(-50), // keep last 50 for memory
                totalUsd: step.total_cost_usd,
                lastStatus: step.status,
              }
            : prev,
        );
      } catch {
        /* ignore malformed event */
      }
    });

    es.addEventListener('end', () => {
      es.close();
      esRef.current = null;
      // Fetch the final transcript to get final_text (which the stream
      // doesn't carry — it only sends per-step records).
      fetch(`${base}/api/task/${taskId}`)
        .then((r) => r.json())
        .then((tr) => {
          setState((prev) =>
            prev.kind === 'running' && prev.taskId === taskId
              ? {
                  kind: 'completed',
                  taskId,
                  steps: prev.steps,
                  totalUsd: tr.total_cost_usd ?? prev.totalUsd,
                  finalText: tr.final_text ?? null,
                }
              : prev,
          );
        })
        .catch(() => {
          setState((prev) =>
            prev.kind === 'running' && prev.taskId === taskId
              ? { kind: 'completed', taskId, steps: prev.steps, totalUsd: prev.totalUsd, finalText: null }
              : prev,
          );
        });
    });

    es.addEventListener('error', () => {
      // EventSource auto-reconnects on transient errors. Only treat as terminal
      // if the connection has been closed (readyState 2 = CLOSED).
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null;
        setState((prev) =>
          prev.kind === 'running' && prev.taskId === taskId
            ? { kind: 'error', message: 'Stream connection dropped' }
            : prev,
        );
      }
    });
  }

  return (
    <section
      aria-label="AI task console"
      className="border-t border-border bg-background/60 flex flex-col max-h-[40vh] min-h-[140px]"
    >
      {/* Status strip */}
      {state.kind === 'running' && (
        <StatusStrip
          icon={<Activity size={11} className="animate-pulse text-primary" />}
          left={`Step ${state.steps.length} · ${state.lastStatus}`}
          right={`$${state.totalUsd.toFixed(4)}`}
        />
      )}
      {state.kind === 'completed' && (
        <StatusStrip
          icon={<CheckCircle2 size={11} className="text-emerald-500" />}
          left="Completed"
          right={`$${state.totalUsd.toFixed(4)}`}
        />
      )}
      {state.kind === 'error' && (
        <StatusStrip
          icon={<AlertCircle size={11} className="text-red-500" />}
          left={state.message}
          right={undefined}
        />
      )}
      {state.kind === 'submitting' && (
        <StatusStrip
          icon={<Activity size={11} className="animate-spin text-primary" />}
          left="Spawning task…"
          right={undefined}
        />
      )}

      {/* Step stream */}
      {(state.kind === 'running' || state.kind === 'completed') && (
        <div
          ref={stepsRef}
          className="flex-1 overflow-y-auto px-3 py-1.5 text-[11px] font-mono leading-relaxed"
        >
          {state.steps.map((s) => (
            <StepLine key={s.step} step={s} />
          ))}
          {state.kind === 'completed' && state.finalText && (
            <div className="mt-2 px-2 py-1.5 rounded bg-primary/5 text-foreground/90 text-[12px] font-sans">
              {state.finalText}
            </div>
          )}
        </div>
      )}

      {/* Goal input */}
      <form onSubmit={submit} className="border-t border-border px-2 py-2 flex items-center gap-2">
        <input
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Tell the AI what to do on the desktop…"
          aria-label="Goal for the AI"
          disabled={state.kind === 'submitting'}
          className="flex-1 bg-transparent border-0 outline-none text-[12.5px] placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={state.kind === 'submitting' || !goal.trim()}
          className="btn-icon disabled:opacity-40"
          title="Run task on desktop (Cmd+Enter)"
          aria-label="Run task on desktop"
        >
          <Send size={13} />
        </button>
      </form>
    </section>
  );
}

function StatusStrip(props: { icon: React.ReactNode; left: string; right: string | undefined }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 text-[11px] text-muted-foreground">
      {props.icon}
      <span className="truncate">{props.left}</span>
      <div className="flex-1" />
      {props.right && (
        <span className="font-mono inline-flex items-center gap-1">
          <DollarSign size={10} />
          {props.right.replace('$', '')}
        </span>
      )}
    </div>
  );
}

function StepLine({ step }: { step: DriverStep }) {
  const actionLabel = formatAction(step.action);
  const ok = !step.result?.startsWith('desktop error');
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-muted-foreground/60 w-6 text-right">{step.step}</span>
      <span className={ok ? 'text-foreground/85' : 'text-red-500'}>{actionLabel}</span>
      {step.result && (
        <span className="text-muted-foreground truncate">· {step.result}</span>
      )}
    </div>
  );
}

function formatAction(action: Record<string, unknown> | null): string {
  if (!action) return '(text only)';
  const a = String(action.action ?? 'unknown');
  const coord = action.coordinate;
  const text = action.text;
  if (Array.isArray(coord) && coord.length === 2) {
    return `${a}(${coord[0]},${coord[1]})`;
  }
  if (typeof text === 'string') {
    return `${a}("${text.slice(0, 24)}${text.length > 24 ? '…' : ''}")`;
  }
  return a;
}
