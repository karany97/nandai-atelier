// AuditPill — fetches the sentinel verdict for one assistant message and
// surfaces its 8-axis score as a small pill next to the brain badge.
//
// Behaviour:
//  • Polls /sentinel/{turn_id} ~10s after mount; retries up to 3 times with
//    backoff in case the sentinel is still judging (typical Hermes call
//    completes in 5-12s after the chat POSTs the turn).
//  • Renders nothing while loading (no flicker).
//  • Once the verdict lands, shows a colored dot + count of failed axes.
//  • Click expands a drawer with the 8 axes + why-strings + suggested action.

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, ChevronDown } from 'lucide-react';
import {
  escalateToOpus, rerunWithTools, useStore,
  broadcastVerdict, subscribeVerdicts, getCachedVerdict,
} from '../lib/store';
import { fetchSentinelVerdict, type SentinelVerdict } from '../lib/tool-bridge';

export function AuditPill({ msgId, alreadyEscalated, alreadyReran }: {
  msgId: string;
  alreadyEscalated?: boolean;
  /** True if the sentinel already fired a rerun_with_tools on this msg.
   *  Prevents double-rerun on remount. */
  alreadyReran?: boolean;
}) {
  const cfg = useStore((s) => ({ baseUrl: s.connection.toolBridgeUrl }));
  const autoEscalateEnabled = useStore((s) => s.connection.autoEscalate);
  const bridgeReady = useStore((s) => s.bridgeStatus.kind === 'ready');
  const toolsReady = useStore((s) => s.toolBridgeStatus.kind === 'ready' && s.tools.length > 0);
  const streaming = useStore((s) => s.streamingMsgId != null);
  // Tick-016: synchronous cache lookup as the useState initializer. If a
  // sibling tab already broadcast this verdict (or the same tab did but the
  // AuditPill remounted), we render with the result immediately — no poll,
  // no flicker. Empty cache (cold start) returns null and the poll loop
  // engages as before.
  const [verdict, setVerdict] = useState<SentinelVerdict | null>(
    () => (getCachedVerdict(msgId) as SentinelVerdict | null) ?? null,
  );
  const [open, setOpen] = useState(false);
  const [autoTriggered, setAutoTriggered] = useState(false);
  const [rerunTriggered, setRerunTriggered] = useState(false);
  const attempted = useRef(false);
  // Tick-015: poll loop reads this ref before each fetch so it can bail
  // when a sibling tab's broadcast already delivered the verdict. Without
  // this, both tabs would still fetch in lockstep at t=8s.
  const verdictRef = useRef<SentinelVerdict | null>(null);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    // Sentinel typically lands within 5-12 s of the turn POST. Try at
    // t=8s, t=20s, t=45s. After that, give up silently (the badge just
    // never shows — no error, no clutter).
    const delays = [8_000, 12_000, 25_000];
    let cancelled = false;
    (async () => {
      for (const d of delays) {
        await new Promise((r) => setTimeout(r, d));
        if (cancelled) return;
        // Tick-015: if a sibling tab already delivered the verdict via
        // BroadcastChannel during the await, skip the fetch entirely.
        if (verdictRef.current) return;
        const v = await fetchSentinelVerdict(cfg, msgId);
        if (v) {
          setVerdict(v);
          // Tick-015: tell sibling tabs so they can skip their own poll.
          broadcastVerdict(msgId, v);
          return;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [msgId, cfg.baseUrl]);

  // Keep verdictRef in sync with verdict state (used by poll loop & refocus).
  useEffect(() => { verdictRef.current = verdict; }, [verdict]);

  // ─── CROSS-TAB VERDICT RECEIVE (tick-015) ────────────────────────────────
  // Listen for sibling-tab verdicts for this msgId. If one arrives BEFORE
  // our own poll lands, adopt it — and cancel future polls cheaply by
  // having the existing poll loop check `cancelled` (we set it via the
  // unmount-safe pattern below). The receive is idempotent: if we already
  // have a verdict, we ignore the broadcast.
  useEffect(() => {
    if (verdict) return;
    const unsubscribe = subscribeVerdicts((incomingMsgId, incomingVerdict) => {
      if (incomingMsgId !== msgId) return;
      // Don't overwrite a verdict we already have (avoid a stale one
      // clobbering a freshly-fetched one in a tight race).
      setVerdict((cur) => cur ?? (incomingVerdict as SentinelVerdict));
    });
    return unsubscribe;
  }, [msgId, verdict]);

  // ─── REFOCUS REFETCH (tick-007) ──────────────────────────────────────────
  // The 3-attempt poll above gives up after ~45 s. A tab that's been
  // backgrounded the whole time will miss any verdict that landed in that
  // window. When the tab regains focus, fire one more fetch — throttled
  // so spamming alt-tab doesn't hammer the executor.
  const lastRefocusFetch = useRef(0);
  useEffect(() => {
    if (verdict) return;  // already have it, no listener needed
    let cancelled = false;
    const onVisible = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      if (verdictRef.current) return;  // tick-015: skip if sibling already shared
      const now = Date.now();
      if (now - lastRefocusFetch.current < 30_000) return;  // throttle 30 s
      lastRefocusFetch.current = now;
      const v = await fetchSentinelVerdict(cfg, msgId);
      if (!cancelled && v) {
        setVerdict(v);
        broadcastVerdict(msgId, v);  // tick-015: same fan-out as the initial poll
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [verdict, cfg.baseUrl, msgId]);

  // ─── SENTINEL → OPUS AUTO-ESCALATE (tick-005) ────────────────────────────
  // The sentinel daemon already classifies every turn on 8 axes and emits a
  // `suggested_action` field. Until now the AuditPill only DISPLAYED that
  // suggestion; the operator had to click "Escalate to Opus" manually. This
  // effect closes the loop — when the verdict says `escalate_to_opus` AND
  // the bridge is up AND the user opted into auto-escalation AND this
  // message hasn't already been escalated (manual or otherwise), fire it
  // exactly once. The 400ms delay gives the verdict pill a render frame so
  // the operator can SEE the trigger before the new Opus reply appears.
  useEffect(() => {
    if (!verdict || autoTriggered) return;
    if (alreadyEscalated) return;
    if (verdict.suggested_action !== 'escalate_to_opus') return;
    if (!autoEscalateEnabled || !bridgeReady) return;
    if (streaming) return;  // never dispatch while another stream is live
    // Tick-009: only flip autoTriggered (which renders the chip) after
    // confirming the dispatch actually ran. Previously the chip rendered
    // 400ms BEFORE dispatch — if the inner guard tripped, the chip
    // showed without a counter bump. Now `escalateToOpus` returns a
    // boolean and the chip is gated on a real dispatch.
    const t = setTimeout(() => {
      const dispatched = escalateToOpus(msgId, { reason: 'sentinel auto' });
      if (dispatched) setAutoTriggered(true);
    }, 400);
    return () => clearTimeout(t);
  }, [verdict, autoTriggered, alreadyEscalated, autoEscalateEnabled, bridgeReady, streaming, msgId]);

  // ─── SENTINEL → RERUN-WITH-TOOLS (tick-011) ──────────────────────────────
  // Symmetric to the auto-escalate effect above, but for the OTHER recommendation
  // the sentinel emits — "the model didn't use a tool that was available". We
  // re-fire the turn with `tool_choice: 'required'` so the model has to call
  // at least one tool this time. Same gating discipline: chip + counter only
  // flip if rerunWithTools returns true (real dispatch happened).
  useEffect(() => {
    if (!verdict || rerunTriggered) return;
    if (alreadyReran) return;
    if (verdict.suggested_action !== 'rerun_with_tools') return;
    if (!autoEscalateEnabled) return;  // same opt-in toggle as Opus auto-escalate
    if (!toolsReady) return;
    if (streaming) return;
    const t = setTimeout(() => {
      const dispatched = rerunWithTools(msgId, { reason: 'sentinel rerun' });
      if (dispatched) setRerunTriggered(true);
    }, 400);
    return () => clearTimeout(t);
  }, [verdict, rerunTriggered, alreadyReran, autoEscalateEnabled, toolsReady, streaming, msgId]);

  if (!verdict) return null;

  const failed = verdict.failed_axes ?? [];
  const nFailed = failed.length;
  const Icon = nFailed === 0 ? ShieldCheck : nFailed === 1 ? ShieldAlert : ShieldX;
  const color = nFailed === 0 ? 'text-emerald-600 dark:text-emerald-400'
              : nFailed === 1 ? 'text-amber-600 dark:text-amber-400'
                              : 'text-red-600 dark:text-red-400';
  const label = nFailed === 0 ? 'audit · clean' : `audit · ${nFailed} flag${nFailed > 1 ? 's' : ''}`;

  return (
    <span className="relative inline-flex items-baseline">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Sentinel audit — ${nFailed} axes failed`}
        title={
          'Sentinel (Hermes 4.3-36B) judged this turn. ' +
          (nFailed === 0 ? 'All 8 axes clean.' : `Failed: ${failed.join(', ')}.`)
        }
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium border border-border hover:border-foreground/20 transition-colors ${color}`}
      >
        <Icon size={10} />
        <span>{label}</span>
        <ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {autoTriggered && (
        <span
          className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] uppercase tracking-wide font-medium text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30"
          title="The sentinel verdict suggested escalation; the chat dispatched the Opus bridge automatically."
        >
          auto-escalated
        </span>
      )}
      {rerunTriggered && (
        <span
          className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] uppercase tracking-wide font-medium text-sky-700 dark:text-sky-300 bg-sky-500/10 border border-sky-500/30"
          title="The sentinel verdict said the model should have used a tool; the chat re-fired the turn with tool_choice='required'."
        >
          sentinel rerun
        </span>
      )}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-[340px] max-w-[90vw] glass-modal p-3 rounded-lg shadow-xl">
          <div className="text-[10.5px] tracking-[0.14em] uppercase text-muted-foreground mb-2">
            Sentinel verdict
          </div>
          {verdict.suggested_action && verdict.suggested_action !== 'none' && (
            <div className="mb-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-500/10 px-2 py-1 rounded">
              suggested: <span className="font-mono">{verdict.suggested_action}</span>
            </div>
          )}
          <ul className="space-y-1">
            {Object.entries(verdict.axes ?? {}).map(([axis, v]) => {
              const verdictText = (v as any)?.verdict ?? '?';
              const why = (v as any)?.why ?? (v as any)?.span ?? '';
              const okThis = verdictText === 'no' || verdictText === 'yes';
              const passColor =
                (axis === 'fully_addressed' || axis === 'brain_route_match')
                  ? (verdictText === 'yes' ? 'text-emerald-600' : 'text-amber-600')
                  : (verdictText === 'no' ? 'text-emerald-600' : 'text-amber-600');
              return (
                <li key={axis} className="text-[11.5px] leading-snug">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-foreground">{axis.replace(/_/g, ' ')}</span>
                    <span className={`text-[10.5px] font-medium ${okThis ? passColor : 'text-muted-foreground'}`}>{verdictText}</span>
                  </div>
                  {why && <div className="text-[10.5px] text-muted-foreground pl-2">{why}</div>}
                </li>
              );
            })}
          </ul>
          <div className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground">
            Judge: nandai-think · Hermes 4.3-36B · local · $0
          </div>
        </div>
      )}
    </span>
  );
}
