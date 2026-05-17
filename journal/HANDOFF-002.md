# Berserker tick-002 handoff — 07:45 UTC
### Qwen narration fix + sentinel-log timing + 3 chained bug-fixes

## Shipped

**The pipeline is now green end-to-end.** Sentinel grades the latest London-time tool call as ALL 8 AXES CLEAN, 0 alerts, action=none. The chat properly narrates tool results with real values from the wire (no fabrication, no hedging, no escalation false-positive).

Four chained fixes in this tick:

1. **Tools chip in sidebar** — three-line pill now shows: Nandai-One status / Opus bridge status / **Tools: N loaded** with green dot when the executor is ready.

2. **User-side hint in `runToolLoop`** — after pushing tool results back into history, the chat appends a user-role message: *"[Tool results received above. Now answer my original question in 1-2 sentences, quoting concrete values...]"*. Qwen 3.6 pays much more attention to recent user turns than to the rolling system prompt, so this is the cheapest fix that actually shifts behavior. London-time test confirmed: model output `"It is currently 08:44:42 in London (timezone Europe/London) on Saturday, May 16, 2026, with daylight saving time active (+01:00)."` — 5/5 values lifted directly from the tool result.

3. **Client-side fallback narration** — if the model still emits no text after a successful tool, the chat now renders `_(model ran the tool but did not narrate — surfacing the result verbatim)_` followed by the tool result inline. Never invents; only renders what mcpo returned. Tagged so the operator can tell apart from real model output.

4. **Auto-escalate gate** — `hasSuccessfulToolResult` check prevents spurious "Opus bridge is offline" fallback when the tool DID succeed and the model DID narrate. Was overwriting good narration with the bridge-offline note because the auto-escalate's else branch used round-1 `ex.body` instead of post-loop `getCurrentText`. Fixed both: gate plus the body-source. Net effect: tool-narrating turns now display the narration, not the bridge note.

5. **Sentinel log timing** — moved `logChatTurn` call from BEFORE `runToolLoop` to AFTER. Previously logged the empty round-1 response → sentinel kept flagging fully_addressed=no even when round-2 narration was clean. Now captures the post-loop final text the user actually sees.

## End-to-end proof

Prompt: "What time is it in London right now? Use the time_get_current_time tool with timezone Europe/London."

| Stage | Outcome |
|---|---|
| Chat dispatched 108 tools + prompt | 5,047 prompt tokens (full tools array) |
| Brain trace | nandai-fast emitted `tool_call` (finish_reason='tool_calls') |
| Tool executor → mcpo → time MCP | 200 in 5ms, returned ISO `2026-05-16T08:44:42+01:00`, dst=true |
| runToolLoop round-2 | model received tool result + user hint, narrated in plain English |
| Chat display | "It is currently 08:44:42 in London (timezone Europe/London) on Saturday, May 16, 2026, with daylight saving time active (+01:00)." |
| Sentinel verdict | 8 axes all clean, action=none, 0 alerts |

Screenshot: `15_tool_narrated.png` (saved in this folder).

## Bundle delta

- MD5: `55321439fa8a16bb873b0e78871dc531` (local & infra-host match)
- Size: 511,196 bytes (≈ +119 bytes net over tick-001 — adds the sidebar tools chip + the auto-escalate gate + the log relocate)
- Public surfaces unchanged: `atelier.nandai.org` 302→PIN, `tools.nandai.org/health` 200.

## Open issues carried forward

Still from HANDOFF-001's list, untouched this tick:
- #2: Surface sentinel verdicts in the chat UI (audit pill per message + drawer). Would let Karan inspect any flag at a glance.
- #3: Persist conversations to IndexedDB (the audit's #1 ship-blocker).
- #4: Wire sentinel alerts → auto-escalate (close the loop fully).
- #6: System message between rounds in runToolLoop (small UX polish).

New from this tick:
- #7: The Sydney test used wrong timezone format (`Sydney` not `Australia/Sydney`) and the tool returned 422; the model narrated the failure honestly. Worth adding a one-shot example in the system prompt showing how to format IANA timezones — or smarter: catch 422 errors from the tool and prepend a hint to the model's next round.
- #8: Latency on tool-using turns is now ~45 s wall clock end-to-end (vs ~4s for direct chat). Mostly model inference for round-2 narration. Hermes 4.3-36B on llama.cpp is the bottleneck. Possible win: route tool-needing prompts to nandai-tool (ToolACE-2-8B at .213:8055), which is purpose-built for tool calls and likely faster.

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `55321439fa8a16bb873b0e78871dc531` |
| atelier.nandai.org | 302 → PIN |
| tools.nandai.org/health | 200, n_tools=108 |
| tools.nandai.org/log-turn | 204 on smoke |
| tool-executor.service | active (running) |
| sentinel.service | active (running) |
| sentinel-inbox/ | 4 verdict files (1 smoke + 3 real) |
| sentinel-alerts.jsonl | 2 alerts (from pre-fix turns) + 0 fresh alerts post-fix |
| chat-turns.jsonl | 4 lines |
| Bridge on Mac | Down (no daemon) |
| Berserker loop | Armed for next tick at ~00:38 PST |

## Recommended next-tick first action

**Issue #2 — surface sentinel verdicts in the chat UI.** Concrete: add a `GET /sentinel/{turn_id}` endpoint to tool-executor that reads `~/NandaiJarvis/logs/sentinel-inbox/turn-{id}.json` and returns it; add a small audit pill next to each assistant message that fetches it on demand and shows a tooltip; clicking opens a drawer with the 8-axis breakdown.

That gives Karan a visible "honesty meter" for every reply — closes the observability loop that the constant-crawl agent is designed to enable.

Backup if that's slow: Issue #3, IndexedDB persistence. ~80 LOC in store.ts; the killer audit gap.

Tick wall time: ~30 min (mostly the 4 build/deploy/test cycles to chase the chained bugs). Tokens spent: light. No incidents requiring abort.

*— end handoff-002*
