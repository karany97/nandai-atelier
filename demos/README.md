# Demo recordings

Atelier is a browser app, so the demo discipline is different from
the terminal-tool repos. We use **Playwright** to script reproducible
browser flows, capture them to MP4/WebM, then optionally polish in
Screen Studio (macOS native) or CapCut.

## Why Playwright

- Same script runs the demo deterministically every time (matters for
  the "no cheating" rule — every published GIF traces back to a
  reproducible flow)
- Native video recording with timestamped overlays
- Headless mode for CI / nightly recapture
- Runs against the *real* deployed atelier — no mock data, no fake
  responses

## Tooling install

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

For polish-pass editing (optional):

- [Screen Studio](https://www.screen.studio/) — macOS native, $229 lifetime,
  auto-zoom on clicks, the gold standard for software demo videos
- [CapCut](https://www.capcut.com/) — free, cross-platform, has all the
  basic cuts + captions
- [Charm VHS](https://github.com/charmbracelet/vhs) — for any terminal
  segment you want to splice in

## Per-demo recipes

| File | Captures | Audience |
|---|---|---|
| `01-quick-start.spec.ts` | Open chat → configure Settings → first message → streaming reply | README hero |
| `02-tool-call.spec.ts` | Trigger memory MCP, show round-trip with verbatim JSON | "108 tools" tweet |
| `03-sentinel-verdict.spec.ts` | Receive a reply → audit pill renders → click to expand 8 axes | Sentinel explainer thread |
| `04-cross-tab-sync.spec.ts` | Two browser tabs open, send in tab A, watch tab B update | "Cross-tab coherence" tweet |
| `05-opus-escalation.spec.ts` | Trigger a refusal pattern → auto-escalate to Opus → see "escalated" badge | Trinity routing thread |
| `06-persistence-survives-reload.spec.ts` | Send messages, reload, conversation list intact | IndexedDB persistence proof |

## Running a single demo

```bash
# Record one demo (outputs videos/01-quick-start.webm)
pnpm exec playwright test demos/01-quick-start.spec.ts --headed

# Convert to MP4 + GIF for README embed
ffmpeg -i videos/01-quick-start.webm -vf "fps=15,scale=900:-1" demos/01-quick-start.gif
ffmpeg -i videos/01-quick-start.webm -c:v libx264 -crf 22 demos/01-quick-start.mp4
```

## Re-recording all demos

```bash
pnpm exec playwright test demos/      # one command, all six demos re-record
ls videos/                            # 01-quick-start.webm ... 06-persistence.webm
```

## Style guide

- **Window**: 1280 × 720 (works for X, LinkedIn, README embed, vertical
  crop for TikTok / Reels in post)
- **Theme**: light (atelier's default — warmer, photographs better than
  dark). Force via `localStorage.setItem('nandai-chat:theme', 'light')`
  before any test.
- **Speed**: actions run at ~1.2× real-time so the demo isn't sluggish;
  pauses on important moments (audit pill expanding, tool-call result
  rendering) so viewers can read
- **Captions**: add in post via Descript or CapCut, not in the spec —
  spec text is for the test, not the viewer
- **Duration target**: hero demo < 60s, tweet demos < 30s
- **Hook in first 3 sec**: the first frame must show *something happening*
  (a sent message, an animated pill, a tool result) — never a static
  landing page

## Cadence

Per the viral playbook scout in `sessions/.../scout-viral-launch-investor-playbook.md`:

- **Weekday**: one short (≤30s) demo per day on X. The day's actual
  ship — a new feature, a tool addition, a bench result — gets a fresh
  capture
- **Sunday**: longer (60-90s) hero demo cut from the week's individual
  clips, posted to LinkedIn + the README of the relevant repo
- **HN-worthy**: full README walkthrough (~3min), only posted when
  there's a milestone (v0.2.0, v0.3.0, etc.)

## What does NOT go in demos/

- Mock data (every demo flow uses real local LLM responses)
- Pre-recorded "fake" assistant replies (use the real Trinity behind
  the atelier endpoint or stand up a local LiteLLM)
- Watermarks (we keep these clean for redistribution)
- Music (add in post if needed — most demos don't need it)
