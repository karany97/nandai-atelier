# GAIA — General AI Assistants Benchmark

[Leaderboard](https://huggingface.co/spaces/gaia-benchmark/leaderboard) ·
[Paper (arXiv 2311.12983)](https://arxiv.org/abs/2311.12983) ·
[Dataset (HuggingFace)](https://huggingface.co/datasets/gaia-benchmark/GAIA)

## What it measures

GAIA tests an AI assistant's ability to **answer real-world questions that
require multi-step reasoning, web search, and tool use**. Questions are
designed so a human researcher can answer them in a few minutes, but the
assistant must coordinate browsing, file handling, and reasoning to get
there.

Three difficulty levels:
- **L1** — single step, single tool (e.g. *"What's the population of
  Tokyo in 2024?"*)
- **L2** — multi-step, multi-tool (e.g. *"Compare the 2023 GDP of
  Brazil and India, then estimate which will overtake the other by
  2030 at current growth rates"*)
- **L3** — long-horizon, complex tool chains (deferred for our v1 run)

Our target: **L1 + L2** for the Destiny Atelier launch number. L3
deferred to a follow-up run.

## Why this is a Destiny Atelier wedge

GAIA stresses the exact combination Destiny Atelier was designed for:

| Capability | Destiny Atelier asset |
|---|---|
| Web search | 108 MCP tools include `duckduckgo`, `fetch`, `firecrawl` |
| File handling | `filesystem` MCP server |
| Multi-step reasoning | Self-MoA on `nandai-think` (Hermes 4.3-36B, 512K native ctx) |
| Tool-call quality | `nandai-tool` (ToolACE-2-8B, 91.4% BFCL v1 per paper) |
| Reflection / verification | 8-axis Sentinel post-turn audit |
| Opus escape on uncertainty | Claude Code bridge for the hardest 3–5% |

The published GAIA leaderboard is dominated by Anthropic Claude (with
tool-use) and GPT-4-class models. **No local-only stack has posted a
competitive number as of May 2026.** That gap is the wedge.

## Status

📋 **Scaffolded.** The harness, prompts, models.lock, and repro.sh are
all stubbed. The first real run is blocked on:

- [ ] GAIA dataset download (HuggingFace, requires accepting the GAIA terms)
- [ ] MCP tool surface verified (the chat needs to actually call
      `duckduckgo`, `firecrawl`, `fetch` reliably during the bench)
- [ ] Bench harness wired to atelier's `/api/llm` endpoint (so it runs
      against the real Trinity, not a mocked LLM)
- [ ] A quiet 90-minute window on Titan .50 (the bench shells out to the
      live brains; concurrent live chat would interfere)

## Recipe (when ready)

```bash
# 1. Pull the dataset
huggingface-cli login   # accept GAIA terms first
python harness/download_gaia.py --level 1 --level 2 --out prompts/

# 2. Pin the stack
python harness/snapshot_models.py > models.lock

# 3. Run
bash repro.sh

# 4. Inspect
jq '.summary' runs/$(date +%F)-$(hostname).json
```

Expected runtime: ~60 min for L1+L2 on the dual-3090 setup with the
Trinity warm.

## Verdict template

Each run drops `runs/<date>-<hostname>.json` and a human-written
`verdict.md` (overwritten each run, with the previous version kept in
git history).

```
# Verdict — <date>

- Level: L1+L2
- Pass rate: <N>/<total> (<pct>%)
- p50 latency per question: <ms>
- p95 latency per question: <ms>
- Total wall-clock: <hh:mm>
- Tool calls: <count>
- Opus escapes: <count> (cost: $<n>)
- Sentinel auto-recoveries: <count>

Top 5 failures:
1. <Q>: model said X, ground truth Y. Failure mode: <hallucination | tool-call | refusal | other>
   ...

Top 3 wins (worth highlighting):
1. <Q>: required <3-tool chain>; correct answer at <time>
   ...

Next steps:
- ...
```

## Reproducibility contract

- Model SHAs pinned in `models.lock`
- Prompts deterministic (seed 42)
- HuggingFace cache populated by `repro.sh` (no implicit downloads
  during the bench)
- No fallback to cloud when tools fail — the bench either succeeds
  with local-only or marks the question failed
