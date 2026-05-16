import { useEffect, useId, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useStore, setHelp } from '../lib/store';

const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Navigation',
    items: [
      { keys: ['⌘', 'K'], label: 'Open command palette' },
      { keys: ['⌘', 'N'], label: 'New conversation' },
      { keys: ['⌘', 'D'], label: 'Trinity status dashboard' },
      { keys: ['⌘', ','], label: 'Settings' },
      { keys: ['?'],      label: 'This shortcut overlay' },
      { keys: ['Esc'],    label: 'Close any overlay' },
    ],
  },
  {
    title: 'Composer',
    items: [
      { keys: ['↵'],      label: 'Send message' },
      { keys: ['⇧', '↵'], label: 'Newline' },
      { keys: ['/'],      label: 'Slash commands' },
      { keys: ['⌘', '⏎'], label: 'Send & branch' },
      { keys: ['⌘', '.'], label: 'Stop generating' },
    ],
  },
  {
    title: 'Artifact pane',
    items: [
      { keys: ['⌘', 'O'], label: 'Toggle pane' },
      { keys: ['⌘', '⇧', 'M'], label: 'Maximise pane' },
      { keys: ['⌘', 'C'], label: 'Copy active artifact' },
      { keys: ['1'], label: 'Switch to Preview tab' },
      { keys: ['2'], label: 'Switch to Source tab' },
    ],
  },
  {
    title: 'Brain',
    items: [
      { keys: ['⌘', '1'], label: 'Nandai-One (local Trinity, auto-routed)' },
      { keys: ['⌘', '2'], label: 'Opus 4.7 (via Claude Code bridge)' },
    ],
  },
];

export function ShortcutsOverlay() {
  const open = useStore((s) => s.helpOpen);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    trigger.current = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => trigger.current?.focus?.();
  }, [open]);

  const titleId = useId();
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setHelp(false)} />
          <motion.div
            ref={ref}
            initial={{ y: 14, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 10, opacity: 0 }}
            className="relative w-full max-w-[840px] rounded-2xl glass-modal border border-border overflow-hidden shadow-2xl"
          >
            <header className="flex items-center justify-between px-6 py-4 border-b border-border/60">
              <div>
                <h2 id={titleId} className="font-serif text-2xl">Keyboard shortcuts</h2>
                <div className="text-[10.5px] tracking-[0.2em] uppercase text-muted-foreground mt-1">Atelier · Trinity workstation</div>
              </div>
              <button onClick={() => setHelp(false)} className="btn-icon" aria-label="Close shortcuts"><X size={16} /></button>
            </header>
            <div className="grid sm:grid-cols-2 gap-6 p-6">
              {GROUPS.map((g) => (
                <section key={g.title}>
                  <h3 className="text-[10.5px] tracking-[0.22em] uppercase text-muted-foreground mb-3">{g.title}</h3>
                  <ul className="space-y-2.5">
                    {g.items.map((it) => (
                      <li key={it.label} className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="text-foreground/90">{it.label}</span>
                        <span className="inline-flex items-center gap-0.5">
                          {it.keys.map((k) => <span key={k} className="kbd">{k}</span>)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <footer className="px-6 py-3.5 border-t border-border/60 text-[10.5px] tracking-[0.18em] uppercase text-muted-foreground flex justify-between">
              <span>Press <span className="kbd">?</span> anywhere to reopen this</span>
              <span>v1.0 · Local first</span>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
