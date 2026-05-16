# Berserker tick-017 handoff — 15:07 UTC
### Streaming-sticky cross-tab bug fixed + tick-016 cache E2E now provable

## Shipped

One file, ~10 LOC of net change: `src/lib/store.ts` `_flushSaves`.

The fix has two parts, both surgical:

```typescript
saveManyConversations(toSave).then(() => {
  const broadcastIds = toSave
    .filter((c) => {
      const last = c.messages[c.messages.length - 1];
      return !last || last.role !== 'assistant' || !last.streaming;
    })
    .map((c) => c.id);
  if (broadcastIds.length) {
    _broadcastSync({ op: 'save', convIds: broadcastIds });
  }
}).catch(() => { /* swallow */ });
```

1. **Await IDB before broadcasting.** Was `void saveManyConversations(...); _broadcastSync(...)` — the broadcast fired synchronously before the IDB readwrite transaction committed. Now the broadcast is queued on `.then()` so sibling tabs' `loadAllConversations()` always reads the just-committed state, not a stale pre-write snapshot.

2. **Skip broadcasts for still-streaming convs.** During a 5s scripted stream, the debounced save can fire several times — each carrying `msg.streaming: true`. We still WRITE these to IDB (preserves local recovery on refresh mid-stream), but we DO NOT broadcast them. Sibling tabs only learn about the conv once the final post-stream save fires (`streaming: false`).

Together: Tab A's IDB stays current for recovery; Tab B only sees fully-baked state.

## End-to-end proof

Method: two-tab Playwright on `atelier.nandai.org` — same shape as the tick-016 cache test that was blocked by this bug.

**Setup:**
- Tab A: clear IDB, install fetch mock that returns a clean verdict from `/sentinel/*`
- Tab B: install fetch mock that returns 500 on `/sentinel/*` (so we can detect any Tab B fetch as a failure)
- Both tabs counting fetches in `window.__sentinelFetchCount`

**Flow:**
1. Tab A sends "Tick-017 streaming-sticky fix + cache test…"
2. Scripted reply streams over ~5s, completes, AuditPill mounts on Tab A
3. At t=8s, Tab A polls `/sentinel/`, mock returns verdict, AuditPill calls `broadcastVerdict(msgId, v)`
4. Tab B's main BroadcastChannel listener writes to `_verdictCache`
5. Switch to Tab B, click the synced conv in sidebar → AuditPill mounts late
6. Inspect

**Result:**

| Property | Value | Meaning |
|---|---|---|
| Tab A `fetch_count` | 1 | initial poll succeeded |
| Tab A `audit_in_dom` | true | pill rendered locally |
| Tab B sidebar shows synced conv | yes | tick-014 save sync still working |
| Tab B IDB has `asst_streaming: false` | yes | save committed correctly |
| Tab B `fetch_count_before_click` | 0 | no Tab B fetch (nothing to poll for yet) |
| Tab B `audit_buttons_count` (after click) | **1** | **AuditPill MOUNTS on Tab B — was 0 before this fix** |
| Tab B `audit_text` | `audit · clean` | cached verdict rendered |
| Tab B `caret_elements` | **0** | **no streaming caret — fix verified** |
| Tab B `fetch_count_after_mount` | **0** | **cache hit; no /sentinel/ call** |

Both bugs closed in the same tick: `caret_elements: 0` proves the streaming-sticky fix, `fetch_count_after_mount: 0` proves tick-016's cache is functioning end-to-end.

Screenshot: `28_streaming_sticky_fixed_cache_e2e.png`.

## Bundle delta

- MD5: `08c2c4948b3e04a04980093614f7f90a` (local & .213 match)
- Size: 535 KB (negligible delta from tick-016 — same lines net)
- gzip: 146 KB
- Deployed via `deploy-atelier.sh` helper, single line.

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `08c2c4948b3e04a04980093614f7f90a` |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| atelier-static.service | active |
| LAN 10.179.1.0/24 → .213 | STILL DOWN (11th tick — chronic) |
| Tailscale `infra-host` | online |
| Cross-tab save sync (tick-014, fixed this tick) | streaming-sticky bug closed |
| Cross-tab verdict broadcast (tick-015) | wired, protocol-verified |
| Verdict cache (tick-016) | wired, **E2E verified this tick** |
| Late-mounting AuditPill picks up cached verdict | proven this tick (Tab B `fetch_count_after_mount: 0`) |
| All earlier tick features | intact, no regression |

## Open issues carried forward

From HANDOFF-016 minus #35 (now closed):

| # | What | Effort |
|---|---|---|
| 8 | Route tool-needing prompts to nandai-tool via LiteLLM pre-hook | M |
| 10 | Extend sentinel to also judge Opus replies | M |
| 16 | Bring real escape brain online | M |
| 17 | Import schema-v2 migration path | S |
| 18 | Progress bar for big imports | S |
| 19 | Confirm-by-typing for "Clear all" | S |
| 23 | Telemetry CSV export | S |
| 24 | LAN .213 unreachable (11+ hours, chronic) | M |
| 25 | Telemetry for tool-error retry recovery rate | S |
| 26 | Surface retry hint visually in tool-call card | S |
| 27 | Success-rate for rerun-with-tools | S |
| 28 | Cooldown across reruns | S |
| 29 | Real bytes-used estimate in storage stats | S |
| 30 | "Export then clear" combo button | S |
| 31 | `build-and-deploy-atelier.sh` companion | S |
| 32 | Cross-tab sync for settings/connection changes | S |
| 33 | Per-tab presence indicator | M |

## Recommended next-tick first action

**Issue #19 — confirm-by-typing for "Clear all".** Long-pending small win. Current `window.confirm("Clear all N conversations?")` can be globally suppressed by Chrome's "prevent additional dialogs" checkbox, making the destructive button effectively undefended. ~25 LOC custom modal that requires typing `clear all` to enable the button.

Backup if blocked: issue #23 (telemetry CSV export) — adds a small "Download as CSV" button next to the existing reset button in TrinityDashboard's escalation metrics. Let Karan pull counters into a spreadsheet for trend analysis. ~20 LOC.

Tick wall time: ~24 min. Bundle iterations: 1. Verification: two-tab E2E exercised all the fixed code paths AND the previously-blocked tick-016 cache E2E in a single test run.

*— end handoff-017*
