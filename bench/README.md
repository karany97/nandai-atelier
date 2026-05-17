# Destiny Atelier — bench harness

> *Reproducibility commitment*: every number we publish about Destiny
> Atelier traces to a `bench/<name>/` directory in this repo with the
> exact harness, exact prompts, exact model versions, raw output JSON,
> and a one-command re-run. No paper-quoted figures presented as our
> own. Per the no-cheating rule (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

This folder is the skeleton. As benches land, each subdirectory fills
in with real fixtures.

## Status

| Bench | Why it matters | Status | Owner |
|---|---|---|---|
| [BFCL v3](https://gorilla.cs.berkeley.edu/leaderboard) | Tool-call quality — the ToolACE-2-8B score everyone cites is from the paper, NOT our run. We need our own. | 📋 Harness scaffolded; needs GPU window on our dual-3090 box | TBD |
| [GAIA L1 + L2](https://huggingface.co/spaces/gaia-benchmark/leaderboard) | General Assistant — does the Trinity beat single-model baselines? | 📋 Harness scaffolded | TBD |
| [SWE-bench Verified Lite](https://www.swebench.com) | Real engineering tasks — can Trinity + Opus escape match Cursor / Cline / Aider on a public bench? | 📋 Harness scaffolded | TBD |
| [τ²-bench (tool-use)](https://github.com/sierra-research/tau2-bench) | Multi-turn tool agent — the hardest current tool bench. Anthropic / OpenAI lead today. | 📋 Harness scaffolded | TBD |
| Speedup (dual-3090) | Self-MoA vs single brain on real prompts | 📋 Awaiting maintenance window | TBD |

✅ shipped · 🚧 in flight · 📋 scaffolded · 💭 considering

## How to read a bench directory

```
bench/<name>/
├── README.md              what the bench measures, version pinned
├── harness/               the runner (Python, shell, or TypeScript)
├── prompts/               exact prompts used (deterministic seed)
├── models.lock            exact model SHA / quantization / serving stack
├── runs/                  raw output JSONs, dated by run
│   └── 2026-05-NN-<hostname>.json
├── verdict.md             human-written analysis of the latest run
└── repro.sh               one-command: clone the dependencies + run the bench
```

## Why we ship the harness, not just the number

Numbers without a harness are folklore. The Trinity scoring 91.4% on BFCL v1
would be a marketing claim. The harness ships → anyone clones → runs →
gets the same number → trusts the next one we publish. Reproducibility
is the most expensive form of credibility.

This is the same discipline as the build journal at `journal/`: every
HANDOFF tick says *what was attempted, what changed, how it was
verified*. Bench `runs/` are the published version of that pattern.

## Discipline

- **Pin everything.** Model SHA, quantization, serving stack version,
  GPU driver, CUDA version, container image — `models.lock` is the
  reproducibility contract.
- **Same seed.** All deterministic runs use the same seed across
  baselines + experiments. Document the seed in `harness/`.
- **Quote the upstream.** When citing a number from a paper (e.g.
  ToolACE-2 BFCL v1 91.4%), the citation is the paper URL, not our
  README. Our README cites OUR run only.
- **Publish the failures.** If a run fails or produces a worse number
  than the paper, the failure JSON ships next to the success JSON.
  The audit trail is the value.

## Adding a new bench

See [`CONTRIBUTING.md`](../CONTRIBUTING.md). Short version:

1. Make a directory: `bench/<name>/`
2. Drop the harness, prompts, models.lock, repro.sh
3. Run it on your hardware, commit the run JSON
4. Update the status table in this file

PR review checks: does `repro.sh` actually run on a fresh clone? Does
the JSON shape match the schema other benches use? Is the verdict.md
honest about what didn't work?
