import { useEffect, useId, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Sliders, Cpu, ShieldCheck, Sparkles, Eye, EyeOff, Sun, Moon, Globe2, Loader2, CheckCircle2, AlertCircle, Power, Cloud, Link2,
  Download, Upload, Trash2,
} from 'lucide-react';
import {
  useStore, setSettings as setSettingsOpen, patchSettings, setTheme,
  setConnection, probeConnection, probeBridge,
  clearAllChats, exportAllChats, importChats,
} from '../lib/store';
import { getStorageStats } from '../lib/persist';
import type { BrainKey } from '../lib/types';
import { BRAIN_META, UNDERLYING_META } from '../lib/types';

export function SettingsDrawer() {
  const open = useStore((s) => s.settingsOpen);
  const settings = useStore((s) => s.settings);
  const conn = useStore((s) => s.connection);
  const connStatus = useStore((s) => s.connectStatus);
  const bridgeStatus = useStore((s) => s.bridgeStatus);
  const [revealKey, setRevealKey] = useState(false);

  // D-A11Y-007: trap focus inside the drawer; restore on close
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement;
    const drawer = drawerRef.current;
    if (!drawer) return;
    // focus first focusable
    const focusables = drawer.querySelectorAll<HTMLElement>(
      'a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
    focusables[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSettingsOpen(false); return; }
      if (e.key !== 'Tab') return;
      const fs = drawer.querySelectorAll<HTMLElement>(
        'a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
      );
      if (!fs.length) return;
      const first = fs[0]; const last = fs[fs.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // restore focus
      triggerRef.current?.focus?.();
    };
  }, [open]);

  const titleId = useId();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          role="dialog" aria-modal="true" aria-labelledby={titleId}
        >
          <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={() => setSettingsOpen(false)} />
          <motion.div
            ref={drawerRef}
            initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 30, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 28 }}
            className="absolute top-0 right-0 h-full w-full md:w-[560px] glass-modal border-l border-border overflow-y-auto"
          >
            <header className="flex items-center justify-between px-6 py-5 border-b border-border/60">
              <div>
                <h2 id={titleId} className="font-serif text-2xl">Atelier · Settings</h2>
                <div className="text-[10.5px] tracking-[0.18em] uppercase text-muted-foreground mt-1">Trinity workstation · unrestricted</div>
              </div>
              <button className="btn-icon" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={16} /></button>
            </header>

            <div className="p-6 space-y-7">

              {/* ─── 1. Brain ─── */}
              <Section title="Brain" icon={<Sparkles size={13} className="text-[color:hsl(var(--accent-1))]" />}>
                <div className="grid grid-cols-2 gap-3">
                  <BrainTile k="nandai" active={settings.routeMode === 'nandai'}
                    onSelect={() => patchSettings({ routeMode: 'nandai' })} />
                  <BrainTile k="opus"  active={settings.routeMode === 'opus'}
                    onSelect={() => patchSettings({ routeMode: 'opus' })} />
                </div>
                <Toggle label="Auto-escalate to Opus when Nandai-One is uncertain"
                  icon={<Cloud size={12} />}
                  value={conn.autoEscalate}
                  onChange={(v) => setConnection({ autoEscalate: v })} />
                <div className="text-[10.5px] text-muted-foreground -mt-1">
                  Fires when the local response is empty, &lt;40 chars, or matches a refusal pattern.
                  Auto-escalation needs the Claude Code bridge below.
                </div>
              </Section>

              {/* ─── 2. Local Trinity gateway ─── */}
              <Section title="Local gateway — Nandai-One" icon={<Globe2 size={13} className="text-[color:hsl(var(--accent-1))]" />}>
                <ConnectionStatusPill status={connStatus} />
                <LField label="Endpoint (LiteLLM proxy URL)">
                  <input
                    value={conn.baseUrl}
                    onChange={(e) => setConnection({ baseUrl: e.target.value })}
                    placeholder="http://localhost:8008"
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] font-mono outline-none focus:border-foreground/25"
                  />
                </LField>
                <LField label="API key">
                  <div className="flex gap-2">
                    <input
                      type={revealKey ? 'text' : 'password'}
                      value={conn.apiKey}
                      onChange={(e) => setConnection({ apiKey: e.target.value })}
                      placeholder="sk-..."
                      className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-[13px] font-mono outline-none focus:border-foreground/25"
                    />
                    <button onClick={() => setRevealKey((v) => !v)} className="btn-ghost !px-3" type="button"
                      aria-label={revealKey ? 'Hide API key' : 'Show API key'}>
                      {revealKey ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <div className="text-[10.5px] text-muted-foreground mt-1">
                    Stored in <span className="font-mono">localStorage</span> on this device only. Keep behind your LAN / PIN gate.
                  </div>
                </LField>
                <LField label="Stream timeout (ms)">
                  <input
                    type="number"
                    value={conn.timeoutMs}
                    onChange={(e) => setConnection({ timeoutMs: parseInt(e.target.value || '0', 10) || 120_000 })}
                    min={5000} step={1000}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] font-mono outline-none focus:border-foreground/25"
                  />
                </LField>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={() => probeConnection()}
                    disabled={connStatus.kind === 'connecting'}
                    className="btn-primary disabled:opacity-50"
                  >
                    {connStatus.kind === 'connecting' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    Test gateway
                  </button>
                  <button
                    onClick={() => setConnection({ offline: !conn.offline })}
                    className="btn-ghost"
                  >
                    <Power size={13} />
                    {conn.offline ? 'Offline · scripted demo' : 'Online · live Trinity'}
                  </button>
                </div>

                {connStatus.kind === 'connected' && (
                  <div className="rounded-md border border-border bg-card p-3">
                    <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground mb-1.5">Underlying experts (auto-router picks)</div>
                    <div className="flex flex-wrap gap-1.5">
                      {connStatus.models.map((m) => <span key={m} className="chip font-mono">{m}</span>)}
                    </div>
                    <div className="mt-2 text-[10.5px] text-muted-foreground">
                      Nandai-One is a unified brain over these — the classifier picks <code className="font-mono">fast / think / tool / moa</code> per turn.
                    </div>
                  </div>
                )}
              </Section>

              {/* ─── 3. Claude Code bridge ─── */}
              <Section title="Opus bridge — Claude Code (Max sub)" icon={<Cloud size={13} className="text-[color:hsl(var(--accent-1))]" />}>
                <BridgePill status={bridgeStatus} />
                <LField label="Bridge URL">
                  <input
                    value={conn.bridgeUrl}
                    onChange={(e) => setConnection({ bridgeUrl: e.target.value })}
                    placeholder="http://127.0.0.1:8765"
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] font-mono outline-none focus:border-foreground/25"
                  />
                  <div className="text-[10.5px] text-muted-foreground mt-1">
                    Start the bridge with <span className="font-mono">node ~/NandaiJarvis/scripts/claude-bridge.mjs</span>.
                    It shells out to <span className="font-mono">claude -p --model opus --output-format stream-json</span> — uses your Max subscription.
                  </div>
                </LField>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => probeBridge()}
                    disabled={bridgeStatus.kind === 'probing'}
                    className="btn-primary disabled:opacity-50"
                  >
                    {bridgeStatus.kind === 'probing' ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                    Test bridge
                  </button>
                </div>
              </Section>

              {/* ─── 4. Model parameters ─── */}
              <Section title="Model parameters" icon={<Sliders size={13} className="text-[color:hsl(var(--accent-1))]" />}>
                <Slider label="Temperature" min={0} max={1} step={0.05}
                  value={settings.temperature} onChange={(v) => patchSettings({ temperature: v })}
                  hint="Lower = deterministic, higher = creative" />
                <Slider label="Top-p" min={0} max={1} step={0.05}
                  value={settings.topP} onChange={(v) => patchSettings({ topP: v })}
                  hint="Nucleus sampling cutoff" />
                <NumberInput label="Max tokens" value={settings.maxTokens}
                  onChange={(v) => patchSettings({ maxTokens: v })}
                  min={64} max={32768} step={64}
                  hint="Hard ceiling on completion length" />
              </Section>

              <Section title="System prompt" icon={<Cpu size={13} className="text-[color:hsl(var(--accent-1))]" />}>
                <textarea
                  value={settings.systemPrompt}
                  onChange={(e) => patchSettings({ systemPrompt: e.target.value })}
                  rows={6}
                  className="w-full rounded-md border border-border bg-card p-3 text-[13px] font-mono leading-relaxed focus:border-foreground/25 outline-none"
                  aria-label="System prompt"
                />
                <div className="mt-2 text-[10.5px] text-muted-foreground">Sent verbatim as the first message to Nandai-One. Opus bridge uses Claude Code's own system prompt.</div>
              </Section>

              <Section title="Display" icon={settings.theme === 'dark' ? <Moon size={13} className="text-[color:hsl(var(--accent-1))]" /> : <Sun size={13} className="text-[color:hsl(var(--accent-1))]" />}>
                <Toggle label="Show inner reasoning when expanded" icon={settings.showThinking ? <Eye size={12} /> : <EyeOff size={12} />}
                  value={settings.showThinking} onChange={(v) => patchSettings({ showThinking: v })} />
                <Toggle label="Reduce motion (overrides OS preference)" icon={<Sparkles size={12} />}
                  value={settings.reduceMotion} onChange={(v) => patchSettings({ reduceMotion: v })} />
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button onClick={() => setTheme('light')}
                    className={`rounded-md p-3 text-[12px] text-left border ${settings.theme === 'light' ? 'border-foreground/25 bg-foreground/[0.04]' : 'border-border'}`}>
                    <div className="flex items-center gap-2"><Sun size={13} /> Light</div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mt-1">Paper</div>
                  </button>
                  <button onClick={() => setTheme('dark')}
                    className={`rounded-md p-3 text-[12px] text-left border ${settings.theme === 'dark' ? 'border-foreground/25 bg-foreground/[0.04]' : 'border-border'}`}>
                    <div className="flex items-center gap-2"><Moon size={13} /> Dark</div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mt-1">Warm ink</div>
                  </button>
                </div>
              </Section>

              <Section title="Data & privacy" icon={<ShieldCheck size={13} className="text-[color:hsl(var(--accent-1))]" />}>
                <div className="rounded-md border border-border bg-card p-4 text-[12.5px] leading-relaxed text-foreground/85">
                  Conversations live in this browser only — no telemetry. Endpoint + key + bridge URL persist to <span className="font-mono">localStorage</span>; the full chat history lives in <span className="font-mono">IndexedDB</span> (origin-scoped, survives refresh + browser restart). Nandai-One traffic stays on your LAN; Opus traffic goes through Claude Code on this machine, which contacts Anthropic via your Max subscription.
                </div>
                <DataManagementPanel />
              </Section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function BrainTile({ k, active, onSelect }: { k: BrainKey; active: boolean; onSelect: () => void }) {
  const m = BRAIN_META[k];
  const underlyings = k === 'nandai'
    ? Object.entries(UNDERLYING_META).filter(([key]) => key !== 'escape').map(([_, v]) => v.label)
    : ['Opus 4.7 via Anthropic API · Max subscription'];
  return (
    <button
      onClick={onSelect}
      className={`text-left rounded-lg p-4 border transition-colors ${
        active ? 'border-foreground/30 bg-foreground/[0.04]' : 'border-border hover:border-foreground/15'
      }`}
      aria-pressed={active}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
        <span className="font-serif text-[15.5px]">{m.label}</span>
      </div>
      <div className="text-[11.5px] text-muted-foreground leading-snug">{m.tagline}</div>
      <div className="mt-2.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Underlying</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {underlyings.map((u) => <span key={u} className="chip !text-[10px] !py-0">{u}</span>)}
      </div>
    </button>
  );
}

function ConnectionStatusPill({ status }: { status: ReturnType<typeof useStore<any>> }) {
  if (status.kind === 'connecting') return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
      <Loader2 size={13} className="animate-spin" /> Probing endpoint…
    </div>
  );
  if (status.kind === 'connected') return (
    <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-300">
      <CheckCircle2 size={13} /> Connected · {status.models.length} models · checked {timeAgo(status.checkedAt)}
    </div>
  );
  if (status.kind === 'error') return (
    <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
      <AlertCircle size={13} className="mt-px shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">Connection failed</div>
        <div className="font-mono text-[10.5px] mt-0.5 break-words">{status.message}</div>
      </div>
    </div>
  );
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
      <AlertCircle size={13} /> Unconfigured — fill endpoint + key and press Test gateway.
    </div>
  );
}

function BridgePill({ status }: { status: ReturnType<typeof useStore<any>> }) {
  if (status.kind === 'probing') return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
      <Loader2 size={13} className="animate-spin" /> Probing bridge…
    </div>
  );
  if (status.kind === 'ready') return (
    <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-300">
      <CheckCircle2 size={13} /> Bridge ready{status.version ? ` · ${status.version}` : ''} · checked {timeAgo(status.checkedAt)}
    </div>
  );
  if (status.kind === 'down') return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
      <AlertCircle size={13} className="mt-px shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">Bridge unavailable</div>
        <div className="font-mono text-[10.5px] mt-0.5 break-words">{status.message}</div>
        <div className="mt-1">Opus fallback disabled until the bridge process is running locally.</div>
      </div>
    </div>
  );
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
      <AlertCircle size={13} /> Bridge status unknown — press Test bridge.
    </div>
  );
}

function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-[10.5px] tracking-[0.18em] uppercase text-muted-foreground mb-3">{icon} {title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function LField({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-[11.5px] text-foreground/80 mb-1.5 block">{label}</label>
      <div id={id}>{children}</div>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange, hint }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; hint?: string }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] mb-1.5">
        <label htmlFor={id}>{label}</label>
        <span className="font-mono text-[color:hsl(var(--accent-1))]">{value.toFixed(2)}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[color:hsl(var(--accent-1))]" />
      {hint && <div className="text-[10.5px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
function NumberInput({ label, value, onChange, min, max, step, hint }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; hint?: string }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] mb-1.5"><label htmlFor={id}>{label}</label></div>
      <input id={id} type="number" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] font-mono outline-none focus:border-foreground/25" />
      {hint && <div className="text-[10.5px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
function Toggle({ label, icon, value, onChange }: { label: string; icon?: React.ReactNode; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5 cursor-pointer">
      <span className="flex items-center gap-2 text-[13px]">{icon}{label}</span>
      <button onClick={(e) => { e.preventDefault(); onChange(!value); }} type="button"
        role="switch" aria-checked={value} aria-label={label}
        className={`relative w-10 h-5 rounded-full transition-colors`}
        style={{ background: value ? 'hsl(var(--accent-1))' : 'hsl(var(--paper-edge))' }}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </label>
  );
}

/**
 * DataManagementPanel — three-button row for export / import / clear-all.
 * Each operation surfaces a one-line status under the buttons (success
 * count, error reason, etc) so the operator gets feedback without a
 * separate toast layer. Status auto-clears after 6 s.
 */
function DataManagementPanel() {
  const convCount = useStore((s) => s.conversations.filter((c) => c.messages.length > 0).length);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  // Tick-012: live storage stats from IDB — count, pinned, cap. Refreshed
  // when the panel opens, when import/clear/export buttons fire, and once
  // every 5 s while the panel is rendered (covers external mutations).
  const [stats, setStats] = useState<{ count: number; pinned: number; cap: number; softTarget: number } | null>(null);
  const refreshStats = async () => {
    try { setStats(await getStorageStats()); } catch { /* */ }
  };
  useEffect(() => {
    void refreshStats();
    const t = setInterval(refreshStats, 5_000);
    return () => clearInterval(t);
  }, []);
  // Auto-clear status so the panel doesn't accumulate stale notices.
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 6_000);
    return () => clearTimeout(t);
  }, [status]);

  const onExport = () => {
    try {
      const { json, count, bytes } = exportAllChats();
      if (!count) { setStatus({ tone: 'err', text: 'Nothing to export — no conversations yet.' }); return; }
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nandai-chat-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus({ tone: 'ok', text: `Exported ${count} conversation${count > 1 ? 's' : ''} · ${(bytes / 1024).toFixed(1)} KB` });
    } catch (e: any) {
      setStatus({ tone: 'err', text: `Export failed: ${(e?.message ?? String(e)).slice(0, 120)}` });
    }
  };

  const onImportClick = () => fileInputRef.current?.click();
  const onImportFile = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';  // allow re-selecting the same file later
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setStatus({ tone: 'err', text: 'File larger than 50 MB — refused.' });
      return;
    }
    try {
      const text = await file.text();
      const { added, skipped, errors } = await importChats(text);
      if (errors) {
        setStatus({ tone: 'err', text: 'Import failed — file is not a valid Nandai chat export.' });
        return;
      }
      const parts = [`Imported ${added}`];
      if (skipped) parts.push(`skipped ${skipped} malformed`);
      setStatus({ tone: 'ok', text: parts.join(' · ') });
    } catch (e: any) {
      setStatus({ tone: 'err', text: `Import failed: ${(e?.message ?? String(e)).slice(0, 120)}` });
    }
  };

  // Tick-018: confirm-by-typing replaces window.confirm. Chrome's "block
  // additional dialogs" checkbox can globally suppress window.confirm,
  // making the destructive button effectively undefended. Inline panel
  // requires typing `clear all` to enable the destructive button.
  const [clearArmed, setClearArmed] = useState(false);
  const [clearInput, setClearInput] = useState('');
  const clearReady = clearInput.trim().toLowerCase() === 'clear all';
  const onClearAllStart = () => {
    setClearArmed(true);
    setClearInput('');
  };
  const onClearAllCancel = () => {
    setClearArmed(false);
    setClearInput('');
  };
  const onClearAllConfirm = async () => {
    if (!clearReady) return;
    setClearArmed(false);
    setClearInput('');
    try {
      const cleared = await clearAllChats();
      setStatus({ tone: 'ok', text: `Cleared ${cleared} conversation${cleared === 1 ? '' : 's'} from this browser.` });
    } catch (e: any) {
      setStatus({ tone: 'err', text: `Clear failed: ${(e?.message ?? String(e)).slice(0, 120)}` });
    }
  };

  // Approach to ceiling, expressed as a percent of MAX_CONVS. Tinted hint
  // when we cross 80% — gentle nudge before LRU eviction kicks in at 100%.
  const pct = stats ? Math.round((stats.count / stats.cap) * 100) : 0;
  const nearCap = pct >= 80;

  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <DataButton onClick={onExport} icon={<Download size={12} />} label="Export all" hint={`${convCount} conv${convCount === 1 ? '' : 's'}`} />
        <DataButton onClick={onImportClick} icon={<Upload size={12} />} label="Import" hint="from JSON file" />
        <DataButton onClick={onClearAllStart} icon={<Trash2 size={12} />} label="Clear all" hint="this browser only" danger />
      </div>
      {clearArmed && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 space-y-2">
          <div className="text-[11.5px] text-red-700 dark:text-red-300 leading-snug">
            {stats && stats.count > 0
              ? <>This will permanently delete <span className="font-mono">{stats.count}</span> conversation{stats.count === 1 ? '' : 's'} from this browser{stats.pinned > 0 && <> (including <span className="font-mono">{stats.pinned}</span> pinned)</>}. Cannot be undone.</>
              : <>No saved conversations to clear, but continuing will still reset the active conversation.</>}
            {' '}Type <span className="font-mono font-medium">clear all</span> below to confirm.
          </div>
          <input
            autoFocus
            type="text"
            value={clearInput}
            onChange={(e) => setClearInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && clearReady) onClearAllConfirm();
              if (e.key === 'Escape') onClearAllCancel();
            }}
            placeholder="clear all"
            aria-label="Type 'clear all' to confirm destructive action"
            className="w-full rounded-md border border-red-500/30 bg-card px-3 py-2 text-[13px] font-mono outline-none focus:border-red-500/60"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClearAllConfirm}
              disabled={!clearReady}
              className={`flex-1 rounded-md py-1.5 text-[12px] font-medium transition-colors ${
                clearReady
                  ? 'bg-red-500/20 text-red-700 dark:text-red-300 hover:bg-red-500/30 border border-red-500/40'
                  : 'bg-card text-muted-foreground border border-border cursor-not-allowed'
              }`}
            >
              Confirm permanent delete
            </button>
            <button
              type="button"
              onClick={onClearAllCancel}
              className="flex-1 rounded-md py-1.5 text-[12px] font-medium border border-border bg-card hover:border-foreground/20"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {stats && (
        <div className={`text-[10.5px] px-3 py-1.5 rounded-md border tabular-nums ${
          nearCap
            ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300'
            : 'border-border bg-card/50 text-muted-foreground'
        }`}>
          Stored: <span className="font-mono">{stats.count}</span>
          {stats.pinned > 0 && <> · <span className="font-mono">{stats.pinned}</span> pinned</>}
          {' '}of cap <span className="font-mono">{stats.cap}</span>{' '}
          ({pct}%).{' '}
          {nearCap
            ? `Oldest unpinned will be evicted when crossing ${stats.cap}.`
            : 'LRU evicts oldest unpinned at the cap.'}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={onImportFile}
        className="hidden"
        aria-hidden="true"
      />
      {status && (
        <div
          role="status"
          className={`text-[11.5px] px-3 py-2 rounded-md border ${
            status.tone === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
              : 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300'
          }`}
        >
          {status.text}
        </div>
      )}
    </div>
  );
}

function DataButton({ onClick, icon, label, hint, danger }: {
  onClick: () => void; icon: React.ReactNode; label: string; hint: string; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={`text-left rounded-md border bg-card p-3 transition-colors ${
        danger
          ? 'border-red-500/30 hover:border-red-500/50 text-red-700 dark:text-red-300'
          : 'border-border hover:border-foreground/20'
      }`}
    >
      <div className="flex items-center gap-1.5 text-[12px] font-medium">{icon}{label}</div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mt-1">{hint}</div>
    </button>
  );
}
