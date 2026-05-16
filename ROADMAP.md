# Roadmap

Where Atelier is going. Updated weekly when something ships or a plan flips.

**Legend**: ✅ shipped · 🚧 in-flight · 📋 next · 💭 considering · ❌ explicitly out-of-scope

---

## v0.1 (current — May 2026)

The single-file Claude-class chat that runs on your own hardware. What you
see in `bundle.html` today.

| Status | Item | Notes |
|---|---|---|
| ✅ | Single-file React artifact (537 KB) | One `bundle.html`, no runtime deps |
| ✅ | OpenAI-shape multi-LLM routing | Any LiteLLM / Ollama / vLLM endpoint |
| ✅ | Three-brain Trinity (Qwen 3.6-27B + Hermes 4.3-36B + ToolACE-2-8B) | Configurable per-message |
| ✅ | Opus escape via Claude Code bridge | Auto-escalates on local refusal / short answers |
| ✅ | 108 MCP tools via mcpo middleware | memory, web, GitHub, Gmail, Shopify, FS, etc. |
| ✅ | Sentinel observability daemon | 8-axis verdict on every turn |
| ✅ | IndexedDB persistence with LRU cap | 200 convs, oldest unpinned evicted |
| ✅ | Cross-tab sync via BroadcastChannel | Two tabs never disagree |
| ✅ | Export / import / clear-all with confirm-by-typing | Destructive ops gated |
| ✅ | 18-tick build journal | Every feature, fix, ship, verify chronicled |

---

## v0.2 (next 2–4 weeks)

Launch blockers + the first round of post-launch polish.

| Status | Item | Notes |
|---|---|---|
| 🚧 | Auth proxy (`packages/atelier-auth-proxy`) | PIN gate + signed-cookie SSO — required before any public deploy |
| 🚧 | BFCL v3 self-run for ToolACE-2-8B | Replace the "91.4% from paper" line with our own number |
| 📋 | Playwright E2E suite (15 specs) | Snapshot tests for sidebar, composer, settings, tool-loop, Sentinel verdict, cross-tab sync |
| 📋 | Bench harness (`/bench/`) | Reproducible GAIA L1+L2, SWE-bench Verified Lite, τ²-bench runs |
| 📋 | Docker compose for the full stack | `docker compose up` → LiteLLM + mcpo + Sentinel + atelier-static all wired |
| 📋 | Standalone installer for macOS / Linux | Single command brings up the local Trinity if you have a CUDA box |

---

## v0.3 (4–8 weeks)

The two big "tool" gaps that show up in user feedback the most.

| Status | Item | Notes |
|---|---|---|
| 📋 | Voice tool — Faster-Whisper + Orpheus TTS | Push-to-talk + TTS playback on assistant turns |
| 📋 | Headless-browser tool | Steel ([github.com/steel-dev/steel](https://github.com/steel-dev/steel)) + the Playwright MCP. Lets the chat actually click around and scrape |
| 📋 | Image-gen tool | ComfyUI as an MCP — gated until ComfyUI revival decision finalizes |
| 📋 | Multi-modal input | Drag-drop image / PDF; chat sees them via Hermes 4.3-36B's vision adapter |
| 💭 | Memory archive UI | Render the 10M-token archive HNSW search as its own surface, not just a tool call |

---

## v0.4 (8–16 weeks)

The thing the title promises: real *sub-agent dispatch*. Today the chat
can call tools; v0.4 lets it spawn whole Claude/Opus agents in sandboxes.

| Status | Item | Notes |
|---|---|---|
| 📋 | Sub-agent dispatch API | Chat says *"launch an Opus agent to refactor my Shopify cron"* → spawns in E2B / Modal sandbox → streams back into the chat |
| 📋 | Sandbox runner adapters | E2B and Modal first; local Docker as fallback |
| 📋 | Per-agent budget caps | Hard cap on tokens + wall time + dollar before the dispatch returns |
| 💭 | Multi-agent chat surface | Watching multiple agents work side-by-side without spawning multiple tabs |

---

## v0.5+ (longer horizon)

| Status | Item | Notes |
|---|---|---|
| 💭 | Plugin system | Third-party tools register themselves via a manifest, not hard-coded into the bundle |
| 💭 | Federated brain registry | Operators can publish their Trinity stack so others can fall-back to it for capacity |
| 💭 | Native mobile shell | The single-file constraint makes a Capacitor wrap viable |
| 💭 | Voice-first interaction mode | Push-to-talk loop with no UI surface visible — phone-on-table mode |

---

## Explicitly out of scope

These come up; the answer is no. (Subject to revisit if someone makes a
compelling case in an issue.)

| ❌ | Item | Why |
|---|---|---|
| ❌ | Multi-tenant SaaS hosting | Atelier is operator-grade. SaaS multi-tenant introduces an entire compliance surface that misses the product's point. |
| ❌ | "Bring your own GPT-5 key" UX as the *default* path | The default is local. Cloud is the escape hatch, not the spine. |
| ❌ | Built-in payments / Stripe | If you want commerce, you have 108 tools — wire it via MCP. |
| ❌ | "AI agent marketplace" | The product is the chat + the dispatch primitive. Curating other people's agents is a different product. |

---

## How to influence the roadmap

- Open an issue tagged `[roadmap]` describing the behavior you want
- Bump an existing item by upvoting it on the issue
- PRs from `💭` to `📋` are welcome — pick a thing, comment your intent,
  ship the smallest possible cut first

## Cadence

Roadmap reviewed every Sunday. The build journal in `journal/` captures
what actually shipped each tick.
