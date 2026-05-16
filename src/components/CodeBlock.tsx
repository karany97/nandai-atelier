import { useState } from 'react';
import { Copy as CopyIcon, Check, Play, FileText } from 'lucide-react';
import { highlight, highlightJson } from '../lib/highlight';

export function CodeBlock({
  body, lang = 'plain', title, runnable = false, onRun,
}: { body: string; lang?: string; title?: string; runnable?: boolean; onRun?: () => void }) {
  const [copied, setCopied] = useState(false);
  const html = (lang === 'json') ? highlightJson(body) : highlight(body, lang);
  return (
    <div className="rounded-lg overflow-hidden border border-border bg-[#1a1612] text-[#f5f0e8]">
      <header className="flex items-center justify-between px-3 py-2 border-b border-white/8">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={12} className="text-white/50 shrink-0" />
          <span className="font-mono text-[11.5px] text-white/85 truncate">{title ?? `snippet.${lang}`}</span>
        </div>
        <div className="flex items-center gap-1">
          {runnable && (
            <button onClick={onRun} className="h-6 px-2 inline-flex items-center gap-1 rounded text-[10.5px] text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/10">
              <Play size={10} /> Run
            </button>
          )}
          <button onClick={async () => {
              try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (_e) {/*denied*/}
            }}
            className="h-6 px-2 inline-flex items-center gap-1 rounded text-[10.5px] text-white/70 border border-white/15 hover:text-white hover:border-white/30">
            {copied ? <Check size={10} className="text-emerald-400" /> : <CopyIcon size={10} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </header>
      <pre className="px-4 py-3.5 text-[12.5px] leading-[1.7] overflow-auto font-mono max-h-[60vh]"
        dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
