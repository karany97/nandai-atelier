// Single-pass syntax highlighter. Tokenises the entire source into non-overlapping
// runs (string | comment | keyword | number | function | text) and renders each
// run by wrapping it in the appropriate span. We never insert markup into a string
// that is then re-scanned — eliminating the "class inside attribute" bug class.

const PY_KW = new Set([
  'def','class','import','from','return','if','elif','else','for','while','try','except','finally','with','as','in','not','and','or','is','None','True','False','lambda','yield','await','async','raise','pass','break','continue','global','nonlocal','self','cls',
]);
const TS_KW = new Set([
  'const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','class','extends','implements','interface','type','enum','new','this','super','import','export','from','as','default','async','await','try','catch','finally','throw','typeof','instanceof','in','of','null','undefined','true','false','void','never','any','unknown','string','number','boolean','readonly','public','private','protected','static',
]);
const SH_KW = new Set([
  'sudo','cd','ls','cat','grep','sed','awk','curl','wget','git','npm','pnpm','yarn','docker','kubectl','ssh','scp','export','source','alias','if','then','else','fi','for','do','done','while','case','esac','return','function',
]);

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Cls = 'tok-str' | 'tok-cmt' | 'tok-key' | 'tok-num' | 'tok-fn';
type Run = { cls?: Cls; text: string };

function kwSet(lang: string): Set<string> {
  const l = lang.toLowerCase();
  if (l === 'python' || l === 'py') return PY_KW;
  if (l === 'sh' || l === 'bash' || l === 'shell' || l === 'zsh') return SH_KW;
  return TS_KW;
}

function commentRe(lang: string): RegExp {
  const l = lang.toLowerCase();
  if (l === 'python' || l === 'py' || l === 'sh' || l === 'bash' || l === 'shell' || l === 'zsh') return /#[^\n]*/y;
  return /\/\/[^\n]*|\/\*[\s\S]*?\*\//y;
}
const stringRe = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/y;
const numRe    = /\d+(?:\.\d+)?/y;
const wordRe   = /[a-zA-Z_][\w]*/y;
const wsRe     = /\s+/y;

export function highlight(code: string, lang: string): string {
  const kw = kwSet(lang);
  const cre = commentRe(lang);
  const out: Run[] = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i];

    // Whitespace
    wsRe.lastIndex = i;
    let m: RegExpExecArray | null;
    if ((m = wsRe.exec(code))) { out.push({ text: m[0] }); i += m[0].length; continue; }

    // Comment (anchored "y" regex resets lastIndex per call)
    cre.lastIndex = i;
    if ((m = cre.exec(code))) { out.push({ cls: 'tok-cmt', text: m[0] }); i += m[0].length; continue; }

    // String
    stringRe.lastIndex = i;
    if ((m = stringRe.exec(code))) { out.push({ cls: 'tok-str', text: m[0] }); i += m[0].length; continue; }

    // Word — could be keyword OR function-call name
    wordRe.lastIndex = i;
    if ((m = wordRe.exec(code))) {
      const word = m[0];
      const after = code[i + word.length];
      if (kw.has(word))                 out.push({ cls: 'tok-key', text: word });
      else if (after === '(')           out.push({ cls: 'tok-fn',  text: word });
      else                              out.push({ text: word });
      i += word.length; continue;
    }

    // Number (after word so we don't eat identifier-leading numerics)
    numRe.lastIndex = i;
    if ((m = numRe.exec(code))) { out.push({ cls: 'tok-num', text: m[0] }); i += m[0].length; continue; }

    // Anything else — single char
    out.push({ text: ch });
    i += 1;
  }
  return out.map((r) => r.cls ? `<span class="${r.cls}">${escape(r.text)}</span>` : escape(r.text)).join('');
}

// D-AGENT-007: single-pass JSON highlighter. The old multi-pass version ran
// regex over text that already contained `<span class="tok-key">…</span>`
// markup, so any value matching another pattern would wrap mismatched tags.
// This walks the source once, classifies each token, and emits spans exactly
// once per token — same approach as the code highlighter above.
export function highlightJson(json: string): string {
  const out: string[] = [];
  let i = 0;
  const n = json.length;
  while (i < n) {
    const ch = json[i];
    // Whitespace
    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < n && /\s/.test(json[j])) j++;
      out.push(escape(json.slice(i, j)));
      i = j; continue;
    }
    // String — could be a key (followed by `:`) or a value
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (json[j] === '\\') { j += 2; continue; }
        if (json[j] === '"') { j++; break; }
        j++;
      }
      // peek past any whitespace to see if a `:` follows → key
      let k = j; while (k < n && /\s/.test(json[k])) k++;
      const cls = json[k] === ':' ? 'tok-key' : 'tok-str';
      out.push(`<span class="${cls}">${escape(json.slice(i, j))}</span>`);
      i = j; continue;
    }
    // Number
    const numMatch = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    numMatch.lastIndex = i;
    const nm = numMatch.exec(json);
    if (nm && nm.index === i) {
      out.push(`<span class="tok-num">${escape(nm[0])}</span>`);
      i += nm[0].length; continue;
    }
    // Literals
    if (json.startsWith('true', i))  { out.push('<span class="tok-key">true</span>');  i += 4; continue; }
    if (json.startsWith('false', i)) { out.push('<span class="tok-key">false</span>'); i += 5; continue; }
    if (json.startsWith('null', i))  { out.push('<span class="tok-key">null</span>');  i += 4; continue; }
    // Punctuation / structural
    out.push(escape(ch));
    i++;
  }
  return out.join('');
}
