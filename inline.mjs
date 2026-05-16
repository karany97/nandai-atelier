import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const inFile = path.join(dist, 'index.html');
let html = fs.readFileSync(inFile, 'utf8');

const readLocal = (href) => {
  const clean = href.replace(/^\//, '');
  const p = path.join(dist, clean);
  if (!fs.existsSync(p)) throw new Error('Missing asset: ' + p);
  return fs.readFileSync(p, 'utf8');
};

html = html.replace(/<link\b[^>]*>/gi, (tag) => {
  const isStylesheet = /\brel\s*=\s*(?:"|')?stylesheet/i.test(tag);
  if (!isStylesheet) return tag;
  const m = tag.match(/href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  const href = m && (m[1] || m[2] || m[3]);
  if (!href || /^https?:\/\//i.test(href)) return tag;
  return `<style>${readLocal(href)}</style>`;
});
html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs) => {
  const m = attrs.match(/src\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  const src = m && (m[1] || m[2] || m[3]);
  if (!src || /^https?:\/\//i.test(src)) return tag;
  const isModule = /\btype\s*=\s*(?:"|')?module/i.test(attrs);
  return `<script${isModule ? ' type="module"' : ''}>\n${readLocal(src)}\n</script>`;
});

fs.writeFileSync('bundle.html', html);
const kb = (fs.statSync('bundle.html').size / 1024).toFixed(1);
console.log(`✅ bundle.html written (${kb} KB)`);
