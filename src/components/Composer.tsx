import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send, Mic, Paperclip, StopCircle, Sparkles, Cloud, ChevronUp, Globe, Image as ImageIcon, Slash,
} from 'lucide-react';
import {
  useStore, setComposer, sendUserMessage, stopGenerating, patchSettings, selectActive,
} from '../lib/store';
import { SLASH_COMMANDS } from '../lib/script';
import type { BrainKey } from '../lib/types';
import { BRAIN_META } from '../lib/types';

const BRAIN_ICON = { nandai: Sparkles, opus: Cloud } as const;

export function Composer() {
  const value = useStore((s) => s.composer);
  // D-FOUND-003: Stop button used to leak across conversations because
  // `streamingMsgId` is global. Constrain to: streaming AND the streaming msg
  // belongs to the currently-active conversation. If user switches convs
  // mid-stream, the inactive conv's composer goes back to Send (correct).
  const streaming = useStore((s) => {
    if (!s.streamingMsgId) return false;
    const conv = selectActive(s);
    return !!conv?.messages.some((m) => m.id === s.streamingMsgId);
  });
  const [modelOpen, setModelOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [value]);

  const slashMatch = useMemo(() => {
    if (!value.startsWith('/')) return null;
    const q = value.split(/\s/)[0].slice(1).toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(q));
  }, [value]);

  const onSubmit = (override?: string) => {
    if (streaming) return;
    sendUserMessage(override ?? value);
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 px-4 md:px-6 pb-5 pt-3 pointer-events-none bg-gradient-to-t from-background via-background/95 to-transparent">
      <div className="pointer-events-auto max-w-[760px] mx-auto relative">
        <AnimatePresence>
          {slashMatch && slashMatch.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
              className="absolute bottom-full mb-2 left-0 right-0 rounded-lg surface p-1 max-h-[260px] overflow-y-auto z-20 glass-modal"
            >
              <div className="px-2.5 py-1 text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Slash commands</div>
              {slashMatch.map((c) => (
                <button key={c.cmd}
                  onClick={() => { setComposer(c.cmd + ' '); taRef.current?.focus(); }}
                  className="w-full flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-md hover:bg-foreground/[0.05] text-left transition-colors">
                  <span className="inline-flex items-center gap-2 font-mono text-[12.5px]">
                    <Slash size={11} className="text-muted-foreground" /> {c.cmd}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">{c.desc}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Composer card — clean, single tone */}
        <div className="rounded-2xl border border-border bg-card focus-within:border-foreground/25 transition-colors shadow-[0_10px_40px_-20px_rgba(0,0,0,0.18)]">
          {/* Input row */}
          <div className="flex items-end gap-1 px-3 pt-3 pb-2">
            <button aria-label="Attach" className="btn-icon"><Paperclip size={15} /></button>
            <textarea
              ref={taRef}
              id="chat-input"
              value={value}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
              }}
              rows={1}
              placeholder="Brief the atelier…"
              className="flex-1 resize-none bg-transparent outline-none px-2 py-2 text-[15px] placeholder:text-muted-foreground/60 max-h-[200px] leading-relaxed"
            />
            <button aria-label="Voice" className="btn-icon"><Mic size={15} /></button>
            {streaming
              ? <button onClick={stopGenerating} aria-label="Stop"
                  className="h-9 w-9 rounded-md border border-red-500/30 text-red-500 hover:bg-red-500/10 inline-flex items-center justify-center transition-colors">
                  <StopCircle size={15} />
                </button>
              : <button onClick={() => onSubmit()} aria-label="Send"
                  disabled={!value.trim()}
                  className="h-9 w-9 rounded-md inline-flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  style={{ background: 'hsl(var(--accent-1))', color: 'white' }}>
                  <Send size={14} />
                </button>}
          </div>

          {/* Tools row — refined, low-contrast */}
          <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
            <div className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
              <ModelMenu open={modelOpen} setOpen={setModelOpen} />
              <ToolPill icon={<Globe size={11} />} label="Web" />
              <ToolPill icon={<ImageIcon size={11} />} label="Image" />
            </div>
            <div className="text-[10.5px] text-muted-foreground/80 inline-flex items-center gap-2.5 shrink-0">
              <span className="hidden lg:inline">All prompts stay on the studio LAN</span>
              <span className="hidden md:inline-flex items-center gap-1"><span className="kbd">⏎</span> send</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] transition-colors">
      {icon} {label}
    </button>
  );
}

function ModelMenu({ open, setOpen }: { open: boolean; setOpen: (b: boolean) => void }) {
  const route = useStore((s) => s.settings.routeMode);
  const bridgeReady = useStore((s) => s.bridgeStatus.kind === 'ready');
  const close = () => setOpen(false);

  const choose = (k: BrainKey) => { patchSettings({ routeMode: k }); close(); };
  const meta  = BRAIN_META[route];
  const Icon  = BRAIN_ICON[route];

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        aria-haspopup="menu" aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] transition-colors">
        <Icon size={11} style={{ color: meta.color }} /> {meta.label} <ChevronUp size={10} className={`transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={close} />
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
              className="absolute bottom-full left-0 mb-2 w-80 z-40 rounded-lg glass-modal p-1"
              role="menu">
              {(['nandai', 'opus'] as BrainKey[]).map((k) => {
                const I = BRAIN_ICON[k];
                const m = BRAIN_META[k];
                const disabled = k === 'opus' && !bridgeReady;
                return (
                  <button key={k} onClick={() => !disabled && choose(k)} disabled={disabled}
                    role="menuitemradio" aria-checked={route === k}
                    title={disabled ? 'Start the Claude Code bridge to enable Opus' : m.tagline}
                    className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-md text-left transition-colors ${
                      route === k ? 'bg-foreground/[0.04]' : 'hover:bg-foreground/[0.05]'
                    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <I size={14} className="mt-0.5" style={{ color: m.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-foreground flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
                        {m.label}
                        {disabled && <span className="ml-auto text-[10px] text-amber-600 dark:text-amber-400">bridge offline</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">{m.tagline}</div>
                    </div>
                  </button>
                );
              })}
              <div className="text-[10.5px] text-muted-foreground/80 px-3 py-2 border-t border-border mt-1">
                Nandai-One auto-routes between fast / think / tool / MoA experts. Opus is a manual escalation (or auto if enabled in Settings).
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
