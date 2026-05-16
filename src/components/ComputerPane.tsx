// ComputerPane.tsx — the right-side iframe that embeds a live Destiny Computer
// desktop (KasmVNC / noVNC) next to the chat. Renders nothing if no URL is
// configured.
//
// Why this exists: the user said "Live desktop can be popped up in chat
// itself". This is the chat-side half of the Destiny Atelier + Destiny
// Computer cross-product integration. The other half is the auth-proxy
// already shipped + the eventual "Hand off to Computer" button in the
// composer that spawns a task on the embedded desktop.
//
// Architecture:
//   Settings → "Computer" tab → operator pastes their KasmVNC URL (e.g.
//   https://pc-karan.example.com/) → it's stored in localStorage under
//   `nandai-chat:computer-v1` → ComputerPane reads it → renders iframe.
//
// Privacy + security:
//   - iframe is sandboxed: allow-scripts allow-same-origin allow-forms
//     allow-popups (KasmVNC needs same-origin for cookies + scripts for
//     vnc.js + forms for password entry + popups for the file-browser
//     plugin). NOT allow-top-navigation — can't escape the chat.
//   - referrerpolicy="no-referrer" so the chat URL doesn't leak to the
//     desktop host
//   - The iframe's auth is whatever cookies the operator's KasmVNC has;
//     this component doesn't see them.
//   - aria-label set so screen readers announce the pane

import { useEffect, useState } from 'react';
import { Maximize2, Minimize2, ExternalLink, X, Monitor } from 'lucide-react';
import { DriverConsole } from './DriverConsole';

const LS_KEY = 'nandai-chat:computer-v1';

export type ComputerConfig = {
  /** Full URL to the KasmVNC / noVNC web frontend (e.g. https://pc-karan.example.com/). */
  url: string;
  /** Display name for the breadcrumb above the iframe. */
  label: string;
  /** Open by default on every fresh boot? */
  autoOpen: boolean;
  /** Base URL of the destiny-computer driver (e.g. http://127.0.0.1:8090 or https://driver.example.com).
   *  When set, the pane shows a "tell the AI what to do" footer that POSTs
   *  goals to the driver and streams step records back via SSE.
   *  Leave empty to hide the footer (KasmVNC iframe only — manual drive mode). */
  driverUrl: string;
};

const DEFAULT: ComputerConfig = {
  url: '',
  label: 'Computer',
  autoOpen: false,
  driverUrl: '',
};

export function loadComputerConfig(): ComputerConfig {
  if (typeof localStorage === 'undefined') return DEFAULT;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT;
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT;
  }
}

export function saveComputerConfig(cfg: ComputerConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  } catch {
    /* quota */
  }
}

type Props = {
  /** Toggle visibility. Parent (App.tsx) controls this; this component
   *  is just the iframe + chrome. */
  open: boolean;
  /** Called when the user clicks the X. Parent updates `open=false`. */
  onClose: () => void;
};

export function ComputerPane({ open, onClose }: Props) {
  const [cfg, setCfg] = useState<ComputerConfig>(loadComputerConfig);
  const [maximized, setMaximized] = useState(false);

  // Re-read config from localStorage when the pane opens — operator may
  // have edited the URL in Settings between toggles.
  useEffect(() => {
    if (open) setCfg(loadComputerConfig());
  }, [open]);

  if (!open) return null;

  // Empty-state — no URL configured yet
  if (!cfg.url) {
    return (
      <aside
        aria-label="Computer pane"
        className="fixed right-0 top-0 bottom-0 z-30 w-[40vw] min-w-[420px] max-w-[720px]
                   border-l border-border bg-card flex flex-col"
      >
        <PaneHeader
          label="Computer"
          maximized={maximized}
          onMaximize={() => setMaximized((m) => !m)}
          onClose={onClose}
          openInTab={undefined}
        />
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <Monitor size={32} className="text-muted-foreground mb-3" />
          <h3 className="text-[15px] font-medium text-foreground">
            No Computer configured
          </h3>
          <p className="text-[13px] text-muted-foreground mt-2 max-w-xs leading-relaxed">
            Open Settings → Computer and paste the URL of a KasmVNC / noVNC
            desktop you want the chat to drive. Common pattern:
            {' '}
            <code className="font-mono text-[12px]">https://pc-you.your-domain.com/</code>
          </p>
          <p className="text-[11.5px] text-muted-foreground/70 mt-4 max-w-xs leading-relaxed">
            See <a href="https://github.com/karany97/destiny-computer"
              className="underline hover:no-underline"
              target="_blank" rel="noreferrer noopener">
              destiny-computer
            </a> for the Docker compose that spins one up locally.
          </p>
        </div>
      </aside>
    );
  }

  // Live state — iframe rendered
  const cls = maximized
    ? 'fixed inset-0 z-40'
    : 'fixed right-0 top-0 bottom-0 z-30 w-[40vw] min-w-[420px] max-w-[720px] border-l border-border';

  return (
    <aside
      aria-label={`Computer pane — ${cfg.label}`}
      className={`${cls} bg-card flex flex-col`}
    >
      <PaneHeader
        label={cfg.label}
        maximized={maximized}
        onMaximize={() => setMaximized((m) => !m)}
        onClose={onClose}
        openInTab={cfg.url}
      />
      <iframe
        src={cfg.url}
        title={`Computer: ${cfg.label}`}
        className="flex-1 w-full border-0 bg-background"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock allow-modals"
        referrerPolicy="no-referrer"
        allow="clipboard-read; clipboard-write; fullscreen"
        loading="lazy"
      />
      {/* DriverConsole only renders if the operator has configured a driver
       *  URL. Without it the pane is "manual drive mode" — the operator (or
       *  the AI via their own session inside KasmVNC) clicks around directly
       *  via the iframe. With driverUrl set, the chat can dispatch tasks
       *  to the destiny-computer FastAPI driver and watch step records
       *  stream back. */}
      {cfg.driverUrl && <DriverConsole driverUrl={cfg.driverUrl} />}
    </aside>
  );
}

function PaneHeader(props: {
  label: string;
  maximized: boolean;
  openInTab: string | undefined;
  onMaximize: () => void;
  onClose: () => void;
}) {
  return (
    <header className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background/50">
      <Monitor size={13} className="text-muted-foreground shrink-0" />
      <span className="text-[12.5px] font-medium text-foreground truncate">
        {props.label}
      </span>
      <span className="text-[10.5px] text-muted-foreground font-mono ml-1">
        live
      </span>
      <div className="flex-1" />
      {props.openInTab && (
        <a
          href={props.openInTab}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-icon"
          title="Open desktop in a new browser tab"
          aria-label="Open desktop in a new browser tab"
        >
          <ExternalLink size={13} />
        </a>
      )}
      <button
        onClick={props.onMaximize}
        className="btn-icon"
        title={props.maximized ? 'Restore split view' : 'Maximize desktop'}
        aria-label={props.maximized ? 'Restore split view' : 'Maximize desktop'}
      >
        {props.maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>
      <button
        onClick={props.onClose}
        className="btn-icon"
        title="Close computer pane"
        aria-label="Close computer pane"
      >
        <X size={13} />
      </button>
    </header>
  );
}
