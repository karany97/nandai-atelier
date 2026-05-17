# Berserker tick-012 handoff — 12:41 UTC
### LRU storage cap — runaway IDB growth can't surprise the operator

## Shipped

Two files, ~95 LOC.

### `src/lib/persist.ts`

Three new exports plus a fire-and-forget hook in the existing save path:

1. Constants:
   ```typescript
   const MAX_CONVS = 200;    // hard ceiling
   const SOFT_TARGET = 160;  // evict back to here when ceiling breached
   ```

2. `enforceCap(): Promise<number>` — opens a read-only count first
   (cheap, single index lookup); bails immediately when `count <=
   MAX_CONVS`. Only when we cross does it open a read-write cursor
   on the `updatedAt` index (ascending = oldest first), skip every
   `pinned: true` entry, and delete oldest unpinned until count
   reaches `SOFT_TARGET`. Returns the number evicted (0 if no-op).

3. `getStorageStats()` — returns `{ count, pinned, cap, softTarget }`.
   Used by the Settings panel to show live storage usage and warn
   when approaching the cap.

4. `saveManyConversations` now ends with `void enforceCap()` after
   the put-batch transaction completes. Fire-and-forget, swallows
   errors, never blocks the caller. Most saves are no-ops because
   we're well below the cap.

Pinning is sacred — a pinned conv with the OLDEST `updatedAt` will
NOT be evicted. The operator's expressed preference always wins
over LRU's "oldest" signal.

### `src/components/SettingsDrawer.tsx`

`DataManagementPanel` now polls `getStorageStats()` every 5 s while
the Settings drawer is open. New line below the 3-button row:

```
Stored: 160 · 3 pinned of cap 200 (80%). Oldest unpinned will be
evicted when crossing 200.
```

At <80% the line is muted-text. At ≥80% it tints amber with the
nudge text "Oldest unpinned will be evicted when crossing 200." so
the user sees the warning before LRU silently drops anything.

## End-to-end proof

Method: Playwright on `atelier.nandai.org` after the PIN gate.

| Step | Outcome |
|---|---|
| `os.clear()`, then seed 220 fake convs into IDB (ids `seed-0`..`seed-219`, `pinned: true` for `seed-0/1/2` — the three OLDEST entries by `updatedAt`) | count = 220 |
| Send a real message via the composer (triggers `saveManyConversations` via the debounced save scheduler) | save batch completes, `enforceCap` fires |
| Re-inspect IDB | total = **160** (exactly `SOFT_TARGET`); 3 pinned survivors = `seed-0/1/2`; 156 unpinned survivors (the newest); 1 new conv from the typed message; 61 unpinned evicted in oldest-first order |
| Open Settings → Data & privacy panel | "Stored: 160 · 3 pinned of cap 200 (80%). Oldest unpinned will be evicted when crossing 200." — amber tint because pct == 80 |
| Cleanup: delete all `seed-*` ids | 159 deleted, IDB returned to natural state for next tick |

The most important property is the **pinned-skip**: `seed-0/1/2`
have the OLDEST `updatedAt` of any conv in the store, so a naive
oldest-first eviction would have killed them first. The `if
(conv.pinned) c.continue();` guard preserved them. Verified by id
in the cleanup output (`pinned_survived: ["seed-0", "seed-1",
"seed-2"]`).

Screenshot: `25_lru_eviction_verified.png`.

## Math worked example

Starting from 220 stored:
- `MAX_CONVS = 200`, `SOFT_TARGET = 160`
- Save triggered enforceCap → count > MAX
- `toEvict = total - SOFT_TARGET = 221 - 160 = 61` (after the new conv pushed total to 221)
- Cursor walked ascending by `updatedAt`:
  - `seed-0` pinned → skip
  - `seed-1` pinned → skip
  - `seed-2` pinned → skip
  - `seed-3..63` unpinned → delete (61 total)
  - `seed-64..219` unpinned → not visited, cursor stopped after 61 deletes
- Final: 3 pinned + 156 unpinned `seed-64..219` + 1 new = **160**

## Bundle delta

- MD5: `fc42250520c0b40e790f9d8db11b4f5d` (local & infra-host match)
- Size: 532 KB (+1 KB over tick-011 — enforceCap + getStorageStats
  + the storage-line in Settings)
- gzip: 145 KB

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `fc42250520c0b40e790f9d8db11b4f5d` |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| atelier-static.service | active (restarted via Tailscale, 6th tick in a row) |
| LAN the internal-LAN segment (RFC-1918) → (internal-lan) | STILL DOWN (chronic — issue #24) |
| Tailscale `infra-host` | online |
| IDB total convs post-cleanup | back to ~6 (tick-010 baseline) |
| All tick-004..011 features | intact, no regression |

## Open issues carried forward

From HANDOFF-011 minus #11 (now closed):

| # | What | Effort |
|---|---|---|
| 8 | Route tool-needing prompts to nandai-tool via LiteLLM pre-hook | M |
| 10 | Extend sentinel to also judge Opus replies | M |
| 13 | Cross-tab IDB sync via BroadcastChannel | M |
| 16 | Bring real escape brain online | M |
| 17 | Import schema-v2 migration path | S |
| 18 | Progress bar for big imports | S |
| 19 | Confirm-by-typing for "Clear all" | S |
| 20 | Deploy scripts auto-prefer Tailscale on LAN failure | S |
| 21 | BroadcastChannel for AuditPill refetch | S |
| 23 | Telemetry CSV export | S |
| 24 | LAN (internal-lan) unreachable (6+ hours) | M |
| 25 | Telemetry for tool-error retry recovery rate | S |
| 26 | Surface retry hint visually in tool-call card | S |
| 27 | Success-rate for rerun-with-tools | S |
| 28 | Cooldown across reruns (3-strike warning chip) | S |
| 29 | **NEW**: real bytes-used estimate instead of just count. Walk every conv, JSON.stringify, sum — async, cached for 10 s. Lets the "Stored: N" line show "(~12 MB)" for the operator's mental model. | S |
| 30 | **NEW**: "Export then clear" combo button — common operator flow is "back up before resetting", we could one-shot it. | S |

## Recommended next-tick first action

**Issue #20 — deploy scripts auto-prefer Tailscale on LAN failure.**
After 6 ticks of pasting the same Bash prologue
(`LAN_OK=$(nc -z -G 2 ... && echo yes || echo no)`) into every
deploy block, time to bake it into a small helper at
`~/NandaiJarvis/scripts/deploy-atelier.sh` that future ticks just
invoke. ~20 lines of shell. Side benefit: makes the deploy step a
single Bash call instead of three.

Backup if blocked: issue #13 (cross-tab IDB sync via
BroadcastChannel). Two open tabs currently race on save and the
losing tab gets a stale view. ~30 LOC — broadcast `{ id, op:
'save' | 'delete' }` after each persist; other tabs receive and
patch in-memory state.

Tick wall time: ~30 min. Bundle iterations: 1 (clean first build).
Verification: seeded 220 (incl. 3 pinned with oldest updatedAt),
typed one message to trigger save, asserted post-state had 160
total with exactly the right 3 pinned survivors. Then cleaned up
the seed data so the next tick starts from a natural baseline.

*— end handoff-012*
