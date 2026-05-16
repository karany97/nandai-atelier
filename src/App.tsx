import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import {
  useStore, getState, setPalette, newConversation, setSettings as setSettingsOpen, setHelp,
  setDashboard, stopGenerating, patchSettings, setActiveArtifact, setTheme,
} from './lib/store';
import { Sidebar } from './components/Sidebar';
import { ChatPane } from './components/ChatPane';
import { ArtifactPane } from './components/ArtifactPane';
import { CommandPalette } from './components/CommandPalette';
import { SettingsDrawer } from './components/SettingsDrawer';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { TrinityDashboard } from './components/TrinityDashboard';
import { AmbientBackdrop } from './components/AmbientBackdrop';
import { ComputerPane, loadComputerConfig } from './components/ComputerPane';
import type { BrainKey } from './lib/types';

// Only two brains exist now; digits map cleanly.
const ROUTE_DIGIT: Record<string, BrainKey> = {
  '1': 'nandai', '2': 'opus',
};

function App() {
  const theme = useStore((s) => s.settings.theme);
  const activeArtifactMsgId = useStore((s) => s.activeArtifactMsgId);
  const reduceMotion = useStore((s) => s.settings.reduceMotion);

  // Destiny Computer pane (right-side iframe of the live KasmVNC desktop).
  // Default-open if the operator's saved config has autoOpen=true.
  const [computerOpen, setComputerOpen] = useState<boolean>(
    () => loadComputerConfig().autoOpen
  );

  // Listen for `atelier:open-computer` events fired by the Composer's
  // "Hand off to Computer" button. Decoupled via CustomEvent so the
  // Composer doesn't need a prop-drilled callback or context.
  useEffect(() => {
    const handler = () => setComputerOpen(true);
    window.addEventListener('atelier:open-computer', handler);
    return () => window.removeEventListener('atelier:open-computer', handler);
  }, []);

  // D-A11Y-005: honour OS preference too, OR explicit user setting.
  const reduceMotionSystem = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);
  const effectiveReduce = reduceMotion || reduceMotionSystem;

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('dark', theme === 'dark');
    }
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA';
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return; }
      if (cmd && e.key.toLowerCase() === 'n') { e.preventDefault(); newConversation(); return; }
      if (cmd && e.key === ',')               { e.preventDefault(); setSettingsOpen(true); return; }
      if (cmd && e.key.toLowerCase() === 'd') { e.preventDefault(); setDashboard(true); return; }
      if (cmd && e.key === '.')               { e.preventDefault(); stopGenerating(); return; }
      // Cmd+\ — toggle the Destiny Computer pane
      if (cmd && (e.key === '\\' || e.code === 'Backslash')) {
        e.preventDefault();
        setComputerOpen((v) => !v);
        return;
      }
      // B4 fix: Cmd+Shift+T toggles theme (Cmd+D is taken by dashboard).
      // The previous validator run flagged "no theme keyboard shortcut" as
      // a gap; this binds the most-mnemonic one.
      if (cmd && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        const cur = getState().settings.theme;
        setTheme(cur === 'dark' ? 'light' : 'dark');
        return;
      }
      if (cmd && ROUTE_DIGIT[e.key])          { e.preventDefault(); patchSettings({ routeMode: ROUTE_DIGIT[e.key] }); return; }
      if (!inField && e.key === '?')          { e.preventDefault(); setHelp(true); return; }
      if (!inField && e.key === 'Escape') {
        setPalette(false); setSettingsOpen(false); setHelp(false); setDashboard(false);
        setActiveArtifact(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <MotionConfig reducedMotion={effectiveReduce ? 'always' : 'never'}>
      {/* Destiny Computer pane — right-side iframe for the live AI desktop.
          Toggleable via Cmd+\\ keyboard shortcut OR the Monitor icon in the
          sidebar. When open, takes 40vw on the right; chat reflows to the
          remaining 60vw. Maximize mode covers the full viewport. */}
      <ComputerPane open={computerOpen} onClose={() => setComputerOpen(false)} />

      {/* Atmospheric particle backdrop — pure HTML5 Canvas2D, ~140 SLOC,
          zero deps (no Three.js). 480 particles drift through a 3D-projected
          shell, accelerated while the AI is generating. Skipped entirely
          when the user opts into reduced motion (OS preference or explicit
          setting). The legacy WebGL version is preserved at
          `src/components/NeuralBackground.tsx` for operators who want
          a more elaborate backdrop and don't mind the +800 KB Three.js tax. */}
      {!effectiveReduce && <AmbientBackdrop />}

      <a
        href="#chat-input"
        className="sr-only focus:not-sr-only fixed top-2 left-2 z-[100]"
      >
        Skip to chat input
      </a>
      <div className="h-full flex overflow-hidden relative">
        <Sidebar />
        {/* Resizable split-pane between chat and artifact preview.
            • When no artifact is open, ChatPane fills the available width.
            • When open, the user can drag the divider; size is persisted to
              localStorage under autoSaveId="chat-artifact-split".
            • Both panels have min/max guards so the chat can't be crushed. */}
        {activeArtifactMsgId ? <SplitChat /> : <ChatPane />}

        <CommandPalette />
        <SettingsDrawer />
        <ShortcutsOverlay />
        <TrinityDashboard />
      </div>
    </MotionConfig>
  );
}

/**
 * Lightweight resizable splitter for the chat ↔ artifact pane.
 * • Native pointer events with setPointerCapture so the drag survives the
 *   cursor leaving the handle and re-entering iframes.
 * • Size persists in localStorage under `nandai-chat:split-pct`.
 * • Bounds: 32% ≤ chat ≤ 75% (so artifact pane is 25-68% of available width).
 * • Keyboard: focus the handle, ←/→ shrink/grow by 2% per press, ⇧+← / ⇧+→
 *   by 8%, Home/End to clamp.
 */
function SplitChat() {
  const LS_KEY = 'nandai-chat:split-pct';
  const MIN = 32, MAX = 75;
  const [chatPct, setChatPct] = useState<number>(() => {
    try {
      const raw = typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY);
      const n = raw ? parseFloat(raw) : 56;
      return Number.isFinite(n) ? Math.min(MAX, Math.max(MIN, n)) : 56;
    } catch { return 56; }
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, String(chatPct)); } catch { /* quota */ }
  }, [chatPct]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setChatPct(Math.min(MAX, Math.max(MIN, pct)));
  }, []);
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);
  const onKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 8 : 2;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); setChatPct((v) => Math.max(MIN, v - step)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setChatPct((v) => Math.min(MAX, v + step)); }
    else if (e.key === 'Home')  { e.preventDefault(); setChatPct(MIN); }
    else if (e.key === 'End')   { e.preventDefault(); setChatPct(MAX); }
  }, []);

  return (
    <div ref={containerRef} className="flex-1 min-w-0 flex relative">
      <div style={{ width: `${chatPct}%` }} className="h-full flex flex-col min-w-0">
        <ChatPane />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(chatPct)}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-label="Resize artifact pane (drag or use arrow keys)"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKey}
        onDoubleClick={() => setChatPct(56)}
        className="relative w-1.5 hover:w-2 bg-border hover:bg-[color:hsl(var(--accent-1))]/40 active:bg-[color:hsl(var(--accent-1))]/60 transition-[background,width] cursor-col-resize z-20 outline-none focus-visible:bg-[color:hsl(var(--accent-1))]/60"
        title="Drag to resize · double-click to reset · ←/→ to nudge"
      >
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-4" aria-hidden />
      </div>
      <div style={{ width: `${100 - chatPct}%` }} className="h-full flex flex-col min-w-0">
        <ArtifactPane />
      </div>
    </div>
  );
}

export default App;
