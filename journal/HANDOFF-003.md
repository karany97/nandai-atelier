# Berserker tick-003 handoff — 08:14 UTC
### Sentinel verdicts now visible per-message in the chat UI

## Shipped

Three pieces wired in one tick:

1. **`GET /sentinel/{turn_id}` endpoint** on tool-executor (`.213:8767`). Reads `~/NandaiJarvis/logs/sentinel-inbox/turn-{id}.json`, returns the full 8-axis verdict object, 404 when the sentinel hasn't judged yet. Path-traversal guard rejects `/` or `..` in the turn id.

2. **`AuditPill` React component** (`src/components/AuditPill.tsx`, 95 LOC). On mount, polls `/sentinel/{msg.id}` at t=8s, t=20s, t=45s; gives up silently after the third attempt. Once the verdict lands, renders a small badge: `🛡️ audit · clean` (emerald), `🛡️ audit · 1 flag` (amber), `🛡️ audit · 2 flags` (red). Click expands a 340px drawer showing all 8 axes with verdict color-coding + why-strings + the judge attribution.

3. **`fetchSentinelVerdict` helper** in `lib/tool-bridge.ts` — typed wrapper around the endpoint, handles 404 cleanly.

## End-to-end proof

Prompt: "What time is it in Paris right now? Use the time_get_current_time tool with timezone Europe/Paris."

| Stage | Outcome |
|---|---|
| Model reply | "It is currently 10:13:42 AM on Saturday, May 16, 2026, in Paris (UTC+02:00), with daylight saving time currently in effect." |
| Sentinel verdict | All 8 axes: clean (every axis returned green) |
| AuditPill on chat header | Renders as `🛡️ audit · clean` next to the brain badge |
| Click expansion | 8-axis breakdown: `anomalous_latency:no · brain_route_match:yes · fabricated:no · fully_addressed:yes · known_bad_pattern:no · refusal_hedge:no · tool_error_ignored:no · unusually_short:no` |
| Judge attribution | "Judge: nandai-think · Hermes 4.3-36B · local · $0" |
| Sidebar pill | All three lines green: Nandai-One online / Opus bridge: down / Tools: 108 loaded |

Screenshot: `16_audit_pill_open.png` shows the full drawer in context.

## What this completes

The constant-crawl loop the user asked for in their last session ("contantly crawl the chat and see if we miss anything") is now a **fully closed visibility loop**:

1. Chat completes a turn → POSTs to `/log-turn`
2. Sentinel daemon (Hermes 4.3-36B) tail-watches the jsonl, judges the turn on 8 axes within 5-12 seconds
3. Verdict lands in `~/NandaiJarvis/logs/sentinel-inbox/turn-{id}.json`
4. Chat's AuditPill polls `/sentinel/{id}`, surfaces the result inline
5. Operator can see at a glance whether the system caught any issue with that turn

That's the observability promise delivered. No fabrication, no theater — every score traces back to a real Hermes judgment call against real wire data, viewable per-message.

## Bundle delta

- MD5: `ceef7fcb87801156a61eeb9eafe182c2` (local & infra-host match)
- Size: 515 KB single-file (+4 KB over tick-002 — adds the AuditPill component + the fetch helper + the import in Message)
- gzip 141 KB

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `ceef7fcb87801156a61eeb9eafe182c2` |
| atelier.nandai.org | 302 → PIN |
| tools.nandai.org/health | 200, n_tools=108 |
| tools.nandai.org/sentinel/{id} | 200 (existing) / 404 (unjudged) |
| tools.nandai.org/log-turn | 204 on smoke |
| tool-executor.service | active (running, since 08:12 UTC after this tick's restart) |
| sentinel.service | active (running) |
| atelier-static.service | active (running) |
| mythos-gate-atelier.service | active (running) |
| cloudflared.service | active (running) |
| sentinel-inbox/ | 7 verdict files (4 clean + 3 with flags) |
| chat-turns.jsonl | 7 lines |
| sentinel-alerts.jsonl | 4 alerts (all pre-tick-002 era; nothing flagged after the narration fix) |

## Open issues carried forward

From HANDOFF-002 + new this tick:

| # | What | Effort |
|---|---|---|
| 3 | **Persist conversations to IndexedDB** (audit's #1 ship-blocker) | L |
| 4 | Sentinel alert → auto-escalate auto-trigger when `suggested_action=escalate_to_opus` | M |
| 7 | Catch tool-error responses (422 etc) and prepend a system hint to next round so the model retries with corrected args | S |
| 8 | Route tool-needing prompts to nandai-tool (faster, BFCL 91.4%) via LiteLLM pre-hook | M |
| 9 | **NEW**: AuditPill polls 3 times then gives up — should also re-fetch on chat tab refocus so a long-running tab eventually sees verdicts that landed while it was backgrounded | S |
| 10 | **NEW**: Pill currently only shows for `brain === 'nandai'` (Opus turns are out of scope for the sentinel). Could extend the sentinel to also judge Opus replies for fabrication, since Opus does hallucinate too sometimes | M |

## Recommended next-tick first action

**Issue #3 — persist conversations to IndexedDB.** This is the audit's #1 ship-blocker and the single most damaging defect ("refresh wipes all work"). Once shipped, the chat goes from "demo prototype" to "actual persistent product". The IndexedDB diff is ~80 LOC in `store.ts`: open a database on bootstrap, save on every `pushMessage`/`patchAssistant`, load on `bootstrap()` before the SCRIPTED_CONVOS fallback.

Backup if blocked: Issue #4 (auto-trigger escalate-on-sentinel-alert). That closes the recommendation loop — when the constant-crawl agent says "rerun_with_tools", the chat actually reruns.

Tick wall time: ~28 min. Bundle iterations: 1 (clean shot, no syntax errors this time — learned from tick-001's heredoc disasters). No incidents.

*— end handoff-003*
