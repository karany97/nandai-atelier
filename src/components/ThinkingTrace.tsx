import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';

export function ThinkingTrace({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const tokens = text.split(/\s+/).length;
  return (
    <div className="mt-3 rounded-md border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((x) => !x)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="inline-flex items-center gap-2">
          <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          Reasoning · {tokens} tokens
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <div className="px-4 py-3 text-[13px] leading-relaxed text-foreground/80 border-t border-border whitespace-pre-wrap font-serif italic">
              {text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
