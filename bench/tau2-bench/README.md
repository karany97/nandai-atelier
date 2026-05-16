# τ²-bench (tau-squared bench) — multi-turn tool agent

[Repo (Sierra Research)](https://github.com/sierra-research/tau2-bench) ·
[Paper](https://arxiv.org/abs/2503.08550) ·
[Original τ-bench](https://arxiv.org/abs/2406.12045)

## What it measures

τ²-bench is the **harder successor to τ-bench**: it tests an AI agent's
ability to complete **multi-turn customer-service-shaped tasks** that
require *tool calls + memory across the conversation + policy compliance*.
The bench includes domains like airline booking, retail returns, and
healthcare scheduling.

The hardness: a single misstep at turn 3 (e.g. confirming a wrong
flight number) cascades and the agent has to recover by turn 7 or fail.
Most current models score under 50% on τ²-airline. Anthropic Claude and
GPT-4-class lead.

## Why this is a Destiny Atelier wedge

τ²-bench is the closest public bench to *Destiny Atelier's actual UX
loop*. Real operators use this chat for multi-turn agentic work — talk
to the chat across 10 turns about a Shopify problem, the chat uses the
`shopify` MCP server, references earlier turns, applies policy ("don't
auto-refund without confirming"), recovers if the API errors out.

What we have that competitors don't:

1. **108-tool MCP middleware** — most local agent stacks have <20 tools
2. **Cross-turn memory** — IndexedDB persistence + Sentinel-flagged
   context surfacing (the chat shows "this came up in tick 4")
3. **Sentinel as policy enforcer** — the operator-cost + tool-correctness
   axes flag policy drift before it cascades
4. **Recovery via Opus escape** — when Sentinel detects "the model is
   confused 3 turns deep", one-click hands the whole transcript to Opus
   to resolve

Targeting **τ²-retail** for the first run (simplest tool surface), then
τ²-airline as a stretch.

## Status

📋 **Scaffolded.** Harness, prompts, models.lock, repro.sh stubbed.
Blockers:

- [ ] τ²-bench repo cloned + Python env set up (it's a CLI tool that
      wraps the prompts + grading)
- [ ] Adapter that lets τ²-bench's CLI talk to atelier's `/api/llm`
      endpoint instead of OpenAI / Anthropic
- [ ] Per-domain MCP tools wired (we'll use the existing
      `nandai-commerce` server as the τ²-retail stand-in)
- [ ] Sentinel rules tweaked to fire on policy-drift signals in this
      domain

## Recipe (when ready)

```bash
# 1. Clone tau2-bench + install
git clone https://github.com/sierra-research/tau2-bench bench/tau2-bench/upstream
pip install -e bench/tau2-bench/upstream

# 2. Adapter (Destiny Atelier as the agent)
python harness/run_against_atelier.py \
  --atelier-url https://atelier.example.com \
  --domain retail \
  --tasks 100 \
  --out runs/$(date +%F)-retail.json

# 3. Score
python harness/score.py runs/$(date +%F)-retail.json
```

Expected runtime: ~2 hours for 100 retail tasks (each is ~5–12 turns).

## Verdict template

```
# Verdict — <date>, domain <retail|airline|healthcare>

Pass rate: <N>/100 (<pct>%)
SOTA reference: <agent> = <pct>% on τ²-<domain> (per <paper URL>)
Median turns to pass: <n>
Median turns to fail: <n>

Policy violations (by axis):
- Refunded without confirmation: <count>
- Booked wrong item: <count>
- Hung up without resolution: <count>

Sentinel auto-recoveries that worked: <count> / <total triggered>
Opus escapes that saved a transcript: <count> / <total triggered>

Per-turn trace: runs/<date>-<domain>.json
```

## Honest framing

τ²-bench is hard. If we land 35% on retail with the local Trinity + Opus
escape, that's a credible local-agent number. If we land 65% we'd
actually be SOTA for local — but we won't claim that until the JSON
trace is committed and reproducible.
