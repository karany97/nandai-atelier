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
| [karany97/destiny-computer](https://github.com/karany97/destiny-computer) | KasmVNC + Anthropic Computer Use driver | v0.2 shipped |
| [karany97/tooltalk](https://github.com/karany97/tooltalk) | Translator: Gemma 4 text-format → OpenAI tool_calls | v0.1 |
| [karany97/moa-router](https://github.com/karany97/moa-router) | Self-MoA aggregator (ICLR 2025) | v0.1 |
| [karany97/pingate](https://github.com/karany97/pingate) | The simplest signed-cookie PIN gate | v0.1 |
| [karany97/llamacpp-gemma4-mtp](https://github.com/karany97/llamacpp-gemma4-mtp) | llama.cpp patches for Gemma-4 + MTP speculation | v0.1 |

Killer features in flight (spec-only, not yet shipped):
- **nandai-network-agent** — discovers your LAN + Tailscale, adopts SSH
  hosts with one click per host, gives the chat first-class
  `@hostname: command` syntax. Pre-launch trust-model review.
- **Headless theme system** — multiple themes ship in the bundle,
  selected per-URL / per-cookie, no rebuild. Serve N brands off one
  deploy.

## Per-employee desktops

We currently run 5 KasmVNC containers (one per team member at Nandai).
Each container persists `/home/operator/` across restarts so the AI's
work survives reboots (browser tabs, downloaded files, ssh keys it
generated, partial scripts it was writing).

The atelier instance for each employee can be configured to route to
their personal KasmVNC + driver. Multi-tenant atelier is on the
roadmap — for now, each employee runs their own atelier bookmark.

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
