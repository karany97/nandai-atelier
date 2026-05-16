import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Plus, Settings2, Keyboard, Sun, Moon, Sparkles, Folder,
  MessageSquare, Cloud, FileText,
} from 'lucide-react';
import {
  useStore, setPalette, newConversation, selectConversation, setTheme,
  setSettings as setSettingsOpen, setHelp, setDashboard, patchSettings, loadScripted,
} from '../lib/store';
import { SCRIPTED_CONVOS, QUICK_PROMPTS } from '../lib/script';
import type { BrainKey } from '../lib/types';
import { BRAIN_META } from '../lib/types';

type Action = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  shortcut?: string[];
  icon: React.ReactNode;
  run: () => void;
};

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const conversations = useStore((s) => s.conversations);
  const theme = useStore((s) => s.settings.theme);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const actions: Action[] = useMemo(() => {
    const base: Action[] = [
      { id: 'new', group: 'Workspace', label: 'New conversation', shortcut: ['⌘', 'N'], icon: <Plus size={14} />, run: () => { newConversation(); setPalette(false); } },
      { id: 'set', group: 'Workspace', label: 'Open settings', shortcut: ['⌘', ','], icon: <Settings2 size={14} />, run: () => { setSettingsOpen(true); setPalette(false); } },
      { id: 'help', group: 'Workspace', label: 'Keyboard shortcuts', shortcut: ['?'], icon: <Keyboard size={14} />, run: () => { setHelp(true); setPalette(false); } },
      { id: 'dash', group: 'Workspace', label: 'Trinity status dashboard', shortcut: ['⌘', 'D'], icon: <Sparkles size={14} />, run: () => { setDashboard(true); setPalette(false); } },
      { id: 'theme', group: 'Workspace', label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />, run: () => { setTheme(theme === 'dark' ? 'light' : 'dark'); setPalette(false); } },
    ];
    const routeActions: Action[] = ([
      ['nandai', Sparkles, BRAIN_META.nandai.label],
      ['opus',   Cloud,    BRAIN_META.opus.label],
    ] as const).map(([k, I, name]) => ({
      id: `route-${k}`, group: 'Brain', label: `Use ${name}`,
      icon: <I size={14} className="text-[color:hsl(var(--accent-1))]" />,
      run: () => { patchSettings({ routeMode: k as BrainKey }); setPalette(false); },
    }));
    const convoActions: Action[] = conversations.slice(0, 12).map((c) => ({
      id: `conv-${c.id}`, group: 'Conversations', label: c.title, hint: c.folder,
      icon: <MessageSquare size={14} className="text-muted-foreground" />,
      run: () => { selectConversation(c.id); setPalette(false); },
    }));
    const scripted: Action[] = SCRIPTED_CONVOS.map((s) => ({
      id: `script-${s.id}`, group: 'Demos · open sample session', label: s.title, hint: s.folder,
      icon: <FileText size={14} className="text-[color:hsl(var(--gold))]" />,
      run: () => { loadScripted(s.id); setPalette(false); },
    }));
    const prompts: Action[] = QUICK_PROMPTS.map((p, i) => ({
      id: `qp-${i}`, group: 'Suggested prompts', label: p,
      icon: <Folder size={14} className="text-muted-foreground" />,
      run: () => { setPalette(false); /* could insert into composer */ },
    }));
    return [...base, ...routeActions, ...convoActions, ...scripted, ...prompts];
  }, [conversations, theme]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(needle) || a.group.toLowerCase().includes(needle));
  }, [actions, q]);

  const grouped = useMemo(() => {
    const m = new Map<string, Action[]>();
    filtered.forEach((a) => {
      if (!m.has(a.group)) m.set(a.group, []);
      m.get(a.group)!.push(a);
    });
    return Array.from(m.entries());
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    const flat = filtered;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPalette(false); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, flat.length - 1)); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter')     { e.preventDefault(); flat[idx]?.run(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, idx]);

  const titleId = useId();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-start pt-[15vh] px-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          role="dialog" aria-modal="true" aria-labelledby={titleId}
        >
          <span id={titleId} className="sr-only">Command palette</span>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setPalette(false)} />
          <motion.div
            initial={{ y: -10, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -6, opacity: 0 }}
            className="relative w-full max-w-[680px] rounded-2xl glass-modal border border-border overflow-hidden shadow-2xl"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
              <Search size={16} className="text-[color:hsl(var(--gold))]" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => { setQ(e.target.value); setIdx(0); }}
                placeholder="Search conversations · run a command · pick a brain…"
                className="flex-1 bg-transparent outline-none px-1 py-1 text-[14px] placeholder:text-muted-foreground/60"
              />
              <span className="kbd">esc</span>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {grouped.length === 0 && (
                <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">No matches.</div>
              )}
              {grouped.map(([group, arr]) => (
                <div key={group} className="mb-1">
                  <div className="px-3 pt-2 pb-1 text-[10px] tracking-[0.2em] uppercase text-muted-foreground">{group}</div>
                  {arr.map((a) => {
                    const globalIdx = filtered.indexOf(a);
                    const active = globalIdx === idx;
                    return (
                      <button key={a.id} onClick={a.run}
                        onMouseEnter={() => setIdx(globalIdx)}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left transition-colors ${active ? 'bg-[color:hsl(var(--gold)/0.14)]' : 'hover:bg-muted/40'}`}>
                        <span className="flex items-center gap-2.5 min-w-0">
                          <span className="shrink-0">{a.icon}</span>
                          <span className="text-[13.5px] truncate">{a.label}</span>
                          {a.hint && <span className="text-[10.5px] tracking-[0.14em] uppercase text-muted-foreground shrink-0">· {a.hint}</span>}
                        </span>
                        {a.shortcut && (
                          <span className="hidden md:inline-flex items-center gap-0.5 shrink-0">
                            {a.shortcut.map((s) => <span key={s} className="kbd">{s}</span>)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <footer className="px-4 py-2.5 border-t border-border/60 flex items-center justify-between text-[10.5px] text-muted-foreground">
              <span className="flex items-center gap-2"><span className="kbd">↑</span><span className="kbd">↓</span> navigate</span>
              <span className="flex items-center gap-2"><span className="kbd">↵</span> select · <span className="kbd">esc</span> close</span>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
