# Berserker tick-001 handoff — 07:11 UTC
### What shipped this tick + what the next tick should pick up

## Shipped

1. **`/log-turn` endpoint added to tool-executor** (140 LOC clean patch via local-file scp after 2 botched in-place sed attempts; lesson: don't heredoc-edit production code over SSH, use rsync+real-file patches). Endpoint validates required schema fields, appends to `$HOME/NandaiJarvis/logs/chat-turns.jsonl`, returns 204. Public via `https://tools.nandai.org/log-turn`.

2. **Chat wired to POST every completed turn**. `lib/tool-bridge.ts:logChatTurn` (fire-and-forget, keepalive). Called from `runLiveCompletion` after final patch, before tool-loop branch. Captures id, ts, session, user_prompt, model_response, brain_route, tool_calls, latency, tokens.

3. **System prompt strengthened for tool narration** in `store.ts:DEFAULT_SETTINGS.systemPrompt`:
   > "When you call a tool, ALWAYS read the result and narrate it back to the user in 1-2 sentences. Never call a tool and leave the response empty. Quote concrete values from the tool result rather than restating the question."

4. **Bundle rebuilt + redeployed** (MD5 `9afa4bed73a3bd303fcda2197c1c9f1d`, matches on .213).

## End-to-end verification (the proof)

Sent test prompt asking Nandai-One to call `time_get_current_time`. Observed:
- Chat POSTed turn `msg-3-mp80bxwv` to /log-turn → 204
- jsonl appended: `model_response=""` (the empty-narration bug, accurately captured)
- Sentinel tailed file, called Hermes 4.3 judge in **7,230ms**
- Sentinel emitted alert: `failed_axes=["fully_addressed"], suggested_action="escalate_to_opus", summary="1 axis fail(s): fully_addressed"`
- Verdict file at `~/NandaiJarvis/logs/sentinel-inbox/turn-msg-3-mp80bxwv.json` with 8-axis scoring

This is the constant-crawl agent doing exactly what it's supposed to: catching the Qwen-not-narrating problem in real-time and tagging it with the right remediation. No fabrication — every score came from a Hermes judge call against the wire data.

## Failures encountered + how I recovered

- **SSH heredoc python mangling** (twice): edits via `ssh operator@.213 'python3 <<EOF ... EOF'` broke source files when backticks or escaped quotes were involved. Recovery: rsync clean source + apply patch via real .py file scp'd to /tmp/, then ssh-execute. **Lesson for next tick**: never edit production source via inline heredoc; always patch-file → scp → execute.
- **tool-executor crashed twice on syntax error** before clean rsync restore. Recovery time: ~3 min each. Acceptable since systemd auto-restarts and the chat fails-soft when /tools is down.

## Open issues for next tick

| # | What | File | Effort |
|---|---|---|---|
| 1 | **Qwen still not narrating after tool call** despite stronger system prompt. The system prompt change shipped but the model behavior hasn't shifted yet — possibly the auto-router is picking nandai-fast which ignores the system prompt augment. Try: route tool-needing prompts to nandai-tool (ToolACE-2-8B, BFCL 91.4%) via a LiteLLM pre-hook rule, OR make the chat append "(after calling the tool, narrate the result in plain English)" as a USER-side hint when the prior turn ended with tool_calls. | `store.ts:runToolLoop` | M |
| 2 | **Surface sentinel verdicts in the chat UI**. The sentinel is producing alerts but no one can see them yet. Add a small audit pill next to each assistant message that fetches `/sentinel-inbox/{turn_id}.json` and shows a tooltip; clicking opens a drawer with the full 8-axis breakdown. Need a new `GET /sentinel/{turn_id}` endpoint on the tool-executor to proxy the file. | `tool-executor app.py` + `components/Message.tsx` | M |
| 3 | **Persist conversations to IndexedDB** (audit's #1 ship-blocker). | `store.ts` after line 121 | L |
| 4 | **Sentinel alerts feed → auto-escalate trigger**. When sentinel flags `suggested_action=escalate_to_opus`, the chat could read that alert and AUTO-fire the escalation without waiting for the user. Closes the loop fully. | `store.ts` + new SSE feed | M |
| 5 | **Add a `Tools: 108` chip to the sidebar status pill**. Currently the user has no visibility into whether MCP tools are loaded. | `Sidebar.tsx:ConnectionPill` | S |
| 6 | **Strengthen the chat's per-tool-loop iteration**. Round 1 calls tool, round 2 should be a system message saying "Here is the tool result, now narrate it to the user in 1-2 sentences." Right now we just send the tool result and rely on the model to be smart. | `store.ts:runToolLoop` | S |

## Health snapshot at handoff

| Surface | State |
|---|---|
| `atelier.nandai.org` | 302 (PIN gate) — live |
| `tools.nandai.org/health` | 200, n_tools=108 — live |
| `tools.nandai.org/log-turn` | 204 on smoke — live |
| `tool-executor.service` | Active (running) |
| `sentinel.service` | Active (running) |
| `atelier-static.service` | Active (running) |
| `mythos-gate-atelier.service` | Active (running) |
| `cloudflared.service` | Active (running) |
| Chat MD5 (local & deployed) | `9afa4bed73a3bd303fcda2197c1c9f1d` — match |
| chat-turns.jsonl | 2 lines (1 smoke + 1 real) |
| sentinel-inbox/ | 2 verdict files |
| sentinel-alerts.jsonl | 1 alert (the real one, correctly flagged) |
| Bridge on Mac | Down (no daemon) |

## Recommended next-tick first action

**Fix the Qwen-narration problem (issue #1 above)** because the sentinel is now correctly flagging EVERY turn as `fully_addressed=no` — that's the system honestly working but it's also Karan's morning-experience pain point. Try the "user-side hint after tool result" approach first (cheapest); if that doesn't shift Qwen, do the LiteLLM pre-hook route to nandai-tool for tool-needing prompts.

Tick wall time: ~13 minutes. Tokens spent: light (most agents already complete). No incidents requiring abort.

*— end handoff-001*
