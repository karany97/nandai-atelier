# Contributing to Destiny Atelier

> First, thanks. This started as one operator's overnight side-project and
> the only reason it's getting a public README at all is that other operators
> kept asking how the Trinity + Sentinel + cross-tab persistence loop fits
> together. PRs that sharpen any of that are very welcome.

## The thing you must read before opening a PR

Destiny Atelier is a **single-file artifact**. Source lives in `src/`, but what ships
is a 537 KB self-contained `bundle.html`. Two consequences:

1. **No runtime deps allowed.** No CDN scripts, no remote font loads, no
   image hosting outside the bundle. Everything that boots the chat must
   inline into the build output.
2. **Every PR ships an evidence file.** Before merging, drop a file in
   `docs/verification/<your-pr-number>/` with at least:
   - `screenshot-before.png` and `screenshot-after.png` of the change in
     the running chat
   - `console.txt` — paste of the browser DevTools console showing no errors
   - `bundle-diff.md` — output of `wc -c bundle.html` before and after,
     so we catch unbounded bundle growth

PRs without a verification dir get a polite "please add evidence" comment
and won't be merged. This is the same discipline the build journal enforces
on every tick — it's why a 537 KB chat ships without surprises.

## Development setup

```bash
git clone https://github.com/karany97/nandai-atelier.git
cd nandai-atelier
pnpm install      # or npm install — both work, lockfile is pnpm
pnpm run dev      # Vite dev server on http://localhost:5173
```

For the chat to actually answer, point Settings (top right) at any
OpenAI-shape gateway. The fastest local path:

- [LiteLLM](https://github.com/BerriAI/litellm) bridges Ollama / vLLM / TGI /
  llama.cpp into the OpenAI shape on one port.
- For the tool sidebar to populate, also run
  [mcpo](https://github.com/open-webui/mcpo) and point Settings → Tools at it.

## Building the artifact

```bash
pnpm run bundle    # → dist/ + bundle.html (single-file, ~537 KB)
```

This is what gets attached to releases and what `scripts/deploy-atelier.sh`
ships. Internally it runs `tsc -b && vite build && node inline.mjs` — the
inline step folds every emitted CSS / JS asset into one HTML file.

## Testing

There are three layers and you don't always need all three:

1. **Type-check + lint** — `pnpm run lint`. Has to pass. No warnings allowed.
2. **Manual smoke** — open the dev server, send a real message, watch it
   stream. Anything you'd notice as a user must work.
3. **Playwright** (added incrementally) — `pnpm exec playwright test`. If
   your PR touches persistence, cross-tab sync, or Sentinel, you must add or
   update a Playwright spec.

## The "no cheating" rule

Borrowed from the build journal's CLAUDE.md and made permanent for this
repo: every claim in a PR description traces to either (a) a real run you
just did (paste the screenshot / log / curl output verbatim) or (b) an
explicit `FIXTURE` / `TEST` label with obviously-synthetic placeholders.

If your PR description says *"benchmarked at X ms"*, the verification dir
must contain the file you ran to measure it. Plausible-looking numbers that
weren't measured will be questioned in review.

## Areas where help is especially welcome

| Area | Why it matters |
|---|---|
| Auth proxy (`packages/atelier-auth-proxy`) | Launch blocker — see ROADMAP.md |
| Voice tool (Faster-Whisper + Orpheus) | Listed in roadmap, no taker yet |
| Headless-browser tool (Steel + Playwright MCP) | Same |
| BFCL v3 handler for ToolACE-2 | We claim 91.4% BFCL v1 from the paper — we need our own v3 run |
| Cross-OS deploy script | Current script is bash + macOS/Linux; Windows-via-WSL users hit edge cases |
| Storybook stories for the artifact components | Useful for the next round of UI polish |

## Code style

- TypeScript strict mode. No `any` without a `// reason:` comment.
- Functional React with hooks. No class components.
- Tailwind for styling. No CSS-in-JS, no styled-components.
- Files under 500 lines. Split when bigger.
- Zod schemas at every IO boundary (LiteLLM responses, mcpo responses,
  IndexedDB reads).

## Filing issues

Two templates, two flavors:

- **Bug report** — must include: URL where it happened, browser + OS, a
  console paste, repro steps that work on a fresh clone. Issues without a
  console paste tend to bounce around for a week before someone asks for one.
- **Feature request** — describe the user behavior you want, not the
  implementation. Implementation has to fit the single-file constraint and
  the no-runtime-deps rule, so an early implementation sketch isn't useful.

## Code of conduct

Don't be a jerk. PRs and issues get reviewed by humans who appreciate that
you spent time on this; please assume the same when your work is reviewed.

If you find a security issue, please email hello@destiny.computer rather
than opening a public issue.
