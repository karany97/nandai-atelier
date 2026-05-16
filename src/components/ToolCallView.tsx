import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Check, Clock, AlertCircle } from 'lucide-react';
import { highlightJson } from '../lib/highlight';
import type { ToolCall } from '../lib/types';

export function ToolCallList({ calls }: { calls: ToolCall[] }) {
  if (!calls?.length) return null;
  return (
    <div className="mt-3 space-y-1.5">
      {calls.map((t) => <ToolCallView key={t.id} call={t} />)}
    </div>
  );
}

function ToolCallView({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  // D-AUDIT-007: never invent a result. If the frontend hasn't received a
  // real tool result, badge as "pending" — don't show a fake green check.
  const hasResult = call.result !== undefined;
  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-foreground/[0.025] transition-colors"
      >
        <span className="inline-flex items-center gap-2 text-[12.5px]">
          <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''} text-muted-foreground`} aria-hidden="true" />
          <span className="font-mono text-foreground">{call.name}</span>
          <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
            {hasResult
              ? <><Check size={10} className="text-emerald-500" /> {Object.keys(call.args).length} args</>
              : <><AlertCircle size={10} className="text-amber-500" /> {Object.keys(call.args).length} args · result pending</>
            }
          </span>
          {call.durationMs != null && (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
              <Clock size={9} aria-hidden="true" /> {call.durationMs} ms
            </span>
          )}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="grid md:grid-cols-2 gap-3 px-3.5 py-3 border-t border-border bg-background/40">
              <Pane label="Arguments" body={highlightJson(JSON.stringify(call.args, null, 2))} />
              {hasResult
                ? <Pane label="Result" body={highlightJson(JSON.stringify(call.result, null, 2))} />
                : <PendingPane />
              }
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Pane({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">{label}</div>
      <pre className="text-[11.5px] font-mono leading-relaxed whitespace-pre-wrap break-words text-foreground/90"
        dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}

function PendingPane() {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">Result</div>
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[11.5px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
        <AlertCircle size={12} className="mt-0.5 shrink-0" />
        <div>
          <strong>Not executed by the frontend.</strong> The model emitted this tool call but the
          atelier doesn't ship a tool runner — wire a server-side executor and round-trip the
          result back as a <code className="font-mono">tool</code> role message to continue the loop.
        </div>
      </div>
    </div>
  );
}
