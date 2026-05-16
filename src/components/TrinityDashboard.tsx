import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Activity, Cpu, Brain, Wrench, Cloud, Zap, ShieldCheck, Gauge, Sparkles, AlertCircle, RotateCcw,
} from 'lucide-react';
import { useStore, setDashboard, probeConnection, probeBridge, resetTelemetry } from '../lib/store';
import { UNDERLYING_META, type UnderlyingBrain } from '../lib/types';

const UNDERLYING_ICON: Record<UnderlyingBrain, React.ComponentType<{ size?: number }>> = {
  fast: Cpu, think: Brain, tool: Wrench, moa: Sparkles, escape: Cloud,
};

// D-AUDIT-003: dashboard is now visibly labeled as a synthetic preview.
// Real performance data would require server-side instrumentation we don't have
// in-artifact — fabricating numbers would violate the no-cheating contract.

type Sample = Record<UnderlyingBrain, number>;
const seed = (): Sample => ({
  fast:   25 + Math.random() * 22,
  think:  30 + Math.random() * 12,
  tool:   10 + Math.random() * 4,
  moa:    18 + Math.random() * 6,
  escape: 0,
});

export function TrinityDashboard() {
  const open = useStore((s) => s.dashboardOpen);
  const streaming = useStore((s) => !!s.streamingMsgId);
  const connStatus = useStore((s) => s.connectStatus);
  const bridgeStatus = useStore((s) => s.bridgeStatus);
  const conn = useStore((s) => s.connection);
  const [history, setHistory] = useState<Sample[]>(() => Array.from({ length: 30 }, seed));

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      setHistory((h) => [...h.slice(-29), seed()]);
    }, streaming ? 380 : 900);
    return () => clearInterval(t);
  }, [open, streaming]);

  // a11y: focus restore
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    trigger.current = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => trigger.current?.focus?.();
  }, [open]);

  const latest = history.at(-1)!;
  const peaks = useMemo(() => {
    const out: Record<UnderlyingBrain, number> = { fast: 0, think: 0, tool: 0, moa: 0, escape: 1 };
    for (const k of Object.keys(out) as UnderlyingBrain[]) {
      out[k] = Math.max(...history.map((h) => h[k]), out[k]);
    }
    return out;
  }, [history]);

  const titleId = useId();

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setDashboard(false)} />
          <motion.div
            ref={ref}
            initial={{ y: 16, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 14, opacity: 0 }}
            className="relative w-full max-w-[960px] max-h-[85vh] overflow-y-auto rounded-2xl glass-modal border border-border shadow-2xl"
          >
            <header className="flex items-center justify-between px-6 py-4 border-b border-border/60 sticky top-0 bg-card z-10">
              <div>
                <h2 id={titleId} className="font-serif text-2xl flex items-center gap-2">
                  <Activity size={18} className="text-[color:hsl(var(--accent-1))]" />
                  Trinity status
                </h2>
                <div className="text-[10.5px] tracking-[0.2em] uppercase text-muted-foreground mt-1">
                  Live router · LiteLLM {conn.baseUrl.replace(/^https?:\/\//, '')}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {connStatus.kind === 'connected'
                  ? <span className="chip"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Gateway up</span>
                  : <span className="chip"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Gateway {connStatus.kind}</span>}
                {bridgeStatus.kind === 'ready'
                  ? <span className="chip"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Bridge ready</span>
                  : <span className="chip"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Bridge {bridgeStatus.kind === 'down' ? 'down' : 'unknown'}</span>}
                <button onClick={() => setDashboard(false)} className="btn-icon" aria-label="Close dashboard"><X size={16} /></button>
              </div>
            </header>

            <div className="p-6 space-y-6">

              {/* D-AUDIT-003 disclosure banner — clear, before anything else */}
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <div>
                  <strong>Preview metrics — not live.</strong> The sparklines and KPIs below
                  are synthetic placeholders illustrating the dashboard's planned shape.
                  Real per-brain throughput / latency / error counts need server-side
                  instrumentation on the gateway. The two pills above (Gateway / Bridge) and
                  the model list under Settings ARE live.
                </div>
              </div>

              {/* Real metrics — sentinel escalations (tick-008) */}
              <EscalationMetrics />

              {/* Real health row */}
              <div className="grid md:grid-cols-2 gap-3">
                <HealthCard
                  title="Nandai-One · LiteLLM"
                  status={connStatus.kind}
                  detail={connStatus.kind === 'connected'
                    ? `${connStatus.models.length} models published · checked ${secsAgo(connStatus.checkedAt)}s ago`
                    : connStatus.kind === 'error' ? connStatus.message
                    : connStatus.kind === 'connecting' ? 'Probing…'
                    : 'Unconfigured'}
                  action="Re-probe"
                  onAction={probeConnection}
                />
                <HealthCard
                  title="Opus bridge · Claude Code"
                  status={bridgeStatus.kind === 'ready' ? 'connected' : bridgeStatus.kind === 'down' ? 'error' : 'unconfigured'}
                  detail={bridgeStatus.kind === 'ready'
                    ? `Bridge ready${bridgeStatus.version ? ` · ${bridgeStatus.version}` : ''}`
                    : bridgeStatus.kind === 'down' ? bridgeStatus.message
                    : 'Unknown'}
                  action="Re-probe"
                  onAction={probeBridge}
                />
              </div>

              {/* Top KPIs (preview) */}
              <div>
                <div className="text-[10.5px] tracking-[0.22em] uppercase text-muted-foreground mb-3">
                  Preview · synthetic
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Kpi icon={<Zap size={14} />} label="Combined throughput (sim)"
                    value={`${Math.round(latest.fast + latest.think + latest.tool + latest.moa)} t/s`} />
                  <Kpi icon={<Sparkles size={14} />} label="Underlying experts" value="4 + 1" />
                  <Kpi icon={<ShieldCheck size={14} />} label="ToolACE BFCL v3" value="91.4%" />
                  <Kpi icon={<Gauge size={14} />} label="P95 latency · 1k tok (target)" value="≤ 1.8 s" />
                </div>
              </div>

              {/* Per-expert cards with sparkline */}
              <div className="grid md:grid-cols-2 gap-3">
                {(['fast', 'think', 'tool', 'moa'] as UnderlyingBrain[]).map((k) => {
                  const I = UNDERLYING_ICON[k];
                  const m = UNDERLYING_META[k];
                  const series = history.map((s) => s[k]);
                  return (
                    <div key={k} className="rounded-2xl border border-border/60 p-4 bg-card/40 relative overflow-hidden">
                      <div className="relative flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="h-7 w-7 grid place-items-center rounded-lg border border-border/60 bg-foreground/[0.04]">
                              <I size={13} />
                            </span>
                            <div>
                              <div className="font-serif text-[1rem] leading-none">{m.label}</div>
                              <div className="text-[10px] tracking-[0.16em] uppercase text-muted-foreground mt-1">{m.tagline}</div>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-[14px] text-muted-foreground">{series.at(-1)!.toFixed(1)} t/s</div>
                          <div className="text-[10px] tracking-[0.16em] uppercase text-muted-foreground/70">sim · peak {peaks[k].toFixed(1)}</div>
                        </div>
                      </div>
                      <Sparkline data={series} color="hsl(var(--accent-1))" />
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function HealthCard({ title, status, detail, action, onAction }: {
  title: string; status: string; detail: string; action: string; onAction: () => void;
}) {
  const ok = status === 'connected' || status === 'ready';
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10.5px] tracking-[0.2em] uppercase text-muted-foreground">{title}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span className="font-serif text-lg">{ok ? 'Online' : status}</span>
          </div>
          <div className="mt-1 text-[11.5px] text-muted-foreground break-words">{detail}</div>
        </div>
        <button onClick={onAction} className="btn-ghost !text-[11px] !py-1">{action}</button>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1.5 font-serif text-2xl">{value}</div>
    </div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 280, h = 40, pad = 4;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const stepX = (w - pad * 2) / Math.max(1, data.length - 1);
  const points = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / Math.max(1, max - min)) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full mt-3" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <polyline points={`${points} ${pad + (data.length - 1) * stepX},${h} ${pad},${h}`}
        fill={color} fillOpacity="0.12" stroke="none" />
    </svg>
  );
}

function secsAgo(t: number): number { return Math.round((Date.now() - t) / 1000); }

/**
 * EscalationMetrics — REAL counters, not synthetic. Pulls from the store's
 * telemetry slice (persisted to localStorage via store.ts). Sits above the
 * synthetic preview row so the user has at least one truly live number on
 * this dashboard.
 *
 * Reset button is a small affordance — counters are sometimes worth
 * re-baselining (e.g. after the sentinel's threshold is retuned).
 */
function EscalationMetrics() {
  const t = useStore((s) => s.telemetry);
  // Tick-011: rerunsWithTools is a third counter (sentinel suggested the
  // model should have used a tool). Track it but exclude from the
  // escalation TOTAL — it's a SEPARATE action class (re-fire in place
  // vs hand off to a different brain). Surfaced as its own KPI tile.
  const total = t.escalationsManual + t.escalationsAuto;
  const sinceLabel = new Date(t.since).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  const grandTotal = total + t.rerunsWithTools;
  const onReset = () => {
    if (grandTotal === 0) { resetTelemetry(); return; }
    if (window.confirm(`Reset sentinel counters? Currently tracking ${grandTotal} actions (${total} escalations + ${t.rerunsWithTools} reruns) since ${sinceLabel}.`)) {
      resetTelemetry();
    }
  };
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[10.5px] tracking-[0.22em] uppercase text-muted-foreground">
          Sentinel actions · live
        </div>
        <button
          onClick={onReset}
          className="btn-ghost !text-[10.5px] !py-0.5 !px-2 inline-flex items-center gap-1"
          title="Reset all sentinel counters"
        >
          <RotateCcw size={11} /> reset
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <RealKpi label="Manual escalate" value={t.escalationsManual}
          hint="operator clicked Escalate to Opus" />
        <RealKpi label="Sentinel auto-escalate" value={t.escalationsAuto}
          hint="suggested_action = escalate_to_opus" />
        <RealKpi label="Sentinel rerun-with-tools" value={t.rerunsWithTools}
          hint="suggested_action = rerun_with_tools" />
        <RealKpi label="Total" value={grandTotal} hint={`since ${sinceLabel}`} accent />
      </div>
    </div>
  );
}

function RealKpi({ label, value, hint, accent }: {
  label: string; value: number; hint: string; accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${
      accent ? 'border-[color:hsl(var(--accent-1))]/40 bg-[color:hsl(var(--accent-1))]/[0.04]' : 'border-border/60 bg-card/40'
    }`}>
      <div className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{label}</div>
      <div className="mt-1.5 font-mono text-2xl tabular-nums">{value}</div>
      <div className="text-[10.5px] text-muted-foreground/80 mt-1">{hint}</div>
    </div>
  );
}
