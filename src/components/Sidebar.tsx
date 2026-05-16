import { useState, useMemo } from 'react';
import {
  Plus, Search, Pin, Trash2, PanelLeftClose, PanelLeft,
  Settings2, Keyboard, Sun, Moon, Activity, Folder,
} from 'lucide-react';
import {
  useStore, newConversation, selectConversation, togglePin, deleteConversation,
  setTheme, setPalette, setSettings as setSettingsOpen, setHelp, setDashboard, toggleSidebar,
} from '../lib/store';
import { Wordmark } from './Mark';

export function Sidebar() {
  const conversations = useStore((s) => s.conversations);
  const active = useStore((s) => s.activeConvId);
  const open = useStore((s) => s.sidebarOpen);
  const theme = useStore((s) => s.settings.theme);
  const streaming = useStore((s) => !!s.streamingMsgId);
  const [q, setQ] = useState('');

  const grouped = useMemo(() => {
    const norm = q.trim().toLowerCase();
    const filtered = conversations.filter((c) =>
      !norm || c.title.toLowerCase().includes(norm) || (c.folder ?? '').toLowerCase().includes(norm));
    const pinned = filtered.filter((c) => c.pinned);
    const others = filtered.filter((c) => !c.pinned);
    const buckets: Record<string, typeof others> = {
      Today: [], Yesterday: [], 'Earlier this week': [], Older: [],
    };
    const now = Date.now();
    for (const c of others) {
      const days = (now - c.updatedAt) / 86400_000;
      if (days < 1)        buckets['Today'].push(c);
      else if (days < 2)   buckets['Yesterday'].push(c);
      else if (days < 7)   buckets['Earlier this week'].push(c);
      else                 buckets['Older'].push(c);
    }
    return { pinned, buckets };
  }, [conversations, q]);

  // TODO(mobile): below `md` the sidebar is hidden with no drawer. Production fix
  // is to render a Sheet that slides in from the left.

  if (!open) {
    return (
      <div className="hidden md:flex shrink-0 w-12 border-r border-border bg-card flex-col items-center py-4 gap-1 relative z-10">
        <button className="btn-icon" onClick={toggleSidebar} aria-label="Open sidebar"><PanelLeft size={15} /></button>
        <div className="h-2" />
        <button className="btn-icon" onClick={() => newConversation()} aria-label="New chat"><Plus size={15} /></button>
        <button className="btn-icon" onClick={() => setPalette(true)} aria-label="Command palette"><Search size={15} /></button>
        <div className="flex-1" />
        <button className="btn-icon" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Settings2 size={15} /></button>
      </div>
    );
  }

  return (
    <aside
      className="hidden md:flex flex-col shrink-0 w-[268px] border-r border-border bg-card relative z-10"
      style={{ background: 'hsl(var(--paper-deep))' }}
    >
      {/* Brand */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <Wordmark size={18} />
        <button className="btn-icon" onClick={toggleSidebar} aria-label="Collapse sidebar"><PanelLeftClose size={14} /></button>
      </div>

      {/* New chat row */}
      <div className="px-3 pb-2">
        <button onClick={() => newConversation()}
          className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 rounded-md text-[13px] font-medium text-foreground border border-border bg-card hover:border-foreground/20 transition-colors">
          <span className="inline-flex items-center gap-2"><Plus size={13} className="text-muted-foreground" /> New chat</span>
          <span className="inline-flex items-center gap-0.5"><span className="kbd">⌘</span><span className="kbd">N</span></span>
        </button>
      </div>

      {/* Search row → opens palette */}
      <div className="px-3 pb-3">
        <button onClick={() => setPalette(true)}
          className="w-full inline-flex items-center gap-2 px-3 py-2 rounded-md text-[12.5px] text-muted-foreground hover:text-foreground transition-colors">
          <Search size={13} />
          <span className="flex-1 text-left">Search chats…</span>
          <span className="inline-flex items-center gap-0.5"><span className="kbd">⌘</span><span className="kbd">K</span></span>
        </button>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Filter"
          className="mt-1 w-full px-3 py-1.5 rounded-md text-[12.5px] bg-card border border-border focus:border-foreground/20 outline-none placeholder:text-muted-foreground/60"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {grouped.pinned.length > 0 && (
          <Section label="Pinned">
            {grouped.pinned.map((c) => (
              <ChatRow key={c.id} id={c.id} title={c.title} folder={c.folder}
                       active={active === c.id} pinned />
            ))}
          </Section>
        )}
        {Object.entries(grouped.buckets).map(([k, arr]) => arr.length > 0 && (
          <Section key={k} label={k}>
            {arr.map((c) => (
              <ChatRow key={c.id} id={c.id} title={c.title} folder={c.folder}
                       active={active === c.id} />
            ))}
          </Section>
        ))}
      </div>

      {/* Live connection pill (subtle) */}
      <ConnectionPill streaming={streaming} />

      <button
        onClick={() => setDashboard(true)}
        className="mx-3 mb-2 flex items-center gap-2 px-3 py-1.5 rounded-md text-[11.5px] text-left text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
      >
        <Activity size={11} />
        <span className="flex-1">Trinity status</span>
      </button>

      {/* Footer toolbar */}
      <div className="px-2 py-2 border-t border-border grid grid-cols-4 gap-0.5">
        <ToolBtn label="Settings"  onClick={() => setSettingsOpen(true)}><Settings2 size={13} /></ToolBtn>
        <ToolBtn label="Shortcuts" onClick={() => setHelp(true)}><Keyboard size={13} /></ToolBtn>
        <ToolBtn label="Status"    onClick={() => setDashboard(true)}><Activity size={13} /></ToolBtn>
        <ToolBtn label={theme === 'dark' ? 'Light' : 'Dark'}
                 onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </ToolBtn>
      </div>

      {/* User chip */}
      <div className="px-3 py-3 border-t border-border flex items-center gap-2.5">
        <div className="h-7 w-7 rounded-full bg-foreground/8 grid place-items-center text-foreground font-mono text-[10px] font-semibold"
          style={{ background: 'hsl(var(--accent-1) / 0.18)', color: 'hsl(var(--accent-1))' }}
        >KY</div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-medium leading-tight truncate text-foreground">Karan Yadav</div>
          <div className="text-[10.5px] text-muted-foreground truncate">Owner · Unrestricted</div>
        </div>
        <span className="chip-accent chip !text-[9.5px] !px-1.5">PRO</span>
      </div>
    </aside>
  );
}

function ConnectionPill({ streaming }: { streaming: boolean }) {
  const status = useStore((s) => s.connectStatus);
  const bridge = useStore((s) => s.bridgeStatus);
  const tools = useStore((s) => s.toolBridgeStatus);
  const offline = useStore((s) => s.connection.offline);

  // Honest, three-line pill: Nandai-One / Opus bridge / Tools.
  // Tools chip surfaces the MCP executor health + tool count so the user
  // knows the agentic loop is armed (added 2026-05-16 tick-002).
  let topDot = 'bg-muted-foreground';
  let topText = 'Connecting…';
  if (offline)                            { topDot = 'bg-amber-500'; topText = 'Offline · scripted demo'; }
  else if (status.kind === 'connected')   { topDot = streaming ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'; topText = 'Nandai-One online'; }
  else if (status.kind === 'connecting')  { topDot = 'bg-amber-500 animate-pulse'; topText = 'Probing gateway…'; }
  else if (status.kind === 'error')       { topDot = 'bg-red-500'; topText = 'Nandai-One unreachable'; }

  let botDot = 'bg-muted-foreground';
  let botText = 'Opus bridge: unknown';
  if (bridge.kind === 'ready')      { botDot = 'bg-emerald-500'; botText = 'Opus bridge: ready'; }
  else if (bridge.kind === 'probing') { botDot = 'bg-amber-500 animate-pulse'; botText = 'Opus bridge: probing'; }
  else if (bridge.kind === 'down')   { botDot = 'bg-amber-500'; botText = 'Opus bridge: down'; }

  let toolsDot = 'bg-muted-foreground';
  let toolsText = 'Tools: unknown';
  if (tools.kind === 'ready')      { toolsDot = 'bg-emerald-500'; toolsText = `Tools: ${tools.n_tools} loaded`; }
  else if (tools.kind === 'probing') { toolsDot = 'bg-amber-500 animate-pulse'; toolsText = 'Tools: probing'; }
  else if (tools.kind === 'down')   { toolsDot = 'bg-amber-500'; toolsText = 'Tools: down'; }

  return (
    <button
      onClick={() => setSettingsOpen(true)}
      className="mx-3 mt-1 mb-1.5 flex flex-col gap-1 px-3 py-2 rounded-md text-[11.5px] text-left text-muted-foreground hover:text-foreground hover:bg-card transition-colors w-[calc(100%-1.5rem)]"
      aria-label={`${topText}. ${botText}. ${toolsText}. Click to open settings.`}
    >
      <span className="flex items-center gap-2 truncate">
        <span className={`h-1.5 w-1.5 rounded-full ${topDot}`} />
        <span className="flex-1 truncate">{topText}</span>
      </span>
      <span className="flex items-center gap-2 truncate text-[10.5px] text-muted-foreground/80">
        <span className={`h-1.5 w-1.5 rounded-full ${botDot}`} />
        <span className="flex-1 truncate">{botText}</span>
      </span>
      <span className="flex items-center gap-2 truncate text-[10.5px] text-muted-foreground/80">
        <span className={`h-1.5 w-1.5 rounded-full ${toolsDot}`} />
        <span className="flex-1 truncate">{toolsText}</span>
      </span>
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <div className="px-2 py-1 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/80">{label}</div>
      <div className="space-y-px">{children}</div>
    </div>
  );
}

function ChatRow({
  id, title, folder, active, pinned,
}: { id: string; title: string; folder?: string; active: boolean; pinned?: boolean }) {
  // D-FOUND-019: was a div with onClick — invisible to keyboard. Now a proper
  // role="button" with Enter/Space handlers.
  // D-FOUND-020: dropped `motion.div layout` — layout re-measure during heavy
  // streaming was a thrash hotspot. The reorder still animates via AnimatePresence
  // on the parent list when items are added/removed.
  const onSelect = () => selectConversation(id);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={onKey}
      aria-current={active ? 'page' : undefined}
      aria-label={`Open conversation: ${title}`}
      className={`group relative rounded-md px-2.5 py-1.5 text-[13px] cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:hsl(var(--accent-1))] ${
        active
          ? 'bg-card text-foreground border border-border'
          : 'hover:bg-card text-foreground/80 border border-transparent'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="truncate leading-snug">{title}</div>
          {folder && (
            <div className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-muted-foreground/80">
              <Folder size={9} /> {folder}
            </div>
          )}
        </div>
        <div className={`flex items-center transition-opacity ${
          (active || pinned) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}>
          <button onClick={(e) => { e.stopPropagation(); togglePin(id); }} aria-label={pinned ? 'Unpin conversation' : 'Pin conversation'}
            className={`h-6 w-6 inline-flex items-center justify-center rounded hover:text-foreground ${pinned ? 'text-foreground' : 'text-muted-foreground/70'}`}>
            <Pin size={11} fill={pinned ? 'currentColor' : 'none'} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); deleteConversation(id); }} aria-label="Delete conversation"
            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground/70 hover:text-red-500">
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex flex-col items-center gap-0.5 py-1.5 rounded-md hover:bg-card transition-colors text-muted-foreground hover:text-foreground"
    >
      <span>{children}</span>
      <span className="text-[9.5px]">{label}</span>
    </button>
  );
}
