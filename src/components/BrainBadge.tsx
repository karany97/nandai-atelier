import { BRAIN_META, UNDERLYING_META, type BrainKey, type UnderlyingBrain } from '../lib/types';

/**
 * Renders the user-facing brain label ("Nandai-One" / "Opus 4.7") with an
 * optional small trace showing the actual upstream that answered
 * ("via nandai-think"). The trace is read verbatim from the wire — never
 * fabricated. Hover reveals the full tagline.
 */
export function BrainBadge({ brain, underlying }: {
  brain: BrainKey;
  underlying?: UnderlyingBrain;
  dense?: boolean;
}) {
  const meta = BRAIN_META[brain];
  const sub  = underlying ? UNDERLYING_META[underlying] : undefined;
  const title = sub
    ? `${meta.label} · routed to ${sub.label} (${sub.tagline})`
    : meta.tagline;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground"
      title={title}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: meta.color }}
      />
      {meta.label}
      {sub && (
        <span className="text-[10.5px] text-muted-foreground/70 font-normal">
          · via <span className="font-mono">{sub.label}</span>
        </span>
      )}
    </span>
  );
}
