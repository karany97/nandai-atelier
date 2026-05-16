# Berserker tick-016 handoff — 14:38 UTC
### In-memory verdict cache closes the late-mount gap

## Shipped

Two files, ~30 LOC.

### `src/lib/store.ts`

```typescript
const _verdictCache = new Map<string, unknown>();
const VERDICT_CACHE_CAP = 500;

function _cacheVerdict(msgId, verdict) {
  if (_verdictCache.size >= VERDICT_CACHE_CAP) {
    const firstKey = _verdictCache.keys().next().value;
    if (firstKey !== undefined) _verdictCache.delete(firstKey);
  }
  _verdictCache.delete(msgId);  // bump insertion order
  _verdictCache.set(msgId, verdict);
}

export function getCachedVerdict(msgId): unknown | null {
  return _verdictCache.get(msgId) ?? null;
}
```

Two cache-write call sites:
- `broadcastVerdict(msgId, verdict)` writes to cache before publishing.
  Covers the same-tab future-mount case (AuditPill remount picks up
  a verdict the same tab already fetched).
- Main channel listener gets a new `if (msg.op === 'verdict' …)`
  branch that caches every received broadcast. Covers the
  late-mount case (Tab B's AuditPill mounts AFTER Tab A's broadcast).

Cap: 500 entries (~1 MB worst case at ~2 KB/verdict). Map preserves
insertion order, so first-inserted gets evicted on overflow.
`_cacheVerdict` does a `delete-then-set` to bump insertion order on
re-cache (poor-man's LRU).

### `src/components/AuditPill.tsx`

Single line change — `useState` initializer uses the cache:

```typescript
const [verdict, setVerdict] = useState<SentinelVerdict | null>(
  () => (getCachedVerdict(msgId) as SentinelVerdict | null) ?? null,
);
```

If the cache has the verdict, AuditPill renders the pill in the
same frame as mount — no flicker, no poll, no fetch. The downstream
subscribe/poll effects then short-circuit because `verdict !== null`.

## End-to-end proof

| Proof level | Result |
|---|---|
| Bundle MD5 | `882671cb9aaf5cb992c32494c7224bbf` (local & deployed match) |
| Channel name `nandai-chat:sync` in deployed bundle | 1 hit |
| `"verdict"` op string in deployed bundle | **3 hits** (publisher + 2 receivers — main listener + AuditPill subscriber) |
| `getCachedVerdict` identifier in bundle | 0 (minified — exports get renamed in single-file bundles; the protocol strings + structural counts above are the authoritative proof) |
| BroadcastChannel cross-tab delivery (proved in tick-015) | still working |

## Honest limitation caught during verification (NEW BUG, not from this tick)

While running the planned E2E cache test on Tab B, I discovered
a separate bug in tick-014's cross-tab save sync:

**Symptom:** when Tab A finishes a scripted-fallback stream and the
debounced save fires, Tab B's main listener reads the latest IDB
record AND merges it. BUT the merged conv in Tab B's React state
keeps `msg.streaming = true` for the assistant message — even though
IDB has `streaming: false` (verified by direct IDB read on Tab B
during the test).

**Consequence:** Tab B renders the streaming caret + Thinking trace
panel on the assistant msg, AND `showAudit = !msg.streaming &&
msg.brain === 'nandai'` evaluates to `false` — so AuditPill never
mounts on Tab B. Which means the cache wiring works (verified by
bundle grep + protocol delivery in tick-015), but I couldn't drive
an end-to-end UI proof of the cache hit because Tab B's AuditPill
never gets a chance to read it.

**Root cause (suspected, not yet fixed):** in `_flushSaves`, the
sequence is `void saveManyConversations(toSave); _broadcastSync(…)`
— the broadcast fires synchronously before the IDB readwrite txn
commits. Tab B's listener does `await loadAllConversations()` which
opens its own transaction; IDB scheduling should serialize them, BUT
either an earlier broadcast for the SAME conv (when streaming was
still true) wins the merge step, OR an additional save during the
in-stream window writes streaming:true and broadcasts before the
final streaming:false patch saves and broadcasts.

Logged as new issue #35 below — high-priority because it blocks
several downstream features (this cache test, the per-tab presence
indicator, anything that relies on Tab B's mirrored state being
fully accurate).

## What's still proven

Despite that gap, the cache code itself is correct:
- Source review of all four call sites (broadcastVerdict cache
  write, main listener cache write, AuditPill useState init,
  poll loop verdictRef bail-out from tick-015) is clean.
- All three "verdict" op markers shipped in the deployed bundle.
- BroadcastChannel cross-tab delivery proven in tick-015's
  protocol test.

For the common case where two tabs are open and have AuditPill
mounted on the same conv (no streaming-state divergence), the cache
will work as designed. The streaming-sticky bug is a separate
problem in the SAVE-SYNC path, not the verdict-cache path.

## Bundle delta

- MD5: `882671cb9aaf5cb992c32494c7224bbf` (local & .213 match)
- Size: 535 KB (+1 KB over tick-015b — Map declaration + cache helpers + lazy init)
- gzip: 146 KB

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `882671cb9aaf5cb992c32494c7224bbf` |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| atelier-static.service | active |
| LAN 10.179.1.0/24 → .213 | STILL DOWN (10th tick — chronic) |
| Tailscale `infra-host` | online |
| Cross-tab save/delete/clear (tick-014) | wired; streaming-state divergence bug found (issue #35) |
| Cross-tab verdict broadcast (tick-015) | wired; protocol-verified |
| Verdict cache (tick-016) | wired; bundle-grep-verified |

## Open issues carried forward

From HANDOFF-015 minus #34 (now closed):

| # | What | Effort |
|---|---|---|
| 8 | Route tool-needing prompts to nandai-tool via LiteLLM pre-hook | M |
| 10 | Extend sentinel to also judge Opus replies | M |
| 16 | Bring real escape brain online | M |
| 17 | Import schema-v2 migration path | S |
| 18 | Progress bar for big imports | S |
| 19 | Confirm-by-typing for "Clear all" | S |
| 23 | Telemetry CSV export | S |
| 24 | LAN .213 unreachable (10+ hours, chronic) | M |
| 25 | Telemetry for tool-error retry recovery rate | S |
| 26 | Surface retry hint visually in tool-call card | S |
| 27 | Success-rate for rerun-with-tools | S |
| 28 | Cooldown across reruns | S |
| 29 | Real bytes-used estimate in storage stats | S |
| 30 | "Export then clear" combo button | S |
| 31 | `build-and-deploy-atelier.sh` companion | S |
| 32 | Cross-tab sync for settings/connection changes | S |
| 33 | Per-tab presence indicator | M |
| 35 | **NEW (HIGH)**: cross-tab save sync replicates `msg.streaming = true` to Tab B's React state when Tab A's debounced save fires mid-stream. Tab B's IDB has the correct streaming:false but state diverges. Blocks AuditPill mounting on Tab B + any other downstream feature that depends on Tab B's mirrored state being accurate. **Fix candidate:** in `_flushSaves`, await `saveManyConversations` BEFORE broadcasting, so Tab B's loadAllConversations always reads the latest committed state. Also: drop any conv from the dirty set whose latest in-memory snapshot still has `streaming: true` — don't save mid-stream. | M |

## Recommended next-tick first action

**Issue #35 — fix the streaming-sticky cross-tab sync bug.** This is
genuinely blocking. Two-line fix likely:

```typescript
function _flushSaves() {
  …
  if (toSave.length) {
    saveManyConversations(toSave).then(() => {  // await before broadcast
      _broadcastSync({ op: 'save', convIds: toSave.map((c) => c.id) });
    });
  }
}
```

And add a filter: don't save a conv whose latest assistant msg is
still streaming — saves the work and prevents Tab B from picking
up a half-baked state. The final save 600 ms after the stream
completes will catch the correct state.

Backup if blocked: issue #19 (confirm-by-typing for "Clear all").
Long-pending small win against Chrome's "block additional dialogs"
gotcha.

Tick wall time: ~32 min (E2E debugging the streaming bug ate ~15
min). Bundle iterations: 1. Verification: source-review + bundle
grep verified the new code. End-to-end UI proof blocked by issue
#35 — logged honestly rather than papered over.

*— end handoff-016*
