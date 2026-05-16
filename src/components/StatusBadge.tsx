import { STATUS_LABEL, type Status } from '../lib/types';

export function StatusBadge({ status, note }: { status: Status; note?: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
      <span className="text-foreground">
        {STATUS_LABEL[status]}
        <span className="ml-0.5">
          <span className="typing-dot">·</span>
          <span className="typing-dot">·</span>
          <span className="typing-dot">·</span>
        </span>
      </span>
      {note && <span className="text-muted-foreground/80">{note}</span>}
    </div>
  );
}
