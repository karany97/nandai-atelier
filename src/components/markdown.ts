// Lightweight markdown → HTML for streaming assistant text. Handles:
//  • paragraphs, blank lines
//  • numbered + bulleted lists
//  • **bold** and `inline code`
//  • mid-stream unmatched trailing `**` is hidden so the caret never shows
//    literal asterisks (but only if truly trailing — D-AUDIT-014: never strip
//    a `**` that still has text after it, that would eat valid bold)

export function renderMd(s: string): string {
  const escape = (t: string) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = escape(s).split('\n');
  const out: string[] = [];
  let inList = false;
  let listKind: 'ul' | 'ol' = 'ul';
  const closeList = () => { if (inList) { out.push(listKind === 'ol' ? '</ol>' : '</ul>'); inList = false; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    const bulleted = /^\s*[•\-\*]\s+(.*)$/.exec(line);
    if (numbered) {
      if (!inList || listKind !== 'ol') { closeList(); out.push('<ol class="list-decimal pl-5 space-y-1.5 marker:text-[color:hsl(var(--accent-1))]">'); inList = true; listKind = 'ol'; }
      out.push(`<li>${inline(numbered[2])}</li>`);
    } else if (bulleted) {
      if (!inList || listKind !== 'ul') { closeList(); out.push('<ul class="list-disc pl-5 space-y-1.5 marker:text-[color:hsl(var(--accent-1))]">'); inList = true; listKind = 'ul'; }
      out.push(`<li>${inline(bulleted[1])}</li>`);
    } else if (line === '') {
      closeList(); out.push('<div class="h-2"></div>');
    } else {
      closeList(); out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('');
}

function inline(s: string): string {
  // 1. Pair off bold runs left-to-right. Non-greedy so 3-pairs work.
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong class="text-foreground">$1</strong>');
  // 2. After replacement, check if any `**` remains. If so, only strip it when
  //    it's at the very end of the string (mid-stream caret artifact). Anything
  //    else stays — user might be writing literal asterisks.
  const stray = /\*\*\s*$/;
  if (stray.test(s)) s = s.replace(stray, '');
  // 3. Inline code
  s = s.replace(/`([^`]+?)`/g, '<code class="font-mono text-[12.5px] bg-muted text-[color:hsl(var(--accent-1))] px-1.5 py-0.5 rounded">$1</code>');
  return s;
}
