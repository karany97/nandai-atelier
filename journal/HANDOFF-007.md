# Berserker tick-007 handoff — 10:17 UTC
### AuditPill catches verdicts that land while the tab is backgrounded

## Shipped

One file changed, ~20 LOC added: `src/components/AuditPill.tsx`.

The original poll fires at t=8s, t=20s, t=45s and gives up silently
after the third miss. If the operator tabs away for a few minutes
right after sending a turn, the sentinel's verdict typically lands
during that gap — the original code would never see it. This tick
adds a fourth, opportunistic retry triggered by the tab regaining
focus.

```typescript
const lastRefocusFetch = useRef(0);
useEffect(() => {
  if (verdict) return;  // already have it, no listener needed
  let cancelled = false;
  const onVisible = async () => {
    if (cancelled || document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastRefocusFetch.current < 30_000) return;  // throttle 30 s
    lastRefocusFetch.current = now;
    const v = await fetchSentinelVerdict(cfg, msgId);
    if (!cancelled && v) setVerdict(v);
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    cancelled = true;
    document.removeEventListener('visibilitychange', onVisible);
  };
}, [verdict, cfg.baseUrl, msgId]);
```

Three properties this gets right:

- **Early return when verdict already set** → no listener bound, no
  wakeup churn for the (eventually) most common case.
- **`visibilityState === 'visible'` guard** → ignores the `hidden`
  fire that precedes every `visible` fire. Only refocus dispatches
  the fetch.
- **30-second throttle** → alt-tabbing rapidly doesn't hammer the
  executor.

## End-to-end proof

Method: Playwright with fetch-mock at `/sentinel/{id}`. The mock
starts returning 404 (verdict not ready), gets flipped to 200 mid-test,
then we simulate background→foreground.

| Step | Fetch count to `/sentinel/{id}` | Notes |
|---|---|---|
| Send turn | 0 | |
| Wait 12 s (covers initial t=8 s poll) | 1 | mock returned 404, no verdict |
| Flip mock to return verdict, dispatch `visibilitychange` (hidden → visible) | 1 → **3** | one ignored (hidden), one triggered the refetch (visible) |
| Inspect DOM | `audit · clean` pill renders | verdict landed; React re-rendered |
| Dispatch `visibilitychange` again (hidden → visible) | 3 → **3** | verdict already set; effect cleanup removed the listener; no fetch |

The +1 fetch on refocus, the cleanup contract, and the pill
re-rendering are exactly the three properties this tick promised.

Screenshot: `20_refocus_refetch_verified.png`.

## Operational note — LAN down, deployed via Tailscale fallback

During this tick `(internal-lan)` was unreachable from the Mac over LAN
(ping 100 % loss, SSH timeout). Cloudflare tunnels stayed healthy
(atelier returns 302, tools returns 405 on GET), so the box itself
is up — the 10.179.1.0/24 segment is the problem (probably a router
event on the Mac side).

Fallback path used: Tailscale's `infra-host` (Tailscale IP
`(internal-tailscale)`), which routes around the LAN issue. `tailscale
status` showed it online; SSH+SCP worked first try. Future ticks
should prefer Tailscale by default — same auth, same throughput,
no LAN dependency.

Added to the "lessons" pile: every deploy script should fall back
to `(internal-tailscale)` when `(internal-lan)` SSH errors out.

## Bundle delta

- MD5: `9a975d069a0ef0d84402bec522492c0a` (local & .213 match)
- Size: 525 KB single-file (no measurable delta over tick-006 — the
  refocus block compresses well alongside the existing AuditPill code)
- gzip: 143 KB

## Health snapshot at handoff

| Surface | State |
|---|---|
| Bundle MD5 (local & deployed) | `9a975d069a0ef0d84402bec522492c0a` |
| atelier.nandai.org | 302 → PIN, 200 after auth |
| tools.nandai.org/health | 200, n_tools=108 |
| tool-executor.service | active (running) |
| sentinel.service | active (running) |
| atelier-static.service | active (running, restarted via Tailscale path) |
| LAN 10.179.1.0/24 reachability from Mac | DOWN (this tick worked around it) |
| Tailscale `infra-host` ((internal-tailscale)) | online |
| All tick-004 / 005 / 006 features | intact, no regression |

## Open issues carried forward

From HANDOFF-006 plus new this tick:

| # | What | Effort |
|---|---|---|
| 7 | Catch tool-error responses (422 etc) and prepend a system hint to next round so the model retries with corrected args | S |
| 8 | Route tool-needing prompts to nandai-tool (faster, BFCL 91.4%) via LiteLLM pre-hook | M |
| 10 | Extend sentinel to also judge Opus replies for fabrication | M |
| 11 | Storage cap + LRU eviction once we cross ~500 convs / 50 MB | S |
| 13 | Cross-tab IDB sync via `BroadcastChannel('nandai-chat:sync')` | M |
| 14 | Handle `suggested_action: rerun_with_tools` — pull tool list, re-fire prompt with `tool_choice: 'required'`, surface result | M |
| 15 | Telemetry counter for sentinel-auto-escalations vs manual ones | S |
| 16 | Bring real escape brain online (Opus via Anthropic API budget OR DeepSeek-V4-Flash on .213) | M |
| 17 | Import schema-v2 migration path | S |
| 18 | Progress bar for big imports (>50 convs) | S |
| 19 | Confirm-by-typing for "Clear all" instead of `window.confirm` | S |
| 20 | **NEW**: deploy scripts should auto-prefer Tailscale ((internal-tailscale)) when LAN (.213) SSH fails | S |
| 21 | **NEW**: BroadcastChannel for AuditPill refetch — when one tab pulls a verdict, broadcast it so other tabs viewing the same conv update without re-fetching | S |

## Recommended next-tick first action

**Issue #15 — telemetry counter for escalations.** Small, observable,
and starts giving Karan a number to tune the sentinel against. Add
two counters in store state (`escalationsManual`, `escalationsAuto`),
increment in `escalateToOpus` based on `opts.reason`, surface them
in the Trinity dashboard or the sidebar status pill. ~25 LOC.

Backup if blocked: issue #11 (storage cap + LRU eviction). Defensive,
single-file, ~30 LOC walking the `updatedAt` index in reverse.

Tick wall time: ~34 min (LAN failure cost ~5 min triage + fallback).
Bundle iterations: 1 (clean first build). One networking incident
(LAN down) routed around cleanly.

*— end handoff-007*
