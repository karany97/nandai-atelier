# Verification evidence

This directory holds the evidence files for every PR that lands in
`main`. The discipline (described in
[CONTRIBUTING.md](../../CONTRIBUTING.md)) is that PRs without evidence
get bounced.

## Layout

```
docs/verification/
├── README.md                  ← you are here
├── pr-0001-add-toolbar/
│   ├── screenshot-before.png
│   ├── screenshot-after.png
│   ├── console.txt
│   └── bundle-diff.md
├── pr-0002-fix-stream/
│   ...
└── ...
```

Each PR gets a directory named `pr-NNNN-<short-slug>/` containing at
minimum:

| File | Contents |
|---|---|
| `screenshot-before.png` | The chat surface in the state the PR is changing FROM. Open at `http://localhost:5173`, reproduce the issue, screenshot the relevant area. |
| `screenshot-after.png` | Same view, after your PR is applied. Same window dimensions, same theme. |
| `console.txt` | DevTools console paste from the running chat AFTER your change. Must contain zero errors (warnings are OK but should be mentioned in the PR body). |
| `bundle-diff.md` | Output of `wc -c bundle.html` before and after, plus the gzip size delta from the Vite build log. |

If the change is non-visual (Sentinel rubric weight tweak, persistence
schema migration, etc.), substitute `screenshot-*.png` for a transcript
file showing the relevant behavior (`transcript-before.txt`,
`transcript-after.txt`).

## Why this exists

Because a 537 KB single-file artifact lives or dies by every byte and
every behavior. Every regression has an obvious blast radius: the entire
chat. The build journal pattern (`HANDOFF-NNN.md` after each tick) is
the same idea, scaled down to the PR unit.

## Existing chronicle

The 18-tick build journal in [`../../journal/`](../../journal/) is the
historical verification record for the v0.1 ship. The 20 screenshots in
[`../screenshots/`](../screenshots/) are the proof-of-life captures that
backed each tick. New PRs add to `docs/verification/`; the journal stays
read-only as the v0.1 archive.
