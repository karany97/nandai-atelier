# Berserker tick-004 handoff — 08:46 UTC
### IndexedDB conversation persistence shipped — refresh no longer wipes work

## Shipped

The audit's #1 ship-blocker (HANDOFF-003 issue #3) is closed:

1. **`src/lib/persist.ts`** — 92 LOC IndexedDB wrapper. Database name
   `nandai-chat`, version 1, single object store `conversations` keyed by
   `id` with an `updatedAt` index. Six exported helpers: `openDB`,
   `loadAllConversations` (sorted updatedAt-desc), `saveConversation`,
   `deleteConversationFromDB`, `saveManyConversations` (batched in one
   tx), `clearAllConversations`. Each helper swallows failures and
   resolves silently — persistence is best-effort, never user-blocking.

2. **`src/lib/store.ts`** — persistence wired in three places:
   - **Boot hydrate** — `queueMicrotask` after first paint reads every
     persisted conv and merges into state. Merge prefers the in-memory
     version on `id` collisions (so a user typing while the DB load is
     in flight isn't clobbered by an older snapshot). Most-recently-
     updated conv lands at the top of the sidebar; the active "New
     conversation" stays pinned at index 0.
   - **Debounced save** — `_dirtyConvs` set + 600 ms trailing-edge
     timer. `pushMessage`, `patchAssistant`, `togglePin`, and (via the
     existing `pushMessage` call) `loadScripted` all schedule a save
     for the touched conv. Empty convos (zero messages) are filtered
     out so we don't pollute storage with the bootstrap placeholder.
   - **Pagehide flush** — synchronous `_flushSaves()` on `pagehide`
     queues IDB `put` requests before the tab closes/refreshes,
     covering the "user refreshes mid-stream" case.
   - **Delete propagation** — `deleteConversation` now also calls
     `deleteConversationFromDB(id)` and removes the id from
     `_dirtyConvs` so a deleted conv can't be resurrected by a
     racing scheduled save.

## End-to-end proof

Method: Playwright drove the bundle on `atelier.nandai.org` after the PIN gate.

| Step | Outcome |
|---|---|
| Boot, inspect IDB | DB opens, store `conversations` exists, count=0 (fresh origin) |
| Send "What time is it in Tokyo right now? Use the time_get_current_time tool with timezone Asia/Tokyo." | Conversation gets auto-titled from the user prompt, assistant streams a reply (962 chars) |
| Inspect IDB | `count: 1` — conv with 2 messages persisted to disk |
| `window.location.reload()` + wait 3s | Page re-renders |
| Re-inspect IDB | Tokyo conv still present, 2 messages intact, first-message preview matches |
| Sidebar DOM | "Today" section now lists "What time is it in Tokyo right now? Use the time_get_curr…" between "New conversation" and the scripted demos |
| Click the persisted Tokyo conv | Both turns render — user prompt + full assistant body (962 chars) |

Screenshot: `17_idb_persistence_verified.png` shows the sidebar with the
Tokyo conv reborn after refresh.

## What this changes

Before: refresh = total amnesia. The chat was a working demo, not a
product. The audit (D-AUDIT-003 root cause) called this the single most
damaging defect — a user who types a long prompt, gets a great reply,
then hits ⌘R loses everything with no warning.

After: the chat survives:
- page refresh
- tab close + reopen (same origin)
- browser restart (IndexedDB persists across launches)
- Cloudflare 5xx transients (the bundle reloads, state restores)

Storage budget: ~2 KB per text-only turn, ~10-50 KB per turn with a tool
call result. Browser quotas for IndexedDB are typically 10+ % of free
disk on Chromium / Safari / Firefox, so the practical ceiling is "many
thousands of conversations before we worry."

Sidebar shows persisted convs above the scripted demos (sorted by
updatedAt desc), with the active "New conversation" placeholder pinned
at the top so the user can always start fresh.

## Bundle delta

- MD5: `e4e8a26995b1b1ff231b26180f63ae56` (local & infra-host match)
- Size: 519 KB single-file (+4 KB over tick-003 — adds persist.ts + the
  store.ts plumbing)
- gzip: 142 KB

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `e4e8a26995b1b1ff231b26180f63ae56` |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| tools.nandai.org/sentinel/{id} | live |
| tool-executor.service | active (running) |
| sentinel.service | active (running) |
| atelier-static.service | active (running, restarted this tick) |
| mythos-gate-atelier.service | active (running) |
| cloudflared.service | active (running) |

## Open issues carried forward

From HANDOFF-003 plus new this tick:

| # | What | Effort |
|---|---|---|
| 4 | Sentinel alert auto-trigger — when verdict's `suggested_action=escalate_to_opus`, kick the Opus fallback automatically | M |
| 7 | Catch tool-error responses (422 etc) and prepend a system hint to next round so the model retries with corrected args | S |
| 8 | Route tool-needing prompts to nandai-tool (faster, BFCL 91.4%) via LiteLLM pre-hook | M |
| 9 | AuditPill re-fetch on tab refocus so long-running tabs see verdicts that landed while backgrounded | S |
| 10 | Extend sentinel to also judge Opus replies for fabrication | M |
| 11 | **NEW**: storage cap + LRU eviction — once we cross ~500 convs / 50 MB, drop oldest unpinned. Easy: walk `updatedAt` index in reverse, delete until under threshold | S |
| 12 | **NEW**: "Export all conversations" → JSON download button in settings, paired with an "Import" picker. Lets a user back up before nuking origin data | S |
| 13 | **NEW**: cross-tab sync via `BroadcastChannel('nandai-chat:sync')` — two open tabs currently fight each other on save; broadcast `convId` after each save so the other tab pulls the fresh version | M |

## Recommended next-tick first action

**Issue #4 — sentinel auto-escalate.** This closes the constant-crawl
recommendation loop end-to-end. The sentinel already returns
`suggested_action` in its verdict; the AuditPill already polls and shows
it. The missing piece is that the chat just *displays* the suggestion
instead of acting on it. ~20 LOC: in `AuditPill.tsx` (or a new
`SentinelObserver`), after `setVerdict(v)`, check
`v.suggested_action === 'escalate_to_opus' && bridgeStatus.ready` and
dispatch `escalateToOpus(msgId)` once. Add a small explanatory chip
("auto-escalated by sentinel") so the operator can tell the difference
from a user-initiated escalation.

Backup if blocked: issue #11 (LRU eviction) — defensive but tiny.

Tick wall time: ~32 min. Bundle iterations: 1 (clean shot; tsc + vite
both passed first try). No incidents.

*— end handoff-004*
