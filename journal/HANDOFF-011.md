# Berserker tick-011 handoff — 12:13 UTC
### Sentinel `rerun_with_tools` — the second recommendation loop now closes

## Shipped

Four files, ~80 LOC: completes the sentinel's two action types.

### `src/lib/store.ts`

1. `runLiveCompletion(convId, opts?)` now takes optional
   `{ forceTools?: boolean; rerunReason?: string }`. When
   `forceTools` is true, the streamChat call is sent with
   `tool_choice: 'required'` instead of `'auto'` — the OpenAI
   contract for "model MUST call at least one tool this turn".
2. New exported action `rerunWithTools(msgId, opts?)` returns
   `boolean` (same contract as tick-009's `escalateToOpus`). Walks
   back to the nearest user message, tags the original assistant
   message with `reranWithTools: true` (so AuditPill doesn't loop
   on remount), then dispatches `runLiveCompletion` with
   `forceTools: true`. Guards: `streamingMsgId` null, tool bridge
   ready, at least one tool loaded, valid conv + user prompt.
3. `Telemetry` gains a `rerunsWithTools: number` field; `loadTelemetry`
   defaults it to 0 when the persisted payload is older; `resetTelemetry`
   clears it.

### `src/lib/types.ts`

`AssistantMessage.reranWithTools?: boolean` — mirror of `escalated`.
Prevents double-rerun across navigations.

### `src/components/AuditPill.tsx`

Second `useEffect` symmetric to the auto-escalate one but watching
for `verdict.suggested_action === 'rerun_with_tools'`. Guards:
- `verdict` exists, `rerunTriggered` still false (per-mount), msg
  not `alreadyReran`, `autoEscalate` opt-in true, **tools ready**
  (replaces the bridge-ready check; reruns stay on Trinity, no
  Opus bridge needed), and no other stream in flight.
- `setRerunTriggered(true)` only flips inside the setTimeout AFTER
  `rerunWithTools()` returns `true` — same chip-counter agreement
  guarantee from tick-009.

New visible chip alongside `auto-escalated`:

```tsx
{rerunTriggered && (
  <span className="... text-sky-700 ... border-sky-500/30"
    title="The sentinel verdict said the model should have used a tool;
           the chat re-fired the turn with tool_choice='required'.">
    sentinel rerun
  </span>
)}
```

Sky-coloured instead of amber so the operator can tell the two paths
apart at a glance.

### `src/components/Message.tsx`

Passes the new `alreadyReran={!!msg.reranWithTools}` prop to AuditPill.

### `src/components/TrinityDashboard.tsx`

`EscalationMetrics` panel grew from 3 to 4 tiles:
- Manual escalate / Sentinel auto-escalate / **Sentinel rerun-with-tools** (new) / Total
- Total = sum of all three counters (escalations + reruns), accent-bordered
- Reset button's confirm text now includes both class counts:
  `"... currently tracking ${grandTotal} actions (${escalations} escalations + ${reruns} reruns) since ${date}."`
- Heading renamed `Sentinel escalations · live` → `Sentinel actions · live`
  to cover the wider class of action.

## End-to-end proof

Method: Playwright on `atelier.nandai.org` after PIN-1971.

| Stage | Outcome |
|---|---|
| Reset telemetry, point connection at public `https://tools.nandai.org`, reload | Sidebar shows "Tools: 108 loaded" — real tools from live mcpo through Cloudflare tunnel; `toolBridgeStatus.kind === 'ready'` |
| Install fetch-mock that makes `/sentinel/{id}` return `suggested_action: 'rerun_with_tools'` | mock live |
| Send "Tick-011 sentinel rerun-with-tools test." | Scripted-fallback assistant reply renders (LAN to .213:8008 still down, so live gateway probe failed — but `toolBridgeStatus` is independent and stays ready) |
| Wait 15 s for the t=8s sentinel poll + 400 ms dispatch delay | |
| Inspect surfaces | `has_rerun_chip: true`, `has_auto_chip: false`, `telemetry.rerunsWithTools: 1`, `escalationsManual: 0`, `escalationsAuto: 0`, **chip_and_counter_agree: true** |
| Open Trinity dashboard | Sentinel actions row renders 4 tiles: Manual=0, Auto-escalate=0, **Rerun-with-tools=1**, Total=1, since today |

Screenshot: `24_sentinel_rerun_verified.png`.

The rerun verdict triggered the new effect path, not the
escalate-to-opus one — proving the two paths are properly
disjoint (each gated on its own `suggested_action` string).

## What the constant-crawl loop looks like now

After this tick, every sentinel verdict has an automatic recovery
path AND a visible telemetry counter:

| Verdict `suggested_action` | Auto-recovery | Visible chip | Counter |
|---|---|---|---|
| `none` | (no action — the answer is fine) | — | — |
| `escalate_to_opus` | dispatch Opus via bridge | amber `auto-escalated` | `escalationsAuto++` |
| `rerun_with_tools` | re-fire turn with `tool_choice='required'` | sky `sentinel rerun` | `rerunsWithTools++` |

`flag_for_review` and other verdict types still appear in the drawer
("suggested: <action>") but don't dispatch automatically — they
require human judgment that we don't want to second-guess.

## Bundle delta

- MD5: `d41854719aff4ce87c5fabd0d7c06fcd` (local & .213 match)
- Size: 531 KB (+2 KB over tick-010 — new action + new chip + 4th
  dashboard tile + telemetry field + type change)
- gzip: 145 KB

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `d41854719aff4ce87c5fabd0d7c06fcd` |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| atelier-static.service | active (restarted via Tailscale) |
| LAN 10.179.1.0/24 → .213 | STILL DOWN (5 ticks now; issue #24 has aged into chronic) |
| Tailscale `infra-host` | online |
| All earlier tick features (persistence, auto-escalate, refocus, retry-hint) | intact, no regression |

## Open issues carried forward

From HANDOFF-010 minus #14 (now closed):

| # | What | Effort |
|---|---|---|
| 8 | Route tool-needing prompts to nandai-tool via LiteLLM pre-hook | M |
| 10 | Extend sentinel to also judge Opus replies | M |
| 11 | Storage cap + LRU eviction at ~500 convs / 50 MB | S |
| 13 | Cross-tab IDB sync via BroadcastChannel | M |
| 16 | Bring real escape brain online | M |
| 17 | Import schema-v2 migration path | S |
| 18 | Progress bar for big imports | S |
| 19 | Confirm-by-typing for "Clear all" | S |
| 20 | Deploy scripts auto-prefer Tailscale on LAN failure | S |
| 21 | BroadcastChannel for AuditPill refetch | S |
| 23 | Telemetry CSV export | S |
| 24 | LAN .213 unreachable (5+ hours now) | M |
| 25 | Telemetry for tool-error retry recovery rate | S |
| 26 | Surface retry hint visually in tool-call card | S |
| 27 | **NEW**: success-rate for rerun-with-tools — track whether the second pass actually called a tool or hallucinated again. Needs a callback from `runLiveCompletion(forceTools)` back into telemetry on completion. | S |
| 28 | **NEW**: cooldown across reruns — if `rerunWithTools` fires three times on the same conv with no tool calls landing, surface a warning chip instead of looping. Defensive against bad sentinel rules. | S |

## Recommended next-tick first action

**Issue #11 — storage cap + LRU eviction.** With IDB persistence
(tick-004) and accumulated conversations across ticks (now at 6
locally), we should put a soft ceiling on storage growth before
quota errors surprise an operator who hasn't been clearing things.
Walk the `updatedAt` index in reverse on each save; drop oldest
unpinned conv when stored total exceeds a threshold (e.g. 200 convs
or 50 MB estimated bytes). ~40 LOC in `persist.ts`.

Backup if blocked: issue #20 (deploy scripts default to Tailscale) —
five ticks now using the fallback path with a copy-pasted Bash
prologue. Time to bake it into a small shell helper so future ticks
don't keep rediscovering the LAN is down.

Tick wall time: ~28 min. Bundle iterations: 1 (clean first build).
Verification: rerun chip + counter both incremented from a single
mocked verdict; dashboard renders the new 4-tile row.

*— end handoff-011*
