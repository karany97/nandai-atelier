// theme.ts — headless theme system for atelier.
//
// Karan's directive (2026-05-16): "All links and dashboards only to be
// headless cacheless themes — any changes should reflect instantly".
//
// How it works:
//   1. CSS variables for each theme live in src/index.css under
//      [data-theme="<name>"] selectors. No new CSS at runtime.
//   2. applyTheme(name) sets document.documentElement.dataset.theme,
//      which makes the CSS variables for that theme take effect immediately
//      across the entire rendered tree (no reflow flicker since it's just
//      variable swap).
//   3. resolveTheme() picks the active theme from four sources, in order
//      of precedence: URL query param > cookie > localStorage > default.
//      This lets mythos-gate set a cookie per subdomain (multi-brand
//      deploy) while still letting the user override per-tab with ?theme=.
//   4. setTheme(name) persists to localStorage AND fires a cookie
//      `atelier-theme=<name>; Max-Age=31536000; SameSite=Lax; Path=/`
//      so the gate's server-side injection picks it up on next paint.
//
// Why no per-theme JSON: we want the themes to ship in the bundle
// itself (zero network round-trip). CSS variables already give us
// the swap mechanism — we don't need JS-side state for tokens.
//
// Why no React context: applyTheme touches one DOM attribute. React's
// re-render is irrelevant; the browser repaints via CSS cascade. Adding
// a Provider would just churn the tree.
//
// Custom themes: operator can paste an arbitrary CSS variable block via
// SettingsDrawer → "Custom CSS" textarea. Stored in localStorage as
// `atelier-theme-custom`. When the resolved theme is 'custom', we inject
// that CSS into a <style id="atelier-theme-custom"> element.

export type ThemeName =
  | 'default'        // the existing paper/copper-gold (light)
  | 'dark'           // the existing warm-ink dark
  | 'terracotta'     // Nandai brand (warm clay + deep umber)
  | 'pure-light'     // daytime ergonomics, AA-grade neutral
  | 'mono-print'     // black on white, single typeface, print/low-bandwidth
  | 'accessible-hc'  // WCAG-AAA high-contrast for vision impaired
  | 'custom';        // operator-provided CSS variable block

export const THEMES: { name: ThemeName; label: string; description: string }[] = [
  { name: 'default',       label: 'Paper (default)',       description: 'Warm paper background, copper-gold accent.' },
  { name: 'dark',          label: 'Warm Dark',             description: 'Claude-style warm ink dark mode.' },
  { name: 'terracotta',    label: 'Terracotta (Nandai)',   description: 'Nandai brand — warm clay + deep umber.' },
  { name: 'pure-light',    label: 'Pure Light',            description: 'Clean white, AA-grade neutral palette.' },
  { name: 'mono-print',    label: 'Mono Print',            description: 'Black on white, monospace. Print + low-bandwidth.' },
  { name: 'accessible-hc', label: 'High Contrast',         description: 'WCAG-AAA palette for vision impaired.' },
];

const LS_KEY = 'atelier-theme';
const LS_CUSTOM_KEY = 'atelier-theme-custom';
const COOKIE_NAME = 'atelier-theme';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Apply a theme by setting the root `data-theme` attribute. Browser
 *  repaints via CSS cascade — no React re-render needed. */
export function applyTheme(name: ThemeName): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  // For 'default' (which is :root with no selector), clear the attribute.
  // For 'dark' (which uses the .dark CLASS, not [data-theme]), set the
  // class instead. All other themes use [data-theme="<name>"].
  root.classList.remove('dark');
  if (name === 'default') {
    delete root.dataset.theme;
  } else if (name === 'dark') {
    root.classList.add('dark');
    delete root.dataset.theme;
  } else {
    root.dataset.theme = name;
  }

  // Custom theme: inject the user's CSS variable block.
  // Remove any prior injection first so themes don't accumulate.
  document.getElementById('atelier-theme-custom')?.remove();
  if (name === 'custom') {
    const customCss = readCustomCss();
    if (customCss) {
      const style = document.createElement('style');
      style.id = 'atelier-theme-custom';
      style.textContent = `:root { ${customCss} }`;
      document.head.appendChild(style);
    }
  }
}

/** Pick the active theme. Precedence: URL ?theme= > cookie > localStorage > 'default'. */
export function resolveTheme(): ThemeName {
  if (typeof window === 'undefined') return 'default';

  // 1. URL query param (highest — per-tab override)
  try {
    const url = new URLSearchParams(window.location.search).get('theme');
    if (url && isValidTheme(url)) return url;
  } catch { /* ignore */ }

  // 2. Cookie (server-side injection from mythos-gate)
  try {
    const cookie = document.cookie.match(/(?:^|;\s*)atelier-theme=([^;]+)/);
    if (cookie && isValidTheme(cookie[1])) return cookie[1] as ThemeName;
  } catch { /* ignore */ }

  // 3. localStorage (per-browser persistence)
  try {
    const ls = localStorage.getItem(LS_KEY);
    if (ls && isValidTheme(ls)) return ls as ThemeName;
  } catch { /* ignore */ }

  // 4. Default
  return 'default';
}

/** Persist + apply a theme. Updates localStorage, cookie, and DOM in one pass. */
export function setTheme(name: ThemeName): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LS_KEY, name); } catch { /* quota */ }
  try {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(name)}; ` +
      `Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
  } catch { /* ignore */ }
  applyTheme(name);
}

/** Read the operator's pasted custom CSS variable block, if any. */
export function readCustomCss(): string {
  if (typeof localStorage === 'undefined') return '';
  try { return localStorage.getItem(LS_CUSTOM_KEY) ?? ''; }
  catch { return ''; }
}

/** Write the operator's custom CSS variable block. Re-applies if 'custom' is active. */
export function setCustomCss(css: string): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_CUSTOM_KEY, css); } catch { /* quota */ }
  if (resolveTheme() === 'custom') applyTheme('custom');
}

function isValidTheme(s: string): s is ThemeName {
  return ['default', 'dark', 'terracotta', 'pure-light', 'mono-print', 'accessible-hc', 'custom'].includes(s);
}

/** Boot-time helper: read the resolved theme and apply it once.
 *  Call from App.tsx useEffect at boot. Cheap (one DOM read, one DOM write). */
export function bootTheme(): ThemeName {
  const name = resolveTheme();
  applyTheme(name);
  return name;
}
