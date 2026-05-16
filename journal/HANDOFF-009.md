# Berserker tick-009 handoff — 11:15 UTC
### Chip + counter never disagree (issue #22 closed)

## Shipped

Two files, ~10 LOC of net change.

### `src/lib/store.ts`

`escalateToOpus(msgId, opts)` now returns `boolean` instead of `void`.
Every guard-fail (`streamingMsgId` non-null, `bridgeStatus.kind !==
'ready'`, no active conv, no nearest user message) returns `false`.
The success path returns `true` after the telemetry increment lands.
Backwards-compat for all existing call sites: the manual "Escalate
to Opus" button in `Message.tsx` calls it as a fire-and-forget; the
return value is ignored, no breakage.

### `src/components/AuditPill.tsx`

Auto-escalate effect: `setAutoTriggered(true)` moved INSIDE the 400 ms
setTimeout callback, gated on `escalateToOpus(...) === true`. The
chip now only renders when a dispatch actually fired. Before this
tick, the chip flipped before the setTimeout, so a guard-fail in
the inner call left the chip on screen with no counter bump — what
tick-008 caught and logged as issue #22.

```typescript
const t = setTimeout(() => {
  const dispatched = escalateToOpus(msgId, { reason: 'sentinel auto' });
  if (dispatched) setAutoTriggered(true);
}, 400);
```

## End-to-end proof — two scenarios

### Scenario A: happy path

| Step | Outcome |
|---|---|
| Fresh page, telemetry cleared | dashboard shows 0/0/0 |
| Install mocks (sentinel → escalate, bridge health 200, /v1/messages 200) | mocks live |
| Click `Re-probe` on Opus bridge card in dashboard | `bridgeStatus.kind === 'ready'` |
| Send a message, wait 15s | assistant replies, AuditPill polls /sentinel at t=8s |
| Inspect surfaces | `audit_pills_total = 1`, `auto_escalated_chips_total = 1`, `telemetry.escalationsAuto = 1`, **agreement holds** |

### Scenario B: bridge down

| Step | Outcome |
|---|---|
| Clear telemetry, swap bridge mock to 503 | sidebar pill flips to "Opus bridge: down" |
| Send another message, wait 15s | assistant replies, AuditPill polls /sentinel at t=8s and gets `escalate_to_opus` again |
| Inspect surfaces | `audit_pills_total = 2`, `auto_escalated_chips_total = 0`, `telemetry.escalationsAuto = undefined`, **agreement holds** (both zero) |

The AuditPill's `bridgeReady` guard short-circuits BEFORE the
setTimeout in scenario B — so dispatch never runs, chip never flips,
counter never bumps. All three surfaces stay coherent.

Screenshot: `22_chip_counter_agree.png`.

## Bundle delta

- MD5: `f5be34e8feadedc7ff64ba497aae4902` (local & .213 match)
- Size: 528 KB (effectively unchanged from tick-008; +20 bytes
  for the new boolean return value and the moved setAutoTriggered
  call)
- gzip: 144 KB

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `f5be34e8feadedc7ff64ba497aae4902` |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| atelier-static.service | active (restarted via Tailscale) |
| LAN 10.179.1.0/24 → .213 | STILL DOWN (issue #24 — third tick in a row using Tailscale fallback) |
| Tailscale `infra-host` ((internal-tailscale)) | online |
| Tick-005..008 features | intact, no regression |

## Open issues carried forward

From HANDOFF-008 minus #22 (now closed):

| # | What | Effort |
|---|---|---|
| 7 | Catch tool-error 422 responses, prepend retry hint | S |
| 8 | Route tool-needing prompts to nandai-tool via LiteLLM pre-hook | M |
| 10 | Extend sentinel to also judge Opus replies | M |
| 11 | Storage cap + LRU eviction at ~500 convs / 50 MB | S |
| 13 | Cross-tab IDB sync via BroadcastChannel | M |
| 14 | Handle `suggested_action: rerun_with_tools` | M |
| 16 | Bring real escape brain online (Anthropic budget OR DeepSeek-V4-Flash) | M |
| 17 | Import schema-v2 migration path | S |
| 18 | Progress bar for big imports (>50 convs) | S |
| 19 | Confirm-by-typing for "Clear all" instead of `window.confirm` | S |
| 20 | Deploy scripts auto-prefer Tailscale on LAN failure | S |
| 21 | BroadcastChannel for AuditPill refetch | S |
| 23 | Telemetry CSV export | S |
| 24 | Investigate LAN .213 unreachable for 3+ hours via LAN; Tailscale fine | M |

## Recommended next-tick first action

**Issue #7 — tool-error retry hint.** When mcpo returns 422
(invalid args) or 5xx, the chat currently shows "tool error" and
the model gives up. Real product polish: parse the error body,
prepend `[Tool returned an error: {detail}. Try the call again
with corrected arguments.]` as a user-side hint, then re-fire the
turn through `runToolLoop`. The model often gets it right on the
second pass. ~30 LOC in `store.ts`'s tool loop.

Backup if blocked: issue #11 (LRU eviction at storage cap) —
defensive, ~30 LOC walking the `updatedAt` index in reverse.

Tick wall time: ~22 min. Bundle iterations: 1 (clean first build).
Verification both scenarios passed first try.

*— end handoff-009*
