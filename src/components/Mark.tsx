// Quiet sparkle mark — Claude-style restraint. Only the *thinking* state animates.
import { motion } from 'framer-motion';

type Props = {
  size?: number;
  className?: string;
  state?: 'idle' | 'thinking' | 'researching' | 'generating' | 'tool-calling' | 'reflecting';
  tone?: 'accent' | 'mono';
};

export function Mark({ size = 18, className = '', state = 'idle', tone = 'accent' }: Props) {
  const active = state !== 'idle';
  return (
    <motion.span
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
      animate={active ? { rotate: 360 } : { rotate: 0 }}
      transition={active ? { repeat: Infinity, duration: 3.4, ease: 'linear' } : { duration: 0.4 }}
    >
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        <path
          d="M16 1 L18.6 13.4 L31 16 L18.6 18.6 L16 31 L13.4 18.6 L1 16 L13.4 13.4 Z"
          fill={tone === 'mono' ? 'currentColor' : 'hsl(var(--accent-1))'}
          opacity={tone === 'mono' ? 0.7 : 1}
        />
      </svg>
    </motion.span>
  );
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <Mark size={size - 4} className="self-center" />
      <span className="font-serif text-[1.05rem] leading-none tracking-tight text-foreground">
        Nandai <span className="text-muted-foreground font-normal">· Atelier</span>
      </span>
    </span>
  );
}
