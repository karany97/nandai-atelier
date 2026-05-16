# The Destiny Ecosystem

> Atelier is the chat surface. This document is the ecosystem behind it.

If you've only read the main [`README.md`](../README.md), you've seen
one window into a larger system. This file is the picture frame.

## What "ecosystem" means here

In a chat app, the AI answers questions. In our ecosystem, the AI:

- **Lives** — it's always running, retains context across days, knows
  your team by name, knows what you're working on this week
- **Works** — it generates the catalogue images, writes the listing
  copy, monitors inventory, drafts customer support replies, posts
  on schedule
- **Owns** — each employee gets their own AI; each AI gets its own
  Linux desktop (KasmVNC) where it does that work; the operator
  watches over the shoulder, grabs the mouse anytime
- **Audits** — every reply gets judged by Hermes-4.3-36B on 8 axes
  inside 12 s (factuality, hallucination, tool correctness, instruction
  following, refusal appropriateness, style fit, safety, operator
  cost). Bad answers get re-run or escalated; the audit log is the
  operator's source of truth
- **Stays put** — the model weights, the conversation log, the tool
  outputs, the desktop state — all on your own hardware. Outbound
  packets only go to APIs you've explicitly enabled

## The components

```
┌────────────────────────────────────────────────────────────────┐
│  ATELIER (this repo) — the chat window                         │
│  · single 540 KB HTML file                                     │
│  · embeds a right-pane KasmVNC desktop (companion repo below)  │
│  · same-origin auth proxy → mythos-gate → LiteLLM              │
│  · IndexedDB persistence, BroadcastChannel cross-tab sync      │
└──────────────────┬─────────────────────────────────────────────┘
                   ↓ (browser fetch to same-origin /api/*)
┌────────────────────────────────────────────────────────────────┐
│  MYTHOS-GATE — the front door                                  │
│  · HMAC-signed PIN cookie (no JWT, no OAuth)                   │
│  · injects master keys server-side                             │
│  · reverse-proxies /api/llm/*, /api/computer/*, theme-injects  │
└──┬─────────────────────┬────────────────────────┬──────────────┘
   ↓                     ↓                        ↓
┌─────────────┐  ┌───────────────────┐  ┌────────────────────┐
│  LiteLLM    │  │  destiny-computer │  │  108-tool MCP      │
│  (the brain │  │  driver           │  │  fleet (mcpo +     │
│   router)   │  │  · Anthropic      │  │  15 servers)       │
│             │  │   Computer Use    │  │                    │
│  → nandai-  │  │  · docker exec    │  │                    │
│    fast     │  │   into KasmVNC    │  │                    │
│  → nandai-  │  │  · per-task cost  │  │                    │
│    think    │  │   ledger          │  │                    │
│  → nandai-  │  │  · SSE step       │  │                    │
│    tool     │  │   stream back     │  │                    │
│  → opus     │  │   to atelier      │  │                    │
└─────────────┘  └───────────────────┘  └────────────────────┘
       ↓                                          ↓
┌─────────────────────────────────────────────────────────┐
│  SENTINEL — the audit daemon                            │
│  · runs on Hermes 4.3-36B, 8-axis verdict per reply     │
│  · writes audit JSONL, surfaces verdict in the chat     │
│  · triggers escalate-to-Opus when verdict drops         │
└─────────────────────────────────────────────────────────┘
```

## The companion repos

| Repo | What | Status |
|------|------|--------|
| [karany97/nandai-atelier](https://github.com/karany97/nandai-atelier) | This. The chat surface. | shipped |
| [karany97/destiny-computer](https://github.com/karany97/destiny-computer) | KasmVNC + Anthropic Computer Use driver (single-desktop) | v0.2 shipped |
| [karany97/atelier-os](https://github.com/karany97/atelier-os) | **Multi-session** Sway/Wayland fleet — one desktop per teammate, swappable open-weights model ([Holo3-35B-A3B](https://huggingface.co/HCompany/Holo3-35B-A3B) default), iframe-embeddable | v0.1.5 shipped |
| [karany97/tooltalk](https://github.com/karany97/tooltalk) | Translator: Gemma 4 text-format → OpenAI tool_calls | v0.1 |
| [karany97/moa-router](https://github.com/karany97/moa-router) | Self-MoA aggregator (ICLR 2025) | v0.1 |
| [karany97/pingate](https://github.com/karany97/pingate) | The simplest signed-cookie PIN gate | v0.1 |
| [karany97/llamacpp-gemma4-mtp](https://github.com/karany97/llamacpp-gemma4-mtp) | llama.cpp patches for Gemma-4 + MTP speculation | v0.1 |

### destiny-computer vs atelier-os

These are related but different. The short version:

- **destiny-computer** is *one* persistent Linux desktop (KasmVNC + X11 +
  Anthropic Computer Use). Perfect for "I want my AI to have a body and
  the demo to be small enough to read." `docker compose up` and you
  have one teammate.
- **atelier-os** is *N* desktops as a fleet (Sway/Wayland + wayvnc + noVNC
  for live iframe-embeddable streaming + Anthropic OR self-hosted
  Holo3-35B-A3B). Persistent `/home/operator` per session. 259/259 tests
  pass. Built for the "every employee has their own AI" pattern.

You can run either independently. Atelier wires up to both via the same
`/api/computer/*` shape — pick the one that matches the scale you need.

Killer features in flight (spec-only, not yet shipped):
- **nandai-network-agent** — discovers your LAN + Tailscale, adopts SSH
  hosts with one click per host, gives the chat first-class
  `@hostname: command` syntax. Pre-launch trust-model review.
- **Headless theme system** — multiple themes ship in the bundle,
  selected per-URL / per-cookie, no rebuild. Serve N brands off one
  deploy.
- **atelier-os snapshot/restore** — `docker commit` + `tar` the
  per-session `/home/operator` to seed new teammates from a "trained"
  baseline. Spec exists; API in v0.2.

## Per-employee desktops

Two flavors, your choice:

**Single desktop (destiny-computer)** — one KasmVNC container, one
Anthropic Computer Use driver. Read the entire codebase in an
afternoon. Best for "I want the smallest possible 'AI with a body'
demo."

**Multi-session fleet (atelier-os)** — N Sway+Wayland containers
behind one FastAPI fleet (`/sessions`, `/sessions/{id}/task`, SSE
step stream). wayvnc + noVNC iframe-embeddable per session.
Swappable backend — Anthropic for production quality, Holo3-35B-A3B
(Apache 2.0, OSWorld-Verified 77.8%) for $0/inference self-hosted.
259/259 tests pass against live infrastructure.
Each container persists `/home/operator/` across restarts so the AI's
work survives reboots (browser tabs, downloaded files, ssh keys it
generated, partial scripts it was writing).

We run **atelier-os** internally at Nandai (5 sessions: Janvi /
Devika / Aayush / Priya / shared-ops). The atelier instance for each
employee `iframes` their session's WebRTC stream into a right pane
next to the chat. Multi-tenant atelier (one chat surface, many
employees) is on the roadmap.

## Data discipline

| What | Where | Outbound? |
|------|-------|-----------|
| Conversation history | Browser IndexedDB | No |
| Model weights | Your GPU box | No |
| Tool call results | The atelier session memory + audit log on the gate | No |
| Desktop state | KasmVNC volumes on your host | No |
| Anthropic API calls | api.anthropic.com (only if Opus escalation triggers OR Computer Use loop runs) | Yes (paid, audited) |
| MCP server external calls | Per-server: Shopify → Shopify, GitHub → GitHub, etc. | Only the ones you enable |

The **zero-trust default** is: no packet leaves the LAN. You opt in
to each external service by enabling the corresponding MCP server.

## Why "bug-free or it doesn't ship"

Karan runs Nandai (Indian jewelry, on Shopify + Flipkart + Amazon +
Etsy) on this ecosystem. Every bug we ship hurts the business first.
So we ship a discipline most agent-tooling teams don't:

- Every commit goes through a 50× smoke battery
  ([`internal-staging/full-stack-smoke.sh`](../../internal-staging/full-stack-smoke.sh))
- The driver has 20+ unit tests
  ([`destiny-computer/driver/src/test_desktop.py`](https://github.com/karany97/destiny-computer/blob/main/driver/src/test_desktop.py))
- Browser tests via Playwright (in flight)
- Sentinel verdict on every response in development AND production
- The bug-hunt video pipeline is us proving the discipline publicly:
  hard real-world bugs, the AI solves them on camera, Sentinel verifies,
  database stays clean

This is not a side-project repo. It runs an organization.
