import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Share2, MoreHorizontal, ChevronRight } from 'lucide-react';
import {
  useStore, selectActive, setComposer, loadScripted,
} from '../lib/store';
import { MessageRow } from './Message';
import { Composer } from './Composer';
import { QUICK_PROMPTS, SCRIPTED_CONVOS } from '../lib/script';
import { BRAIN_META, type BrainKey } from '../lib/types';

export function ChatPane() {
  const conv = useStore((s) => selectActive(s));
  const routeMode = useStore((s) => s.settings.routeMode);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [conv?.messages.length, (conv?.messages.at(-1) as any)?.text]);

  const lastAssistant = conv?.messages.slice().reverse().find((m) => m.role === 'assistant');
  const lastBrain: BrainKey | null = (lastAssistant?.brain as BrainKey) ?? null;
  const lastUnderlying = lastAssistant?.role === 'assistant' ? lastAssistant.underlying : undefined;

  const connStatus = useStore((s) => s.connectStatus);
  const offline    = useStore((s) => s.connection.offline);
  const isLive = !offline && connStatus.kind === 'connected';

  // D-A11Y-009: announce the latest assistant message to screen readers.
  // role="log" + aria-live="polite" lets screen readers re-announce on changes
  // without interrupting whatever the user is reading.
  const liveSnippet = (() => {
    if (!lastAssistant || lastAssistant.role !== 'assistant') return '';
    if (lastAssistant.streaming) return ''; // don't spam during stream
    // Truncate to avoid massive announcements
    return lastAssistant.text.length > 600 ? lastAssistant.text.slice(0, 600) + '…' : lastAssistant.text;
  })();

  return (
    <section className="flex-1 min-w-0 flex flex-col relative bg-background z-10" aria-label="Conversation">
      {/* Header — restrained, single line */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-background">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="font-serif text-[15px] leading-none truncate text-foreground m-0">
            {conv?.title ?? 'New chat'}
          </h1>
          <span className="text-muted-foreground/60 text-xs" aria-hidden="true">·</span>
          <div className="text-[11.5px] text-muted-foreground inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden="true" />
            {isLive ? 'Live · ' : 'Demo · '}
            {lastBrain ? BRAIN_META[lastBrain].label : BRAIN_META[routeMode].label}
            {lastUnderlying && (
              <span className="text-muted-foreground/60"> · via <span className="font-mono">{lastUnderlying}</span></span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-icon" aria-label="Share conversation"><Share2 size={14} /></button>
          <button className="btn-icon" aria-label="More options"><MoreHorizontal size={14} /></button>
        </div>
      </header>

      {/* Body — tighter horizontal padding + tighter inter-message spacing
          for Claude.ai-style density. Max-width drops from 720 to 680 to
          improve readability at default font-size. */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-8 pt-6 pb-40">
        <div className="max-w-[680px] mx-auto">
          {(!conv || conv.messages.length === 0)
            ? <EmptyState />
            : <div className="space-y-6">{conv.messages.map((m) => <MessageRow key={m.id} msg={m} />)}</div>}
        </div>
      </div>

      {/* SR-only live region for assistant output */}
      <div role="log" aria-live="polite" aria-atomic="false" className="sr-only">
        {liveSnippet}
      </div>

      <Composer />
    </section>
  );
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
      className="pt-8"
    >
      <h2 className="font-serif text-[2.2rem] leading-[1.05] text-foreground m-0">
        Good evening, sir.
      </h2>
      <p className="mt-3 text-foreground/75 text-[15px] max-w-xl leading-relaxed">
        How can the atelier help today? Two brains stand ready — <strong className="text-foreground">Nandai-One</strong>{' '}
        auto-routes locally across fast / think / tool / MoA experts; <strong className="text-foreground">Opus 4.7</strong>{' '}
        is on call as fallback via your Claude Code Max subscription.
      </p>

      <div className="mt-10 grid sm:grid-cols-2 gap-2">
        {QUICK_PROMPTS.slice(0, 4).map((p) => (
          <button
            key={p}
            onClick={() => setComposer(p)}
            className="group text-left rounded-lg border border-border bg-card hover:border-foreground/20 transition-colors px-4 py-3"
          >
            <div className="text-[13.5px] leading-snug text-foreground/90 group-hover:text-foreground">{p}</div>
          </button>
        ))}
      </div>

      <div className="mt-10">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground mb-2.5">Open a sample atelier session</div>
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {SCRIPTED_CONVOS.map((s) => (
            <button
              key={s.id}
              onClick={() => loadScripted(s.id)}
              className="group w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-foreground/[0.025] transition-colors"
            >
              <div className="min-w-0 flex items-baseline gap-3">
                <div className="text-[13.5px] truncate text-foreground/90 group-hover:text-foreground">{s.title}</div>
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground shrink-0">{s.folder}</div>
              </div>
              <ChevronRight size={13} className="text-muted-foreground group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
