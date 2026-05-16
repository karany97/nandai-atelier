# Berserker tick-018 handoff — 15:34 UTC
### Clear All now requires typing "clear all" — defended against Chrome dialog suppression

## Shipped

One file, ~60 LOC: `src/components/SettingsDrawer.tsx`.

### The problem

`window.confirm("Permanently delete all N conversations?")` is suppressible. Chrome (and Firefox) show a checkbox "Prevent this page from creating additional dialogs" after the second prompt — once ticked, every subsequent `confirm()` returns `false` silently. From the operator's perspective the Clear All button does nothing; from the code's perspective, the destructive operation just got cancelled. Either way: a real risk of confusion AND of an undefended destructive button if the operator unticks the wrong dialog.

### The fix

`window.confirm` replaced with an inline confirm panel inside `DataManagementPanel`:

```tsx
{clearArmed && (
  <div className="border-red-500/30 bg-red-500/5 p-3 space-y-2">
    <div>This will permanently delete <span className="font-mono">{N}</span> conversation(s)
        ... Type <span className="font-mono">clear all</span> below to confirm.</div>
    <input autoFocus value={clearInput} onChange={...}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && clearReady) onClearAllConfirm();
        if (e.key === 'Escape') onClearAllCancel();
      }}
      placeholder="clear all"
      aria-label="Type 'clear all' to confirm destructive action" />
    <div className="flex gap-2">
      <button disabled={!clearReady} onClick={onClearAllConfirm}>Confirm permanent delete</button>
      <button onClick={onClearAllCancel}>Cancel</button>
    </div>
  </div>
)}
```

`clearReady = clearInput.trim().toLowerCase() === 'clear all'`. Case-insensitive
so the operator doesn't have to fight caps-lock; whitespace-insensitive on
the edges so accidental shift-clicks aren't fatal; but otherwise exact —
"delete all", "destroy", "clear" are all rejected.

State lives in the parent component (`clearArmed` boolean + `clearInput`
string). Cancel/confirm both reset both. Click outside the panel just leaves it
open — the operator has to explicitly Cancel or finish typing. The input is
`autoFocus` so the operator can start typing immediately.

Keyboard ergonomics: Enter confirms when ready, Escape cancels — matches
the operator's intuition without surfacing a separate keyboard shortcut.

The pinned count is surfaced in the warning text so the operator knows
exactly what they're losing: "This will permanently delete 4 conversations
from this browser (including 1 pinned)." LRU eviction doesn't touch pinned
but Clear All does — so the explicit count is important.

## End-to-end proof

Method: Playwright on `atelier.nandai.org`. Seeded 4 convs (3 unpinned + 1 pinned) for realistic stats.

| Step | Result |
|---|---|
| Open Settings → Data & privacy → Clear All | Inline panel opens; "Confirm permanent delete" button disabled by default |
| Panel text reads | `"This will permanently delete 4 conversations from this browser (including 1 pinned). Cannot be undone. Type clear all below to confirm."` |
| Type "destroy everything" | Button stays disabled |
| Type "CLEAR ALL" (uppercase) | Button enables (case-insensitive as designed) |
| Type "clear all" (exact) | Button enables |
| Click Confirm | IDB drops to 0; status banner reads "Cleared 4"; confirm panel auto-closes |
| **Cancel flow:** seed 1 conv, click Clear All, click Cancel | Panel closes; IDB still has 1 conv (`t18-cancel` present); destruction did not run |

Screenshot: `29_confirm_by_typing_panel.png` (panel open with the warning text + input + two-button row).

## Bundle delta

- MD5: `11a28a89b5563fe84c1f77838d92e8c0` (local & .213 match)
- Size: 537 KB (+2 KB over tick-017 — the inline panel, state + handlers)
- gzip: 146 KB
- Deployed via `deploy-atelier.sh`

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `11a28a89b5563fe84c1f77838d92e8c0` |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| atelier-static.service | active |
| LAN 10.179.1.0/24 → .213 | STILL DOWN (12th tick — chronic) |
| Tailscale `infra-host` | online |
| All tick-004..017 features | intact, no regression |

## Open issues carried forward

From HANDOFF-017 minus #19 (now closed):

| # | What | Effort |
|---|---|---|
| 8 | Route tool-needing prompts to nandai-tool via LiteLLM pre-hook | M |
| 10 | Extend sentinel to also judge Opus replies | M |
| 16 | Bring real escape brain online | M |
| 17 | Import schema-v2 migration path | S |
| 18 | Progress bar for big imports | S |
| 23 | Telemetry CSV export | S |
| 24 | LAN .213 unreachable (12+ hours) | M |
| 25 | Telemetry for tool-error retry recovery rate | S |
| 26 | Surface retry hint visually in tool-call card | S |
| 27 | Success-rate for rerun-with-tools | S |
| 28 | Cooldown across reruns | S |
| 29 | Real bytes-used estimate in storage stats | S |
| 30 | "Export then clear" combo button | S |
| 31 | `build-and-deploy-atelier.sh` companion | S |
| 32 | Cross-tab sync for settings/connection changes | S |
| 33 | Per-tab presence indicator | M |
| 36 | **NEW**: confirm-by-typing also for `deleteConversation` (the per-conv trash icon currently deletes silently on click). Same panel pattern, parameterized by conv title. Currently a single mis-click can delete a long conversation with no undo. | S |

## Recommended next-tick first action

**Issue #23 — telemetry CSV export.** Small, finishes the
TrinityDashboard escalation-metrics row. Add a "Download CSV" button
next to the existing reset button; CSV has one row per metric with
columns `metric, count, since_iso`. ~25 LOC. Lets Karan track
escalation trends in a spreadsheet without copy-pasting numbers.

Backup if blocked: issue #36 (extend confirm-by-typing to per-conv
delete) — same pattern as this tick, parameterized by title. ~20 LOC.

Tick wall time: ~22 min. Bundle iterations: 1 (clean first build).
Verification covered: disabled-default, wrong-input-disabled,
case-insensitive-correct, click-confirm-clears, cancel-preserves.
Enter/Escape keyboard paths source-reviewed in onKeyDown handler.

*— end handoff-018*
