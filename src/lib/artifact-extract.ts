// Live artifact extraction — only fires when the model ACTUALLY emits a code
// fence or a <nandai_artifact> XML tag. Never fabricates content.
//
// Supported sources, in priority order:
//   1. <nandai_artifact kind="…" lang="…" title="…">BODY</nandai_artifact>
//   2. Fenced code blocks: ```lang title="…"\n…\n```
//      • lang must be one of html|mermaid|svg|json|markdown|md|<code-lang>
//      • body must be at least 5 non-empty lines to surface as a side-pane artifact

import type { Artifact, ArtifactKind } from './types';

export type ExtractResult = {
  body: string;            // assistant text with the artifact regions cleaned up
  artifact?: Omit<Artifact, 'id'>;
};

const NANDAI_TAG = /<nandai_artifact\b([^>]*)>([\s\S]*?)<\/nandai_artifact>/i;
// D-FOUND-001: Markdown / tutorial fences can NEST — body of an outer ```markdown
// block may contain inner ```js fences. Standard CommonMark resolves this by
// matching fences of >= the opening length. We support an outer fence written
// as ```` (4+ backticks) so the model can wrap nested fenced content safely.
// We try ``` then ```` (longer) and pick whichever yields the longer body.
const FENCE3 = /```([\w+-]*)([^\n]*)\n([\s\S]*?)```/;
const FENCE4 = /````([\w+-]*)([^\n]*)\n([\s\S]*?)````/;

export function extractArtifact(rawText: string): ExtractResult {
  // 1) Explicit XML protocol wins
  const tagMatch = NANDAI_TAG.exec(rawText);
  if (tagMatch) {
    const attrs = parseAttrs(tagMatch[1] || '');
    const kind = (attrs.kind as ArtifactKind) || 'code';
    const lang = attrs.lang;
    const title = attrs.title || defaultTitle(kind, lang);
    const cleaned = rawText.replace(NANDAI_TAG,
      `\n_[${kind === 'code' ? 'code block' : kind} artifact](#) — opened in the side pane_\n`);
    return { body: cleaned, artifact: { kind, lang, title, body: tagMatch[2].trim() } };
  }

  // 2) Largest fenced code block, if it's substantial. Try 4-backtick fences
  //    first (they win over 3-backtick because they're explicitly an outer wrap),
  //    then fall back to 3-backtick.
  let best: { lang: string; titleAttr: string; body: string; whole: string } | null = null;
  for (const pattern of [FENCE4, FENCE3]) {
    const re = new RegExp(pattern, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawText))) {
      const candidate = { lang: m[1] || '', titleAttr: m[2] || '', body: m[3], whole: m[0] };
      if (!best || candidate.body.length > best.body.length) best = candidate;
    }
    // If 4-backtick fence found something, stop — that's the outer wrap.
    if (best && pattern === FENCE4) break;
  }
  if (best) {
    const lines = best.body.trim().split('\n').length;
    if (lines >= 5 || /^(html|mermaid|svg|json|markdown|md)$/i.test(best.lang)) {
      const langLower = best.lang.toLowerCase();
      const kind: ArtifactKind = (langLower === 'html' || langLower === 'mermaid' || langLower === 'svg' || langLower === 'json' || langLower === 'markdown' || langLower === 'md')
        ? (langLower === 'md' ? 'markdown' : (langLower as ArtifactKind))
        : 'code';
      const title = parseTitleFromAttr(best.titleAttr) || defaultTitle(kind, best.lang);
      const cleaned = rawText.replace(best.whole,
        `\n_[${best.lang || 'code'} artifact, ${lines} lines](#) — opened in the side pane_\n`);
      return {
        body: cleaned,
        artifact: { kind, lang: kind === 'code' ? best.lang : undefined, title, body: best.body.trim() },
      };
    }
  }

  // D-FOUND-021: open-fence-at-end recovery. When the model hits `max_tokens`
  // mid-stream, the closing ``` may never arrive. Detect a single unmatched
  // opening fence and extract its body as a (truncated) artifact so the user
  // sees a usable preview instead of a 14 KB wall of raw HTML in the prose.
  const fenceCount = (rawText.match(/```/g) || []).length;
  if (fenceCount === 1) {
    const open = /```([\w+-]*)([^\n]*)\n([\s\S]*)$/.exec(rawText);
    if (open) {
      const body = open[3];
      const lines = body.trim().split('\n').length;
      if (lines >= 5) {
        const lang = (open[1] || '').toLowerCase();
        const kind: ArtifactKind =
          (lang === 'html' || lang === 'mermaid' || lang === 'svg' || lang === 'json' || lang === 'markdown')
            ? (lang as ArtifactKind)
            : lang === 'md' ? 'markdown' : 'code';
        const title = parseTitleFromAttr(open[2]) || defaultTitle(kind, lang);
        const cleaned = rawText.replace(open[0],
          `\n_[${lang || 'code'} artifact, ${lines} lines · **truncated** at max_tokens](#) — opened in the side pane_\n`);
        return {
          body: cleaned,
          artifact: {
            kind,
            lang: kind === 'code' ? lang : undefined,
            title: `${title} (truncated)`,
            body: body.trim(),
          },
        };
      }
    }
  }

  return { body: rawText };
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2];
  return out;
}

function parseTitleFromAttr(attr: string): string | null {
  const m = /title\s*=\s*"([^"]+)"/i.exec(attr);
  return m ? m[1] : null;
}

function defaultTitle(kind: ArtifactKind, lang?: string): string {
  if (kind === 'code') return `snippet.${(lang || 'txt').toLowerCase()}`;
  if (kind === 'json') return 'response.json';
  if (kind === 'mermaid') return 'diagram.mmd';
  if (kind === 'html') return 'preview.html';
  if (kind === 'svg') return 'image.svg';
  if (kind === 'markdown') return 'notes.md';
  return 'artifact';
}
