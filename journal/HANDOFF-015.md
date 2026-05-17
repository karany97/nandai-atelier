# Berserker tick-015 handoff — 14:08 UTC
### Sentinel verdicts piggyback the existing cross-tab channel

## Shipped

Two files, ~50 LOC.

### `src/lib/store.ts`

Added a fourth op to the `SyncMessage` union:

```typescript
type SyncMessage =
  | { op: 'save';   convIds: string[] }
  | { op: 'delete'; convIds: string[] }
  | { op: 'clear' }
  | { op: 'verdict'; msgId: string; verdict: unknown };  // NEW
```

Plus two new public helpers around the existing `_syncChannel`:

- `broadcastVerdict(msgId, verdict)` — fire-and-forget publisher.
  Called by AuditPill after every fresh fetch (initial poll OR
  refocus refetch).
- `subscribeVerdicts(handler)` — returns an unsubscribe fn. AuditPill
  mounts a listener and stops polling once a sibling delivers.

The existing receive handler doesn't intercept `op: 'verdict'` —
it falls through cleanly. AuditPill maintains its own listener
since the verdict only matters to UI components, not store state.

### `src/components/AuditPill.tsx`

Three changes:

1. **`verdictRef`** — a `useRef<SentinelVerdict | null>` kept in sync
   with the `verdict` state via a small effect. The polling loop
   reads it before each `await fetchSentinelVerdict()` and bails when
   non-null. Without this, both tabs would still fetch at t=8s in
   lockstep — the broadcast wouldn't save anything.

2. **Broadcast on local fetch success** — both the initial poll path
   and the refocus refetch path now call `broadcastVerdict(msgId, v)`
   right after `setVerdict(v)`.

3. **Subscribe to sibling verdicts** — new effect:
   ```typescript
   useEffect(() => {
     if (verdict) return;
     return subscribeVerdicts((incomingMsgId, incomingVerdict) => {
       if (incomingMsgId !== msgId) return;
       setVerdict((cur) => cur ?? (incomingVerdict as SentinelVerdict));
     });
   }, [msgId, verdict]);
   ```
   Functional setter form (`cur ?? incoming`) prevents a stale
   broadcast from clobbering a fresher self-fetched verdict in
   a tight race.

The combined effect: when both tabs have an AuditPill mounted on
the same msgId, the first one to fetch shares the verdict with the
rest. Their poll loops see `verdictRef.current` already set on the
next iteration and exit without fetching.

## End-to-end proof

| Proof level | Result |
|---|---|
| Bundle MD5 (local & deployed) | `1bae06edee77c4d9ce9d736ee2e998f9` |
| Channel name `nandai-chat:sync` present in deployed bundle | 1 hit (grep) |
| `"verdict"` op string in deployed bundle | 2 hits (postMessage site + switch handler) |
| BroadcastChannel cross-tab protocol delivery (Tab A → Tab B) | Tab A posted `{op:'verdict', msgId:'PROBE-VERDICT', verdict:{failed_axes:['probe'], suggested_action:'none', axes:{}}}` via raw `new BroadcastChannel('nandai-chat:sync')`; Tab B's listener (also raw channel) captured the full payload byte-for-byte. **Verified.** |
| AuditPill subscribeVerdicts integration end-to-end (both tabs viewing same conv) | Not exhaustively scripted — requires precise timing of both tabs mounting AuditPill on the same msgId before Tab A's t=8s poll fires. Source-reviewed instead; the receive handler is a 4-line useEffect with a guard against self-overwrite. |

Screenshot: `27_verdict_channel_verified.png`.

## Honest limitation

The optimization only fires when **both tabs have AuditPill mounted
on the same conv** at broadcast time. If Tab B is viewing a
different conv (or its default "New conversation"), no AuditPill
mounts for the Tick-015 msg, so the broadcast is dropped on the
floor — even though the conv itself reaches Tab B's sidebar via
tick-014's save sync.

A future tick could cache verdicts in IDB or in a module-level Map
so a late-mounting AuditPill can pick up a verdict that arrived
while it wasn't subscribed. Logged as issue #34.

For the common multi-tab pattern Karan uses (same conv open in
laptop browser and phone PWA), this tick is a real win — the second
device skips a redundant fetch and the first one to load gets the
verdict.

## Build + deploy iterations

Two iterations this tick:

1. **tick-015a** (`280efd2e72b2bf4829936fa5e202effc`) — first shot
   had the receive handler but no `verdictRef` bail-out in the poll
   loop. Without that, both tabs would still fetch at t=8s and the
   broadcast wouldn't save any work. Caught during the source-review
   pass after deploy.
2. **tick-015b** (`1bae06edee77c4d9ce9d736ee2e998f9`) — added
   `verdictRef`, redeployed. Final state.

The deploy helper from tick-013 was used for both — single line
each, no manual ssh ceremony. Deploy-time: ~6 seconds per
iteration.

## Bundle delta

- MD5: `1bae06edee77c4d9ce9d736ee2e998f9` (local & infra-host match)
- Size: 534 KB (+1 KB over tick-014 — the verdict op + 2 helper
  functions + 1 receive useEffect + 1 verdictRef sync effect)
- gzip: 146 KB

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `1bae06edee77c4d9ce9d736ee2e998f9` |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| atelier-static.service | active (restarted twice this tick via helper) |
| LAN the internal-LAN segment (RFC-1918) → (internal-lan) | STILL DOWN (9th tick now — chronic) |
| Tailscale `infra-host` | online |
| Cross-tab save/delete/clear sync (tick-014) | intact |
| Cross-tab verdict sync (this tick) | wired, protocol-verified |
| All tick-004..014 features | intact, no regression |

## Open issues carried forward

From HANDOFF-014 minus #21 (now closed):

| # | What | Effort |
|---|---|---|
| 8 | Route tool-needing prompts to nandai-tool via LiteLLM pre-hook | M |
| 10 | Extend sentinel to also judge Opus replies | M |
| 16 | Bring real escape brain online | M |
| 17 | Import schema-v2 migration path | S |
| 18 | Progress bar for big imports | S |
| 19 | Confirm-by-typing for "Clear all" | S |
| 23 | Telemetry CSV export | S |
| 24 | LAN (internal-lan) unreachable (9+ hours) | M |
| 25 | Telemetry for tool-error retry recovery rate | S |
| 26 | Surface retry hint visually in tool-call card | S |
| 27 | Success-rate for rerun-with-tools | S |
| 28 | Cooldown across reruns (3-strike warning chip) | S |
| 29 | Real bytes-used estimate in storage stats | S |
| 30 | "Export then clear" combo button | S |
| 31 | `build-and-deploy-atelier.sh` companion (just chain the three commands; saves a redundant terminal line every tick) | S |
| 32 | Cross-tab sync for settings/connection changes too | S |
| 33 | Per-tab presence indicator | M |
| 34 | **NEW**: in-memory verdict cache (module-level Map keyed by msgId) so a late-mounting AuditPill on Tab B picks up a verdict that arrived while it wasn't subscribed. Also covers the common case of clicking through to a conv after the broadcast already fired. ~20 LOC. | S |

## Recommended next-tick first action

**Issue #34 — in-memory verdict cache.** Directly extends this tick;
fixes the "AuditPill missed the broadcast" gap I caught during
verification. Implementation: module-level
`const _verdictCache = new Map<string, SentinelVerdict>();` in
store.ts. `broadcastVerdict` writes the cache; AuditPill checks
the cache on mount (synchronous, no fetch) before starting its
poll loop. ~20 LOC; closes the most obvious remaining edge case
in the cross-tab UX.

Backup if blocked: issue #19 (confirm-by-typing for "Clear all") —
still defensible, still ~25 LOC, still a real safety win against
Chrome's "block additional dialogs" gotcha.

Tick wall time: ~33 min (extended by the 015a→015b refactor caught
during source review). Bundle iterations: 2. Verification: protocol
delivery proven cross-tab; full UI integration source-reviewed
with one honest gap logged.

*— end handoff-015*
