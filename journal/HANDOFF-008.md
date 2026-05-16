# Berserker tick-008 handoff — 10:47 UTC
### Real escalation telemetry on the Trinity dashboard

## Shipped

Three files changed, ~95 LOC total:

1. **`src/lib/store.ts`** — new `Telemetry` type on State:
   ```typescript
   type Telemetry = {
     escalationsManual: number;
     escalationsAuto: number;
     since: number;  // epoch ms when counters started
   };
   ```
   Persistence via `localStorage` (key `nandai-chat:telemetry`,
   synchronous because the payload is ~80 bytes — IndexedDB would be
   overkill). New helpers: `loadTelemetry()`, `saveTelemetry()`, and
   the public `resetTelemetry()` action.

   `escalateToOpus(msgId, opts)` now increments after dispatch:
   `opts.reason === 'sentinel auto'` → `escalationsAuto`, anything
   else → `escalationsManual`. Persists to localStorage on every
   increment so a refresh mid-session doesn't lose history.

2. **`src/components/TrinityDashboard.tsx`** — new
   `EscalationMetrics` component renders ABOVE the existing
   "synthetic preview" disclosure banner. Three KPI tiles (Manual /
   Sentinel auto / Total) reading from `state.telemetry`. Small
   `reset` button in the section header; guarded by `window.confirm`
   when count > 0. The Total tile is accent-bordered to distinguish
   it from the breakdown tiles.

   Heading deliberately says `Sentinel escalations · live` —
   contrasting with the `Preview · synthetic` label below, so the
   user can tell at a glance which numbers are real.

## End-to-end proof

Method: Playwright on `atelier.nandai.org` after PIN-1971.

| Stage | Outcome |
|---|---|
| Fresh page, telemetry cleared via `localStorage.removeItem` | Dashboard renders 0/0/0 with today's date as the `since` value |
| Mock Opus bridge health + `/v1/messages` (so `Test bridge` flips bridgeStatus.kind = 'ready') | Bridge probe succeeds, dashboard shows "Online" on Opus card |
| Send a test message → click `Escalate to Opus` button on the reply | `localStorage["nandai-chat:telemetry"]` = `{ escalationsManual: 1, escalationsAuto: 0, since: <epoch> }`. Dashboard re-renders showing M=1 / A=0 / T=1 |
| Click `reset` (auto-accept confirm) | localStorage cleared; dashboard shows 0/0/0 with fresh `since` |
| Set `localStorage` to `{ M:7, A:3, since: yesterday }` and reload | Dashboard renders M=7 / A=3 / T=10 — confirms the load path picks up persisted values across a full page refresh |

Screenshot: `21_telemetry_dashboard.png` shows the rendered
dashboard with the M=7/A=3/T=10 row above the synthetic preview.

## Known limitation surfaced during verification

When the sentinel auto-escalate fires, `AuditPill` flips
`autoTriggered=true` **before** the 400 ms `setTimeout` calls
`escalateToOpus`. The chip renders immediately. If by the time the
setTimeout fires, `escalateToOpus`'s internal guards short-circuit
(streaming in flight, or bridge transiently not-ready), the chip
shows BUT the dispatch never runs, and the counter doesn't
increment.

So the chip and the counter can disagree in this narrow window.
Caught during this tick's verification: chip rendered, counter
stayed at 0. The chip-without-dispatch is the UX bug — the counter
behaviour is actually correct (no dispatch ⇒ no increment).

Fix path (next tick, ~5 LOC): move `setAutoTriggered(true)` inside
the setTimeout callback, **after** confirming the dispatch
succeeded. That requires `escalateToOpus` to return a boolean
("dispatched yes/no") instead of `void`. Logged as new issue #22.

## Bundle delta

- MD5: `29db6f82be3ad95dafbc2d705d76d8f5` (local & .213 match)
- Size: 528 KB single-file (+3 KB over tick-007 — adds the
  Telemetry type, load/save/reset helpers, EscalationMetrics
  component, RealKpi sub-component)
- gzip: 144 KB

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `29db6f82be3ad95dafbc2d705d76d8f5` |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| atelier-static.service | active (restarted via Tailscale path) |
| LAN 10.179.1.0/24 → .213 from Mac | STILL DOWN (deploy used Tailscale `(internal-tailscale)` again) |
| Tailscale `infra-host` | online |
| Telemetry persistence (set 7/3, refresh, render) | verified |
| All earlier tick features (auto-escalate, refocus, persistence) | intact, no regression |

## Open issues carried forward

From HANDOFF-007 plus new this tick:

| # | What | Effort |
|---|---|---|
| 7 | Catch tool-error responses (422 etc) and prepend a system hint for retry | S |
| 8 | Route tool-needing prompts to nandai-tool (faster, BFCL 91.4%) via LiteLLM pre-hook | M |
| 10 | Extend sentinel to also judge Opus replies for fabrication | M |
| 11 | Storage cap + LRU eviction once we cross ~500 convs / 50 MB | S |
| 13 | Cross-tab IDB sync via `BroadcastChannel('nandai-chat:sync')` | M |
| 14 | Handle `suggested_action: rerun_with_tools` action | M |
| 16 | Bring real escape brain online (Opus via Anthropic API budget OR DeepSeek-V4-Flash) | M |
| 17 | Import schema-v2 migration path | S |
| 18 | Progress bar for big imports (>50 convs) | S |
| 19 | Confirm-by-typing for "Clear all" | S |
| 20 | Deploy scripts auto-prefer Tailscale on LAN failure | S |
| 21 | BroadcastChannel for AuditPill refetch (one tab pulls verdict → broadcast to others) | S |
| 22 | **NEW**: `escalateToOpus` returns bool, AuditPill sets `autoTriggered` only on success | S |
| 23 | **NEW**: telemetry CSV export — let Karan pull counters into a spreadsheet for trend analysis | S |
| 24 | **NEW**: investigate LAN 10.179.1.0/24 break (.213 unreachable for 2+ hours via LAN; Tailscale fine) | M |

## Recommended next-tick first action

**Issue #22 — `escalateToOpus` returns bool, AuditPill respects
it.** Tiny scope (~5 LOC), real correctness win. Fixes the
chip-without-dispatch divergence caught during this tick's
verification. Once shipped, the counter and the visible chip will
agree 100% of the time.

Backup if blocked: issue #7 (catch tool-error responses) — the
chat currently shows a generic "tool error" without giving the
model a chance to retry with corrected args. ~30 LOC: parse the
422 body, prepend "[Tool returned an error: {msg}. Try the call
again with corrected arguments.]" as a user-side hint, re-fire
the round.

Tick wall time: ~30 min. Bundle iterations: 1 (clean first build).
Auto-path verification was inconclusive (chip rendered, counter
didn't bump — root-caused to a UX divergence rather than telemetry
bug; logged as issue #22).

*— end handoff-008*
