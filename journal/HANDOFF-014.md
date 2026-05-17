# Berserker tick-014 handoff — 13:37 UTC
### Two open tabs no longer fight on save

## Shipped

One file, ~85 LOC: `src/lib/store.ts`.

### `BroadcastChannel('nandai-chat:sync')`

Minimal three-op protocol:

```typescript
type SyncMessage =
  | { op: 'save';   convIds: string[] }   // re-read those ids from IDB, merge
  | { op: 'delete'; convIds: string[] }   // drop those ids from state
  | { op: 'clear' };                       // reset to fresh empty conv
```

Constructed once per tab in the existing
`if (typeof window !== 'undefined')` boot block. Guarded by
`typeof BroadcastChannel !== 'undefined'` for SSR / very-old-browser
safety.

### Publish points

- `_flushSaves` — after `saveManyConversations`, publish `{op:'save'}`
  with the ids that were actually written.
- `deleteConversation` — after `deleteConversationFromDB`, publish
  `{op:'delete'}` with the deleted id.
- `clearAllChats` — after `_clearAllConversationsFromDB`, publish
  `{op:'clear'}`.

### Receive handler

- `save` → `loadAllConversations()` + merge by id. Newer `updatedAt`
  wins (matches the bootstrap merge contract). Active conv stays
  pinned at top.
- `delete` → `setState` removes the ids from `conversations[]`, falls
  back to a fresh empty conv if the list went empty, clears the
  active id if it was deleted, clears `activeArtifactMsgId` if it
  pointed into a deleted conv.
- `clear` → mirrors `clearAllChats` locally without re-broadcasting.

BroadcastChannel does NOT echo to the sending context. So when Tab A
publishes, only Tab B and beyond receive — no loop-prevention
ceremony needed.

The sync handler updates state directly via `setState`. It does NOT
go through `pushMessage`/`patchAssistant`, which means it does NOT
schedule a save. So a sync-driven update can't trigger a re-broadcast
that could ricochet between tabs.

## End-to-end proof

Method: Playwright with TWO TABS open on `atelier.nandai.org` after
PIN. Both tabs same origin = share the BroadcastChannel.

| Step | Outcome |
|---|---|
| Tab A: wipe IDB clean (baseline) | both tabs see 0 stored convs |
| Open Tab B (`browser_tabs new`) | Tab B boots, hydrates from IDB (empty), shows scripted demos only |
| Tab A: send "Tick-014 cross-tab sync — this should appear in Tab B too." | scripted reply renders, save scheduler fires, IDB writes 1 entry, BroadcastChannel publishes `{op:'save', convIds:[conv-NN]}` |
| Switch to Tab B (`browser_tabs select 1`) | Sidebar snapshot: "Today" section contains the new "Tick-014…" conv between "New conversation" and "Why does DeepSeek V4 fail…". `document.querySelectorAll('[role="button"][aria-label*="Open conversation"]').length` = 7 (5 scripted + bootstrap + Tick-014). **Cross-tab save propagated.** |
| Tab B: click Tick-014's nested "Delete conversation" affordance | conv removed from Tab B DOM, deleteConversationFromDB removes from IDB, BroadcastChannel publishes `{op:'delete', convIds:[conv-NN]}` |
| Switch back to Tab A | `tick014_in_DOM: false`, `idb_count: 0`. **Cross-tab delete propagated.** |

Screenshot: `26_cross_tab_sync_verified.png` (Tab A after the cross-tab delete).

## Debugging note caught during verification

Initial verification eval returned `sidebar_titles: []` and made me
think sync had failed. The actual cause: the "Open conversation"
affordances are `<div role="button" aria-label="...">`, not real
`<button>` elements. My selector
`document.querySelectorAll('button')` filtered them all out. The
snapshot tool (accessibility tree) correctly surfaced them and
forced me to switch to `[role="button"][aria-label*="..."]`.

Lesson logged for future selectors against this app: always use
`[role="button"]` not `button` when querying the sidebar.

## Bundle delta

- MD5: `46c8204fec9adf7d946219f5c44a61b1` (local & infra-host match)
- Size: 534 KB (+2 KB over tick-012/013 — the BroadcastChannel
  init + handler + the publish call-sites)
- gzip: 146 KB
- Deployed via the new helper from tick-013:
  `bash ~/NandaiJarvis/scripts/deploy-atelier.sh /tmp/nandai-chat/bundle.html tick014`
  one-line summary: `OK md5=46c8204fec9adf7d946219f5c44a61b1
  size=521KB http=200 svc=active via=Tailscale fallback (LAN
  unreachable)`. **Helper validated in production use** — first
  real consumer of tick-013's infra work.

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `46c8204fec9adf7d946219f5c44a61b1` |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| atelier-static.service | active (restarted via helper) |
| LAN the internal-LAN segment (RFC-1918) → (internal-lan) | STILL DOWN (8th tick now) |
| Tailscale `infra-host` | online |
| All tick-004..013 features | intact, no regression |
| Cross-tab save sync | verified A→B |
| Cross-tab delete sync | verified B→A |
| Cross-tab clear sync | wired but not exercised this tick (clearAllChats publishes; receive handler resets state) |

## Open issues carried forward

From HANDOFF-013 minus #13 (now closed):

| # | What | Effort |
|---|---|---|
| 8 | Route tool-needing prompts to nandai-tool via LiteLLM pre-hook | M |
| 10 | Extend sentinel to also judge Opus replies | M |
| 16 | Bring real escape brain online | M |
| 17 | Import schema-v2 migration path | S |
| 18 | Progress bar for big imports | S |
| 19 | Confirm-by-typing for "Clear all" | S |
| 21 | BroadcastChannel for AuditPill refetch (one tab pulls verdict, broadcast to others) | S |
| 23 | Telemetry CSV export | S |
| 24 | LAN (internal-lan) unreachable (8+ hours) | M |
| 25 | Telemetry for tool-error retry recovery rate | S |
| 26 | Surface retry hint visually in tool-call card | S |
| 27 | Success-rate for rerun-with-tools | S |
| 28 | Cooldown across reruns | S |
| 29 | Real bytes-used estimate in storage stats | S |
| 30 | "Export then clear" combo button | S |
| 31 | `build-and-deploy-atelier.sh` companion | S |
| 32 | **NEW**: cross-tab sync for settings/connection changes too. Currently if Tab A toggles auto-escalate or changes a baseUrl, Tab B keeps the old localStorage cache until refresh. Same channel, new op `{op:'connection-change'}` or just a generic `{op:'localstorage', keys:[...]}`. ~20 LOC. | S |
| 33 | **NEW**: per-tab presence indicator — small chip in sidebar showing "another tab is editing this conv" when the sync handler receives a save for the active conv. Prevents the operator from double-typing the same prompt in two tabs by accident. | M |

## Recommended next-tick first action

**Issue #21 — BroadcastChannel for AuditPill refetch.** Same channel
now exists — add an `{op:'verdict', msgId, verdict}` op so when one
tab fetches and stores a sentinel verdict, the other tabs viewing
the same conv get it for free instead of running their own 3-attempt
poll. ~15 LOC. Synergistic with this tick's infrastructure.

Backup if blocked: issue #19 (confirm-by-typing for "Clear all").
~25 LOC custom modal that requires typing `clear all` before the
destructive button enables. Safer than `window.confirm` which
Chrome can globally suppress.

Tick wall time: ~31 min. Bundle iterations: 1 (clean first build).
Verification used the new `browser_tabs` MCP tool — first time
this session — proved out the helper for future multi-tab tests.

*— end handoff-014*
