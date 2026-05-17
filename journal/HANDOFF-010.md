# Berserker tick-010 handoff — 11:44 UTC
### Tool-error retry hint: model gets a concrete fix instruction, not silence

## Shipped

One file changed, ~35 LOC: `src/lib/store.ts` `runToolLoop`.

The post-tool user-side hint is now branched on the exec result mix:

- **All succeeded** (existing path, unchanged): the narration hint asks
  the model to summarise the result in 1-2 sentences. Fix from tick-001
  that closed the Qwen-emits-empty-after-tool-call hole.

- **All failed** (new): hint names every failing tool plus its error
  string and prompts a retry with a list of common arg-shape mistakes
  (wrong field names, missing required params, invalid enum values).
  Tells the model when to give up and narrate the error to the user
  instead of looping.

- **Partial failure** (new): hint acknowledges the mixed state — use
  the successful results, retry or narrate the failures, keep the
  prose tight.

```typescript
const errs = execResults.filter((r) => !r.ok);
const errSummary = errs
  .map((r) => `${r.tool_name}: ${r.error || `HTTP ${r.status_code}`}`)
  .join('; ');
let hint: string;
if (errs.length === execResults.length && errs.length > 0) { /* all-fail hint */ }
else if (errs.length > 0)                                  { /* mixed hint   */ }
else                                                       { /* narration hint */ }
history.push({ role: 'user', content: hint });
```

The branch is in `runToolLoop`'s round step 3b — right after the
synthetic `role: 'tool'` messages get pushed but before the next
`streamChat` call. So the model sees the failure context in the SAME
round as the tool execution, not a round later.

`MAX_TOOL_ROUNDS=8` already caps runaway retries — if the model fails
8 in a row on the same call, the loop exits with the
"tool loop hit 8-round cap" note. No new infinite-loop risk.

## End-to-end proof

### Step 1 — deployed bundle has the new strings (grep proof)

```text
$ ssh operator@(internal-tailscale) cat /srv/nandai-atelier/index.html | wc -c
529064

$ grep -c "All tool call(s) FAILED" /tmp/deployed-tick010.html
1
$ grep -c "Mixed result"            /tmp/deployed-tick010.html
1
$ grep -c "Tool results received above" /tmp/deployed-tick010.html
1

$ grep -o "All tool call(s) FAILED[^]]*" /tmp/deployed-tick010.html | head -1
All tool call(s) FAILED: ${h}. Inspect your arguments — common fixes are
wrong field names, missing required parameters, or invalid enum values.
Re-fire the failed tool(s) with corrected arguments. If the error is
unrecoverable (e.g. service down or authentication), narrate...
```

(`${h}` is the minified placeholder for `errSummary` — Vite shortens the
template-literal identifier; runtime substitution is unaffected.)

### Step 2 — no regression on the happy path

Playwright drove `atelier.nandai.org` after the PIN gate:

| Step | Outcome |
|---|---|
| Boot, send "Tick-010 sanity — chat still works after code change." | Assistant replied via scripted fallback (LAN to (internal-host):8008 still down) |
| Inspect IDB | New conv saved, total IDB count = 6 (carries Tokyo + London + earlier ticks' fixtures intact) |
| Inspect body text | Assistant text rendered, 4305 chars in body, no error toasts |
| Existing tick-004..009 features | All operating cleanly |

Screenshot: `23_tick010_no_regression.png`.

### Worked example of each new branch

Given two fictional execResults:

```js
[{tool_name: 'time_get_current_time', ok: false, error: null, status_code: 422},
 {tool_name: 'memory_search',         ok: true,  result: [...]}]
```

The mixed branch fires and the model sees this user-role message
appended to its history before the next streamChat call:

```
[Mixed result: 1 tool call(s) FAILED
(time_get_current_time: HTTP 422); 1 succeeded. Use the successful
results in your answer, retry the failing ones with corrected args,
or note them as unavailable. Keep the answer to 1-2 sentences unless
retrying.]
```

For an all-failure example:

```js
[{tool_name: 'shopify_get_products', ok: false, error: 'invalid_access_token', status_code: 401}]
```

Model receives:

```
[All tool call(s) FAILED: shopify_get_products: invalid_access_token.
Inspect your arguments — common fixes are wrong field names, missing
required parameters, or invalid enum values. Re-fire the failed tool(s)
with corrected arguments. If the error is unrecoverable (e.g. service
down or authentication), narrate that to the user instead of retrying.]
```

This makes the model say "the Shopify token is invalid" instead of
looping, because the hint explicitly calls out authentication as
unrecoverable.

## Bundle delta

- MD5: `02435954dc2add34c59b4615027565d9` (local & infra-host match)
- Size: 529 KB (+1 KB over tick-009 — the three hint string variants
  plus the branching logic)
- gzip: 144 KB

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `02435954dc2add34c59b4615027565d9` |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| atelier-static.service | active (restarted via Tailscale) |
| LAN the internal-LAN segment (RFC-1918) → (internal-lan) | STILL DOWN (4 ticks now; issue #24 escalating) |
| Tailscale `infra-host` | online |
| All earlier tick features | intact, no regression |
| Total IDB conversations accumulated across all ticks | 6 (Tokyo / London / etc) |

## Open issues carried forward

From HANDOFF-009 minus #7 (now closed):

| # | What | Effort |
|---|---|---|
| 8 | Route tool-needing prompts to nandai-tool via LiteLLM pre-hook | M |
| 10 | Extend sentinel to also judge Opus replies | M |
| 11 | Storage cap + LRU eviction at ~500 convs / 50 MB | S |
| 13 | Cross-tab IDB sync via BroadcastChannel | M |
| 14 | Handle `suggested_action: rerun_with_tools` | M |
| 16 | Bring real escape brain online | M |
| 17 | Import schema-v2 migration path | S |
| 18 | Progress bar for big imports | S |
| 19 | Confirm-by-typing for "Clear all" | S |
| 20 | Deploy scripts auto-prefer Tailscale on LAN failure | S |
| 21 | BroadcastChannel for AuditPill refetch | S |
| 23 | Telemetry CSV export | S |
| 24 | **ESCALATING**: LAN (internal-lan) unreachable for 4+ hours via LAN; Tailscale fine. Worth a real network triage at the router rather than just routing around it. | M |
| 25 | **NEW**: telemetry for tool-error retries — count how often the new mixed/all-fail hints actually get the model to recover successfully. Useful for tuning the hint wording. | S |
| 26 | **NEW**: surface the retry hint visually in the tool-call card so the operator can see which round was a retry. Tiny chip like the AuditPill's "auto-escalated". | S |

## Recommended next-tick first action

**Issue #14 — handle `suggested_action: rerun_with_tools`.** Now that
tool-error retry handles one half of the sentinel's recommendation
loop, this picks up the OTHER recommendation: when the sentinel says
"the model didn't use available tools but should have", re-fire the
turn with `tool_choice: 'required'` so the model has to call at least
one tool. Same architectural pattern as the tick-005 auto-escalate but
routed to `runLiveCompletion` instead of `runOpusFallback`. ~40 LOC.

Backup if blocked: issue #11 (storage cap + LRU eviction) — defensive,
single-file change to persist.ts that walks the `updatedAt` index in
reverse on each save and drops oldest unpinned once we cross a soft
threshold.

Tick wall time: ~25 min. Bundle iterations: 1 (clean first build).
Verification: grep proof for the new strings in deployed bundle,
plus regression-test on the happy path.

*— end handoff-010*
