# Build journal — 18 ticks, one night

> **Naming note**: this project is now called **Destiny Atelier**. The
> journal entries below (HANDOFF-001 → HANDOFF-018) were written on the
> overnight of May 15→16, 2026 when the product was still called
> *Nandai Atelier*. The chronicle is kept verbatim for historical fidelity
> — re-writing it would erase the trail. New journal entries from May 16
> forward use the *Destiny Atelier* name. Same product, sharper brand.

This folder is the raw chronicle of how the chat got built. Each `HANDOFF-NNN.md`
is one "tick" — one feature, one fix, one ship, one verify, written immediately
after the work landed so the next tick had a working baseline to read from.

The build ran across the night of May 15 → 16, 2026.

## How to read it

Start with [HANDOFF-001](./HANDOFF-001.md) and walk forward. Each tick documents:

- **What was attempted** — the feature/bug for that tick
- **What changed** — file-level diff summary
- **How it was verified** — the exact command(s) or browser test
- **What broke** — anything that surprised the author
- **Carry-over** — what tick N+1 inherits

Reading 18 ticks back-to-back takes ~45 min and gives a much better feel for
how the artifact composes than the source code does.

## What's in the journal that isn't in the source

- Per-tick performance numbers (bundle size growth, time-to-first-token,
  IndexedDB roundtrip latency) — these aren't checked in as tests, but the
  baselines are quoted in handoffs so regressions are obvious.
- Decisions that *didn't* land: e.g. the SSE-stream-via-EventSource path was
  killed in tick-006 in favor of `fetch` streaming. The handoff explains why.
- LAN-vs-Tailscale workaround commentary — tick-007 onward documents a
  chronic LAN issue that forced Tailscale fallback for ssh/scp deploys.

## A note about the IPs in these files

You'll see `(internal-lan)` and `(internal-tailscale)` mentioned a lot. These are:

- `(internal-lan)` — an RFC 1918 private address on the build operator's LAN
- `(internal-tailscale)` — a Tailscale CGNAT (100.64.0.0/10) address

Neither is internet-routable. They're just the actual hostnames the build
ran against, kept in the chronicle for fidelity. They are not exploitable
and reveal no infrastructure secret.

The source code does **not** ship with these IPs baked in — see
[`scripts/deploy-atelier.sh`](../scripts/deploy-atelier.sh) and
[`.env.example`](../.env.example) for how per-operator endpoints get
injected at deploy time.

## Tick index

| Tick | One-liner |
|---|---|
| [001](./HANDOFF-001.md) | First-light boot of the single-file React shell with Tailwind + shadcn/ui |
| [002](./HANDOFF-002.md) | Composer + message list + scripted-fallback skeleton (no live LLM yet) |
| [003](./HANDOFF-003.md) | LiteLLM `/v1/chat/completions` streaming wired in |
| [004](./HANDOFF-004.md) | IndexedDB persistence with LRU cap |
| [005](./HANDOFF-005.md) | Tool sidebar via mcpo + tool-loop round-tripping |
| [006](./HANDOFF-006.md) | Cross-tab BroadcastChannel sync |
| [007](./HANDOFF-007.md) | First Cloudflare-tunnel deploy; LAN went down mid-tick |
| [008](./HANDOFF-008.md) | Tailscale fallback baked into deploy script |
| [009](./HANDOFF-009.md) | Sentinel daemon wired (Hermes 4.3-36B verdicts) |
| [010](./HANDOFF-010.md) | 8-axis Sentinel rubric + auto-recovery (escalate / rerun) |
| [011](./HANDOFF-011.md) | Audit pill component + reranWithTools idempotency |
| [012](./HANDOFF-012.md) | Opus escape via Claude Code bridge |
| [013](./HANDOFF-013.md) | Deploy script consolidation (eliminates per-tick prologue) |
| [014](./HANDOFF-014.md) | First public PIN-gate via mythos-gate proxy |
| [015](./HANDOFF-015.md) | Export / import / clear-all UI (with confirm-by-typing) |
| [016](./HANDOFF-016.md) | Settings drawer (Connection, Tools, Display, Storage) |
| [017](./HANDOFF-017.md) | "Why this brain?" trace + underlying-model surface |
| [018](./HANDOFF-018.md) | Final verification pass + bundle ships at 537 KB |

## Continuing the practice

The journal isn't archived — it's still being updated. Every meaningful
change ships with a new `HANDOFF-NNN.md` so the next contributor inherits
the same context the original author had. See
[`CONTRIBUTING.md`](../CONTRIBUTING.md) for the discipline.
