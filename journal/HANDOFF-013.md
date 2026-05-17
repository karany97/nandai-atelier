# Berserker tick-013 handoff — 13:08 UTC
### Deploy fallback is now a one-liner — no more copy-pasted Bash prologue

## Shipped

One new file: `~/NandaiJarvis/scripts/deploy-atelier.sh` (110 LOC,
executable, well-commented).

### Why

Every tick from #007 through #012 deployed the bundle with the same
~10-line Bash prologue:

```bash
LAN_OK=$(nc -z -G 2 (internal-lan) 22 2>/dev/null && echo yes || echo no)
HOST=$([ "$LAN_OK" = "yes" ] && echo "operator@(internal-lan)" || echo "operator@(internal-tailscale)")
scp -o IdentitiesOnly=yes ... "$HOST:..."
ssh -o IdentitiesOnly=yes "$HOST" 'sudo cp ... && md5sum ... && systemctl restart ...'
```

Six pasted copies = six chances for me to mis-edit one. Now it's
collapsed into a single helper invocation:

```bash
bash ~/NandaiJarvis/scripts/deploy-atelier.sh /tmp/nandai-chat/bundle.html tickNNN
```

### What the helper does

1. Resolve `$BUNDLE` (default `/tmp/nandai-chat/bundle.html`) and
   `$LABEL` (default `tick<UTC-timestamp>`).
2. Compute local md5 + size — the single source of truth for the
   tick.
3. Pick the SSH target: LAN `(internal-lan)` if port 22 answers
   within 2 s, else Tailscale `(internal-tailscale)` (`infra-host`).
   Exits with code 2 if neither works.
4. SCP bundle to `/tmp/atelier-bundle-${LABEL}.html` on the target.
5. One round-trip SSH heredoc: `sudo cp` to
   `/srv/nandai-atelier/index.html`, compute remote md5sum, restart
   `atelier-static.service`, smoke-test `curl :3057`.
6. Compare local md5 vs reported remote md5 — mismatch is a hard
   fail (exit 4). Print summary line: `OK md5=... size=...KB
   http=200 svc=active via=...`.

Exit codes are documented in the script header so a future CI
hook can wire on them.

## End-to-end proof

| Test | Command | Result |
|---|---|---|
| Happy path with explicit args | `deploy-atelier.sh /tmp/nandai-chat/bundle.html tick013-dryrun` | `OK md5=fc42250520c0b40e790f9d8db11b4f5d size=520KB http=200 svc=active via=Tailscale fallback (LAN unreachable)`, exit 0 |
| Bad bundle path | `deploy-atelier.sh /nonexistent/bundle.html` | `ERROR: bundle not found at /nonexistent/bundle.html`, exit 1 |
| Default args (idempotent re-deploy) | `deploy-atelier.sh` | Auto-labels with UTC timestamp `tick20260516130740`, deploys cleanly, exit 0 |
| LAN path | (not tested — LAN to `.213` still down) | would route via `operator@(internal-lan)` if `nc -z -G 2 (internal-lan) 22` succeeds; untested in this tick because the LAN issue (#24) is chronic |
| Both targets down | (not tested — would require disabling Tailscale, which would break the tick) | code path returns exit 2 with diagnostic; safe by inspection |

The post-deploy state of `atelier.nandai.org` is unchanged from
tick-012 (same MD5 `fc42250520c0b40e790f9d8db11b4f5d` — this tick
adds infrastructure tooling, not chat code).

## What this changes for future ticks

The deploy block in every future handoff is now:

```bash
bash ~/NandaiJarvis/scripts/deploy-atelier.sh /tmp/nandai-chat/bundle.html tick0NN
```

Output is a single summary line that copies straight into a handoff
table. No more `LAN_OK=$(...)` ceremony. If the LAN ever recovers,
the helper automatically uses it without any code change here.

## Bundle delta

This tick shipped no chat code — the bundle MD5 on disk is still
`fc42250520c0b40e790f9d8db11b4f5d` from tick-012. The change is
local-only (`~/NandaiJarvis/scripts/deploy-atelier.sh`).

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (deployed) | `fc42250520c0b40e790f9d8db11b4f5d` (tick-012) |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| atelier-static.service | active (restarted twice this tick via helper) |
| LAN the internal-LAN segment (RFC-1918) → (internal-lan) | STILL DOWN |
| Tailscale `infra-host` ((internal-tailscale)) | online |
| New helper | `~/NandaiJarvis/scripts/deploy-atelier.sh` (executable, +x, 110 LOC) |
| All tick-004..012 chat features | intact, untouched |

## Open issues carried forward

From HANDOFF-012 minus #20 (now closed):

| # | What | Effort |
|---|---|---|
| 8 | Route tool-needing prompts to nandai-tool via LiteLLM pre-hook | M |
| 10 | Extend sentinel to also judge Opus replies | M |
| 13 | Cross-tab IDB sync via BroadcastChannel | M |
| 16 | Bring real escape brain online | M |
| 17 | Import schema-v2 migration path | S |
| 18 | Progress bar for big imports | S |
| 19 | Confirm-by-typing for "Clear all" | S |
| 21 | BroadcastChannel for AuditPill refetch | S |
| 23 | Telemetry CSV export | S |
| 24 | LAN (internal-lan) unreachable (7+ hours) | M |
| 25 | Telemetry for tool-error retry recovery rate | S |
| 26 | Surface retry hint visually in tool-call card | S |
| 27 | Success-rate for rerun-with-tools | S |
| 28 | Cooldown across reruns (3-strike warning chip) | S |
| 29 | Real bytes-used estimate in storage stats | S |
| 30 | "Export then clear" combo button | S |
| 31 | **NEW**: companion `build-and-deploy-atelier.sh` that does `npm run build && bundle-artifact.sh && deploy-atelier.sh` in one call — same DRY argument as this tick made against the deploy block. Future me will appreciate it. | S |

## Recommended next-tick first action

**Issue #13 — cross-tab IDB sync via BroadcastChannel.** Now that
IDB persistence (tick-004), data ownership (tick-006), and LRU cap
(tick-012) are all shipped, the remaining storage-layer gap is
two-tab coherence. If the operator opens the chat in two tabs and
sends a message in tab A, tab B's in-memory state is stale until a
manual refresh. ~30 LOC: `new BroadcastChannel('nandai-chat:sync')`,
publish `{ convId, op: 'save'|'delete' }` after each persist,
receive in other tabs and re-load that conv from IDB into state.

Backup if blocked: issue #19 (confirm-by-typing for "Clear all").
The current `window.confirm` dialog is unstyled and Chrome's
"prevent additional dialogs" checkbox can disable it entirely — a
real risk for an operator who clicks "Clear all" without realising
their confirm dialogs are suppressed. ~25 LOC custom modal that
requires typing `clear all` to enable the destructive button.

Tick wall time: ~12 min (smallest tick of the night — pure
infrastructure, no chat-code build/deploy/verify loop). Bundle
iterations: 0. Verification: happy path + bad-input + default-args
all green.

*— end handoff-013*
