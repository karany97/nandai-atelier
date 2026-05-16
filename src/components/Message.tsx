import { motion } from 'framer-motion';
import {
  Copy as CopyIcon, Check, ThumbsUp, ThumbsDown, RotateCcw, Pencil, FileText, Code2, Cloud,
} from 'lucide-react';
import { useState } from 'react';
import type { AssistantMessage, UserMessage } from '../lib/types';
import { Mark } from './Mark';
import { BrainBadge } from './BrainBadge';
import { StatusBadge } from './StatusBadge';
import { ThinkingTrace } from './ThinkingTrace';
import { ToolCallList } from './ToolCallView';
import { AuditPill } from './AuditPill';
import { renderMd } from './markdown';
import { setActiveArtifact, setComposer, escalateToOpus, useStore } from '../lib/store';

export function MessageRow({ msg }: { msg: UserMessage | AssistantMessage }) {
  if (msg.role === 'user') return <UserBubble msg={msg} />;
  return <AssistantBubble msg={msg} />;
}

function UserBubble({ msg }: { msg: UserMessage }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 items-start"
    >
      <div className="shrink-0 h-7 w-7 rounded-full grid place-items-center text-[10.5px] font-medium font-mono"
        style={{ background: 'hsl(var(--accent-1) / 0.16)', color: 'hsl(var(--accent-1))' }}
        aria-hidden="true"
      >KY</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-foreground">You</span>
          <span className="text-[10.5px] text-muted-foreground">
            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="mt-1 text-[15px] leading-relaxed text-foreground whitespace-pre-wrap">{msg.text}</div>
      </div>
    </motion.div>
  );
}

function AssistantBubble({ msg }: { msg: AssistantMessage }) {
  const [copied, setCopied] = useState(false);
  const activeArtifactId = useStore((s) => s.activeArtifactMsgId);
  const showThinking = useStore((s) => s.settings.showThinking);
  const bridgeReady = useStore((s) => s.bridgeStatus.kind === 'ready');

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch (_e) {/* clipboard denied */}
  };
  const html = renderMd(msg.text);
  const canEscalate = msg.brain === 'nandai' && !msg.streaming && bridgeReady;
  // Sentinel pill only after the stream finishes — fetching mid-stream would
  // race the constant-crawl's own POST.
  const showAudit = !msg.streaming && msg.brain === 'nandai';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 items-start"
      aria-busy={msg.streaming ? 'true' : 'false'}
    >
      <div className="shrink-0 h-7 w-7 rounded-full grid place-items-center bg-foreground/[0.04] border border-border" aria-hidden="true">
        <Mark size={13} state={msg.status === 'queued' || !msg.status ? 'idle' : msg.status} />
      </div>
      <div className="flex-1 min-w-0">
        {/* Header line */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[13px] font-medium text-foreground">Atelier</span>
          <BrainBadge brain={msg.brain} underlying={msg.underlying} />
          {msg.escalated && msg.brain === 'opus' && (
            <span className="chip-accent chip !text-[9.5px] !px-1.5" title="This reply came from the Opus fallback">
              escalated
            </span>
          )}
          {showAudit && <AuditPill msgId={msg.id} alreadyEscalated={!!msg.escalated} alreadyReran={!!msg.reranWithTools} />}
          <span className="text-[10.5px] text-muted-foreground">
            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Status line */}
        {msg.status && (
          <div className="mt-2">
            <StatusBadge status={msg.status} note={msg.statusNote} />
          </div>
        )}

        {/* Thinking trace */}
        {msg.thinking && showThinking && !msg.streaming && <ThinkingTrace text={msg.thinking} />}

        {/* Tool calls */}
        {msg.toolCalls && msg.toolCalls.length > 0 && !msg.streaming && (
          <ToolCallList calls={msg.toolCalls} />
        )}

        {/* Body — compact (14.5px / line-height 1.55) matches Claude.ai density.
            Was 15px / 1.65 = essay-mode. */}
        <div
          className={`msg-prose mt-2 text-foreground/95 ${msg.streaming ? 'caret' : ''}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* Tick-019 B5 fix: error banner. Renders below the body so the operator
            sees WHAT failed without raw JSON in their chat history. The error
            is in msg.error (structured), not msg.text. Persists clean to IDB. */}
        {msg.error && (
          <div
            role="alert"
            className="mt-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11.5px] text-red-700 dark:text-red-300 font-mono leading-snug break-words"
          >
            {msg.error}
          </div>
        )}

        {/* Artifact button */}
        {msg.artifact && (
          <button
            onClick={() => setActiveArtifact(activeArtifactId === msg.id ? null : msg.id)}
            className={`mt-3 inline-flex items-center gap-2.5 rounded-md border px-3 py-2 transition-colors ${
              activeArtifactId === msg.id
                ? 'border-foreground/20 bg-foreground/[0.04]'
                : 'border-border bg-card hover:border-foreground/15'
            }`}
            aria-expanded={activeArtifactId === msg.id}
            aria-label={`Open artifact: ${msg.artifact.title}`}
          >
            <span className="grid place-items-center h-7 w-7 rounded-md border border-border bg-background">
              {msg.artifact.kind === 'code'
                ? <Code2 size={13} className="text-muted-foreground" />
                : <FileText size={13} className="text-muted-foreground" />}
            </span>
            <div className="text-left">
              <div className="text-[13px] font-medium text-foreground leading-tight">
                {msg.artifact.title}
              </div>
              <div className="text-[10.5px] text-muted-foreground mt-0.5">
                {msg.artifact.kind}{msg.artifact.lang ? ` · ${msg.artifact.lang}` : ''} · v{msg.artifact.version ?? 1}
              </div>
            </div>
          </button>
        )}

        {/* Follow-ups */}
        {msg.followups && msg.followups.length > 0 && !msg.streaming && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {msg.followups.map((f) => (
              <button key={f} onClick={() => setComposer(f)}
                className="text-[12.5px] px-3 py-1 rounded-full border border-border text-foreground/80 hover:text-foreground hover:border-foreground/20 transition-colors">
                {f}
              </button>
            ))}
          </div>
        )}

        {/* Footer toolbar */}
        {!msg.streaming && (
          <div className="mt-3 flex flex-wrap items-center gap-0.5 text-muted-foreground">
            <button className="btn-icon" onClick={onCopy} aria-label="Copy response to clipboard">
              {copied ? <Check size={13} className="text-emerald-500" /> : <CopyIcon size={13} />}
            </button>
            <button className="btn-icon" aria-label="Regenerate response"><RotateCcw size={13} /></button>
            <button className="btn-icon" aria-label="Edit response"><Pencil size={13} /></button>
            <button className="btn-icon" aria-label="Mark helpful"><ThumbsUp size={13} /></button>
            <button className="btn-icon" aria-label="Mark not helpful"><ThumbsDown size={13} /></button>
            {canEscalate && (
              <button
                onClick={() => escalateToOpus(msg.id)}
                className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
                title="Re-ask this turn through Opus via the Claude Code bridge"
              >
                <Cloud size={11} /> Escalate to Opus
              </button>
            )}
            <div className="flex-1" />
            <div className="text-[10.5px] text-muted-foreground/80 flex items-center gap-3">
              {msg.tokens && <span>{msg.tokens.prompt}↑ · {msg.tokens.completion}↓ tok</span>}
              {msg.latencyMs != null && <span>{(msg.latencyMs / 1000).toFixed(1)}s</span>}
              {msg.costUsd != null && msg.costUsd > 0 && <span>${msg.costUsd.toFixed(4)}</span>}
              {msg.costUsd === 0 && <span className="text-emerald-600 dark:text-emerald-400">$0 local</span>}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
