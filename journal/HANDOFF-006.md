# Berserker tick-006 handoff — 09:48 UTC
### Conversation data ownership: Export / Import / Clear All

## Why this and not the recommended #16

HANDOFF-005 recommended bringing a real Opus bridge online on .213.
Re-reading the canonical memory: Anthropic blocked Max-sub bridges
on 2026-04-04 (`feedback_no_cheating.md` cross-ref / project-level
note `project_opus47_max_sub_blocked.md`). The path is dead without
either an explicit per-token ANTHROPIC_API_KEY budget or a different
escape brain (DeepSeek-V4-Flash is the cheaper-than-Opus interim).
Either choice is a config / budget call belonging to Karan, not a
deploy.

So I rerouted to the next most-product-shaped gap: data ownership.
Users now had a chat that *persists* (tick-004) but no way to:
- get their data OUT (no backup)
- get their data IN (no migration)
- start fresh (no "clear all")

This tick closes that gap.

## Shipped

1. **`src/lib/persist.ts`** — already had `clearAllConversations`
   from tick-004; no edit needed.

2. **`src/lib/store.ts`** — three new exported actions:
   - `clearAllChats(): Promise<number>` — wipes IDB, resets to a
     single fresh empty conv, returns the deleted count.
   - `exportAllChats(): { json, count, bytes }` — serializes every
     non-empty conv into a self-describing JSON payload:
     ```
     { schema: "nandai-chat.conversations", version: 1,
       exportedAt, count, conversations: [...] }
     ```
   - `importChats(json): { added, skipped, errors }` — accepts either
     the wrapper shape or a bare array. Validates each conv has an
     `id` and `messages[]`; skips malformed entries with a count.
     Imported convs overwrite same-id existing convs in IDB AND merge
     into in-memory state so the sidebar updates without a refresh.

3. **`src/components/SettingsDrawer.tsx`** — Settings → "Data &
   privacy" section now has a 3-button row (`DataManagementPanel`):
   - Export all (download trigger; filename `nandai-chat-YYYY-MM-DD.json`)
   - Import (hidden file picker; 50 MB hard cap)
   - Clear all (red-tinted; `window.confirm` gate)
   Plus an inline status line that surfaces success/error per
   operation and auto-clears after 6 s. The existing privacy blurb
   stays above; the new buttons sit below.

   Updated the privacy blurb to mention IndexedDB explicitly so users
   know where the chat history actually lives.

## End-to-end proof

Method: Playwright on `atelier.nandai.org` after the PIN gate.

Starting state (carryover from tick-004 + tick-005):
- IDB: 2 convs ("Tokyo" + "London" tool-call turns)

| Step | Outcome |
|---|---|
| Open Settings → scroll to "Data & privacy" | 3 buttons render with labels and "2 convs" dynamic hint |
| Click **Export all** (URL.createObjectURL intercepted) | JSON payload captured: 8835 bytes, `schema: "nandai-chat.conversations"`, `version: 1`, `count: 2`, first title preserved. The actual file download fired and Playwright captured it as `nandai-chat-2026-05-16.json` |
| Click **Clear all** (auto-accept confirm) | IDB drops to 0 entries; UI resets to a fresh "New conversation" |
| Synthesize a `File` from the captured JSON and dispatch a `change` event on the hidden input | IDB restored to 2 convs; titles intact; status message reads "Imported 2" |
| `window.location.reload()` + wait 3 s | Page boots fresh, async hydrate reads IDB |
| Snapshot sidebar's "Today" section | Lists "New conversation" + "What time is it in London right now…" + "What time is it in Tokyo right now…" + the scripted DeepSeek demo |

Screenshots: `19_data_mgmt_panel.png` (Settings drawer scrolled to the
new panel). Sample export attached as `sample-export-tick006.json`
(8.9 KB, the exact payload the export produced during verification —
useful as a fixture for tests).

## Bundle delta

- MD5: `a18465c00770b664afe75ad32dcc428e` (local & infra-host match)
- Size: 525 KB single-file (+5 KB over tick-005 — adds the 3 store
  actions + the DataManagementPanel component + 3 Lucide icons)
- gzip: 143 KB

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `a18465c00770b664afe75ad32dcc428e` |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| tool-executor.service | active (running) |
| sentinel.service | active (running) |
| atelier-static.service | active (running, restarted this tick) |
| mythos-gate-atelier.service | active (running) |
| cloudflared.service | active (running) |
| IndexedDB round-trip | export → clear → import → refresh verified |
| AuditPill auto-escalate (tick-005) | wiring still intact (no regression) |

## Open issues carried forward

From HANDOFF-005 plus new this tick:

| # | What | Effort |
|---|---|---|
| 7 | Catch tool-error responses (422 etc) and prepend a system hint to next round so the model retries with corrected args | S |
| 8 | Route tool-needing prompts to nandai-tool (faster, BFCL 91.4%) via LiteLLM pre-hook | M |
| 9 | AuditPill re-fetch on tab refocus so long-running tabs see verdicts that landed while backgrounded | S |
| 10 | Extend sentinel to also judge Opus replies for fabrication | M |
| 11 | Storage cap + LRU eviction once we cross ~500 convs / 50 MB | S |
| 13 | Cross-tab IDB sync via `BroadcastChannel('nandai-chat:sync')` | M |
| 14 | Handle `suggested_action: rerun_with_tools` — pull tool list, re-fire prompt with `tool_choice: 'required'`, surface result | M |
| 15 | Telemetry counter for sentinel-auto-escalations vs manual ones | S |
| 16 | Bring real escape brain online (Opus via Anthropic API budget OR DeepSeek-V4-Flash on .213) — needed for auto-escalate to land actual replies | M |
| 17 | **NEW**: schema-v2 migration path — `importChats` currently accepts v1 only; add a `from` field per conv that flags which app/version it came from, so future format bumps stay backwards-compat | S |
| 18 | **NEW**: progress bar for big imports (>50 convs) — the synchronous `saveManyConversations` blocks the main thread for ~200 ms on a 500-conv payload | S |
| 19 | **NEW**: confirm-by-typing instead of `window.confirm` for Clear All — current native dialog is unstyled and skippable by users with browser dialogs disabled | S |

## Recommended next-tick first action

**Issue #9 — AuditPill refocus refetch.** Tiny scope (~10 LOC), real
value: a tab left open for hours that gets backgrounded won't pick
up the sentinel verdict that landed while it was hidden, because
the 3-attempt poll already gave up. Add a `visibilitychange`
listener; when the tab regains focus AND the pill still has no
verdict, fire one more `fetchSentinelVerdict` call. Clean,
self-contained, no infrastructure dependencies.

Backup if blocked: issue #15 (telemetry counter for sentinel
auto-escalations). Same scale, gives Karan a number to track tuning
the sentinel against.

Tick wall time: ~33 min. Bundle iterations: 1 (clean first build,
clean first deploy). No incidents.

*— end handoff-006*
