import { useMemo, useState } from 'react';
import { X, Code2, Eye, Download, Share2, FileText } from 'lucide-react';
import { useStore, setActiveArtifact, selectActiveArtifact, setArtifactTab } from '../lib/store';
import type { Artifact } from '../lib/types';
import { CodeBlock } from './CodeBlock';

export function ArtifactPane() {
  const artifact = useStore((s) => selectActiveArtifact(s));
  const tab = useStore((s) => s.artifactTab);
  if (!artifact) return null;
  // NB: width is now controlled by the parent <Panel> in App.tsx (the user
  // drags the splitter to resize). We just fill the available space.
  return (
    <aside
      className="hidden md:flex h-full w-full flex-col bg-background relative z-20"
    >
      <Header artifact={artifact} />
      <Tabs tab={tab} kind={artifact.kind} />
      <div className="flex-1 overflow-auto p-4 min-h-0">
        {(tab === 'render')
          ? <RenderTab artifact={artifact} />
          : <SourceTab artifact={artifact} />}
      </div>
      <Footer artifact={artifact} />
    </aside>
  );
}

function Header({ artifact }: { artifact: Artifact }) {
  // Maximise removed — the user drags the splitter. Download/Share stubs kept.
  return (
    <header className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <FileText size={12} className="text-muted-foreground shrink-0" />
        <span className="font-mono text-[12px] truncate text-foreground">{artifact.title}</span>
        <span className="text-[10.5px] text-muted-foreground shrink-0 ml-1">
          {artifact.kind}{artifact.lang ? ` · ${artifact.lang}` : ''} · v{artifact.version ?? 1}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          className="btn-icon"
          aria-label="Download artifact"
          onClick={() => downloadArtifact(artifact)}
        ><Download size={13} /></button>
        <button className="btn-icon" aria-label="Share"><Share2 size={13} /></button>
        <button className="btn-icon" aria-label="Close artifact pane" onClick={() => setActiveArtifact(null)}><X size={13} /></button>
      </div>
    </header>
  );
}

function downloadArtifact(a: Artifact) {
  try {
    const blob = new Blob([a.body], { type: a.kind === 'html' ? 'text/html' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = a.title.replace(/[^\w.\-]/g, '_') || 'artifact.txt';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { document.body.removeChild(link); URL.revokeObjectURL(url); }, 250);
  } catch { /* ignore download errors */ }
}

function Tabs({ tab, kind }: { tab: 'render' | 'source'; kind: Artifact['kind'] }) {
  const canRender = ['html', 'mermaid', 'svg', 'json', 'markdown', 'code'].includes(kind);
  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border">
      {canRender && (
        <TabBtn active={tab === 'render'} onClick={() => setArtifactTab('render')} icon={<Eye size={11} />}>Preview</TabBtn>
      )}
      <TabBtn active={tab === 'source'} onClick={() => setArtifactTab('source')} icon={<Code2 size={11} />}>Source</TabBtn>
    </div>
  );
}

function TabBtn({
  active, onClick, icon, children,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11.5px] font-medium transition-colors ${
        active ? 'bg-foreground/[0.06] text-foreground'
               : 'text-muted-foreground hover:text-foreground'
      }`}>
      {icon} {children}
    </button>
  );
}

function SourceTab({ artifact }: { artifact: Artifact }) {
  return (
    <CodeBlock
      body={artifact.body}
      lang={artifact.lang ?? guessLang(artifact)}
      title={artifact.title}
    />
  );
}

function guessLang(a: Artifact): string {
  if (a.kind === 'json') return 'json';
  if (a.kind === 'html') return 'html';
  if (a.kind === 'mermaid') return 'mermaid';
  if (a.kind === 'svg') return 'xml';
  if (a.kind === 'markdown') return 'markdown';
  return 'plain';
}

function RenderTab({ artifact }: { artifact: Artifact }) {
  if (artifact.kind === 'html')    return <HtmlRender body={artifact.body} />;
  if (artifact.kind === 'mermaid') return <MermaidRender body={artifact.body} />;
  if (artifact.kind === 'svg')     return <SvgRender body={artifact.body} />;
  if (artifact.kind === 'json')    return <JsonTree body={artifact.body} />;
  if (artifact.kind === 'markdown') return <MarkdownRender body={artifact.body} />;
  return <SourceTab artifact={artifact} />;
}

function HtmlRender({ body }: { body: string }) {
  return (
    <iframe
      title="Artifact preview"
      sandbox="allow-scripts"
      srcDoc={body}
      className="w-full h-full min-h-[60vh] rounded-md border border-border bg-white"
    />
  );
}

function SvgRender({ body }: { body: string }) {
  // D-AUDIT-001: SVG can carry <script> / event handlers / external href that
  // execute JS in the parent origin if we drop it via dangerouslySetInnerHTML.
  // Sandbox it in an iframe (no allow-scripts → script tags + handlers inert).
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent;display:grid;place-items:center;padding:16px}svg{max-width:100%;height:auto}</style></head><body>${body}</body></html>`;
  return (
    <iframe
      title="SVG preview"
      sandbox=""
      srcDoc={html}
      className="w-full h-full min-h-[40vh] rounded-md border border-border bg-card"
    />
  );
}

function MarkdownRender({ body }: { body: string }) {
  // Escape inputs before naive markdown transforms so untrusted HTML can't
  // sneak in. We're not running a real markdown parser here — this is intended
  // for previewing trusted artifact bodies and we still want safety.
  const html = useMemo(() => {
    const esc = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return esc
      .replace(/^# (.+)$/gm, '<h1 style="font-family:Georgia,serif;font-size:1.6rem;margin:0.6rem 0">$1</h1>')
      .replace(/^## (.+)$/gm, '<h2 style="font-family:Georgia,serif;font-size:1.3rem;margin:0.5rem 0">$1</h2>')
      .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+?)`/g, '<code style="font-family:ui-monospace,monospace;background:#eee;padding:0 0.3em;border-radius:3px">$1</code>')
      .replace(/\n\n/g, '<br/><br/>');
  }, [body]);
  const wrapped = `<!doctype html><html><head><style>body{margin:0;padding:16px;font-family:ui-sans-serif,system-ui;color:#1a1612;background:transparent;line-height:1.6}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      title="Markdown preview"
      sandbox=""
      srcDoc={wrapped}
      className="w-full h-full min-h-[40vh] rounded-md border border-border bg-card"
    />
  );
}

function JsonTree({ body }: { body: string }) {
  let parsed: any;
  try { parsed = JSON.parse(body); }
  catch (_e) {
    return <pre className="text-[12px] font-mono text-red-500">Invalid JSON</pre>;
  }
  return (
    <div className="rounded-md border border-border bg-card p-3 text-[12.5px] font-mono">
      <JsonNode value={parsed} k="" root />
    </div>
  );
}

// D-FOUND-013/014: avoid freezing the main thread on large JSON.
//  • Default-collapse anything with > 50 children.
//  • Render at most PAGE children at once; offer "show N more" pagination.
//  • Hard depth limit so a pathological tree doesn't recurse forever.
const PAGE = 100;
const MAX_DEPTH = 25;

function JsonNode({ value, k, root, depth = 0 }: { value: any; k: string; root?: boolean; depth?: number }) {
  const isComposite = value !== null && (Array.isArray(value) || typeof value === 'object');
  const childCount = isComposite ? (Array.isArray(value) ? value.length : Object.keys(value).length) : 0;
  const [open, setOpen] = useState(childCount <= 50);
  const [shown, setShown] = useState(PAGE);
  if (depth > MAX_DEPTH) {
    return <Leaf k={k}><span className="text-muted-foreground">… (max depth)</span></Leaf>;
  }
  if (value === null) return <Leaf k={k}><span className="tok-key">null</span></Leaf>;
  const t = typeof value;
  if (t === 'string') return <Leaf k={k}><span className="tok-str">"{value}"</span></Leaf>;
  if (t === 'number' || t === 'boolean') return <Leaf k={k}><span className="tok-num">{String(value)}</span></Leaf>;
  if (Array.isArray(value)) {
    const slice = open ? value.slice(0, shown) : [];
    return (
      <div className={root ? '' : 'pl-3'}>
        <button onClick={() => setOpen(!open)} className="text-left text-foreground" aria-expanded={open}>
          {k && <><span className="tok-key">"{k}"</span>: </>}<span className="text-muted-foreground">[{open ? '' : `${value.length} items …`}</span>
        </button>
        {open && slice.map((v, i) => (
          <div key={i}>
            <JsonNode value={v} k={String(i)} depth={depth + 1} />
            {i < value.length - 1 && <span className="tok-punc">,</span>}
          </div>
        ))}
        {open && value.length > shown && (
          <button onClick={() => setShown((n) => n + PAGE)}
            className="ml-3 mt-1 text-[11px] text-muted-foreground hover:text-foreground underline">
            show {Math.min(PAGE, value.length - shown)} more of {value.length - shown}
          </button>
        )}
        <span className="text-muted-foreground">]</span>
      </div>
    );
  }
  const keys = Object.keys(value);
  const keySlice = open ? keys.slice(0, shown) : [];
  return (
    <div className={root ? '' : 'pl-3'}>
      <button onClick={() => setOpen(!open)} className="text-left text-foreground" aria-expanded={open}>
        {k && <><span className="tok-key">"{k}"</span>: </>}<span className="text-muted-foreground">{'{'}{open ? '' : `${keys.length} keys …`}</span>
      </button>
      {open && keySlice.map((kk, i) => (
        <div key={kk}>
          <JsonNode value={value[kk]} k={kk} depth={depth + 1} />
          {i < keys.length - 1 && <span className="tok-punc">,</span>}
        </div>
      ))}
      {open && keys.length > shown && (
        <button onClick={() => setShown((n) => n + PAGE)}
          className="ml-3 mt-1 text-[11px] text-muted-foreground hover:text-foreground underline">
          show {Math.min(PAGE, keys.length - shown)} more of {keys.length - shown}
        </button>
      )}
      <span className="text-muted-foreground">{'}'}</span>
    </div>
  );
}

function Leaf({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="pl-3">
      {k && <><span className="tok-key">"{k}"</span>: </>}{children}
    </div>
  );
}

function MermaidRender({ body }: { body: string }) {
  // D-BUNDLE-001: when this artifact is bundled into a single .html, every
  // string in the JS sits inside one giant <script>…</script>. Any literal
  // `</script>` substring in source ends that outer tag early. esbuild
  // aggressively constant-folds `'<' + '/script>'`, `Array.join`, and even
  // `String.fromCharCode` chains. The only reliable hack is to derive the
  // tag from a name that exists at runtime — `mermaid` here — chopping it
  // into letters the minifier cannot statically resolve to "/script>".
  const sep = String.fromCharCode(60, 47); // "<\/"
  const close = sep + 'script' + String.fromCharCode(62);
  const open  = String.fromCharCode(60) + 'script type="module"' + String.fromCharCode(62);
  const html = `<!doctype html><html><head>
<style>html,body{margin:0;background:#faf6f0;color:#1a1612;font-family:ui-sans-serif,system-ui}
.mermaid{padding:20px;font-size:14px}</style></head><body>
<pre class="mermaid">${escapeForHtml(body)}</pre>
${open}
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'neutral', themeVariables: {
    primaryColor: '#f0e6d3', primaryTextColor: '#1a1612', lineColor: '#a86c40',
    secondaryColor: '#fff', tertiaryColor: '#faf6f0', background: '#faf6f0',
    fontFamily: 'ui-sans-serif, system-ui'
  }});
${close}</body></html>`;
  return (
    <iframe
      title="Mermaid preview"
      sandbox="allow-scripts"
      srcDoc={html}
      className="w-full h-full min-h-[60vh] rounded-md border border-border"
      style={{ background: 'hsl(var(--paper))' }}
    />
  );
}

function escapeForHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function Footer({ artifact }: { artifact: Artifact }) {
  return (
    <footer className="px-4 py-2 border-t border-border text-[10.5px] text-muted-foreground flex justify-between">
      <span>{artifact.kind} · generated by Trinity</span>
      <span>v{artifact.version ?? 1} · {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
    </footer>
  );
}
