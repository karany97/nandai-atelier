# SWE-bench Verified Lite

[Leaderboard](https://www.swebench.com) ·
[Paper (arXiv 2310.06770)](https://arxiv.org/abs/2310.06770) ·
[Dataset (Princeton-NLP)](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified)

## What it measures

SWE-bench tests an AI's ability to **resolve real GitHub issues from
real Python repositories**. Each task gives the model:
- A repository at a specific SHA
- An issue text (the bug report)
- A test suite (failing on the buggy code)

The model must produce a patch that makes the failing tests pass
without breaking any other test. **Verified** is the human-validated
subset (~500 issues from the original 2,294). **Verified Lite** is
the 100-issue subset that fits in a manageable bench budget.

Today's leaders on SWE-bench Verified:
- Cursor + GPT-5 family
- Cline + Claude Opus 4.7
- Aider + various
- Anthropic Claude Code (the official cloud agent)

Local-only stacks (Continue, Cline-with-local-model, Aider-with-Ollama)
trail by ~20 percentage points. **The wedge: can Destiny Atelier's
Trinity + Opus-escape match the cloud agents while running 95% of
tokens locally?**

## Why this is a wedge for us

The interesting bet is the Opus-escape pattern:

1. Local Trinity (nandai-fast + nandai-think + nandai-tool) takes a
   first pass on every issue — most of the 100 issues are tractable
   for a 27/36/8B ensemble.
2. Sentinel grades the local solution before it's submitted as the
   final patch.
3. If Sentinel says "uncertain" (or the test suite fails on the local
   patch), escalate THAT issue's full context to Opus 4.7 via the
   Claude Code bridge.
4. Opus produces the final patch only for the issues where local
   failed.

If this pattern hits >40% on Verified Lite while burning <10% Opus
tokens vs Cline-with-Opus, we have a believable "local-first SWE
agent" story that nobody else can tell (because no other stack has
both local Trinity + cookie-authenticated Opus escape).

## Status

📋 **Scaffolded.** The harness, prompts, models.lock, repro.sh are
stubbed. Blockers for first real run:

- [ ] Dataset download (`princeton-nlp/SWE-bench_Verified`)
- [ ] Docker harness for the per-task isolated environments (each
      SWE-bench task runs in its own container with the repo + Python
      version pinned)
- [ ] Atelier wired to act as the agent driver (composer auto-submits,
      Sentinel verdict reads, escalation triggers)
- [ ] Anthropic Opus key + budget cap configured (the worst-case is
      escaping 100 issues at ~50K tokens each = ~5M tokens = ~$75 on
      Opus 4.7; budget alert at $25)

## Recipe (when ready)

```bash
# 1. Dataset
huggingface-cli download princeton-nlp/SWE-bench_Verified --repo-type dataset \
  --local-dir prompts/raw

python harness/select_lite.py --in prompts/raw --out prompts/lite-100.json

# 2. Pin
python harness/snapshot_models.py > models.lock

# 3. Run (Trinity-first, Opus on Sentinel uncertain)
bash repro.sh --mode trinity-first --escape-on uncertain --budget-usd 25

# 4. Score
python harness/score.py runs/$(date +%F)-trinity-first.json
```

Expected runtime: ~3–6 hours for 100 issues on the dual-3090, varying
heavily by how many escape to Opus.

## Verdict template

```
# Verdict — <date>, mode <trinity-first|trinity-only|opus-only|...>

Pass rate: <N>/100 (<pct>%)
SOTA reference: Cline+Opus 4.7 = 71% on Verified Lite (per <URL>)
Our deviation: <±N> percentage points

Token economics:
- Total local tokens: <count> (cost: $0)
- Total Opus tokens:  <count> (cost: $<n>)
- Escape rate: <count>/100 issues

Top failure modes:
1. <category>: <count> issues
2. ...

Per-issue trace: runs/<date>-trinity-first.json
```

## Honest framing

We will publish this number when we have it — not before. If we
underperform Cline+Opus by >15 percentage points, we say so and
explain why. The build journal pattern doesn't change for benches:
verify, then claim. Never the reverse.
