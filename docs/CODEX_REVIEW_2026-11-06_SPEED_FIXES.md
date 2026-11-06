# Speed fixes review — 2026-11-06

**Verdict: do not ship this batch unchanged.** The create optimization produces a real improvement in the offline profile, but hover prefetch introduces two reproducible correctness/reliability problems. Fix the blockers below and rerun their reproductions before shipping. No product fixes were made.

Reviewed `e2edca9066ba518b4a03b3d7177e454879c4098e..1e3f429` (all five local commits). Existing tracked files remain unchanged. This new report is the only repository deliverable; no commit or push. No production credentials, authenticated production requests, cloud writes or region changes were used.

## Blockers

### 1. P1 — an unresolved hover request can hold the editor indefinitely

Locations: `src/lib/pending-runs.ts:20–23,46–55`; `src/components/run-view.tsx:146–152`.

`prefetchRun` has no abort/timeout. Its advertised 15-second expiry is scheduled **after the request promise resolves**, not when prefetch starts. `RunView` waits for that promise before considering a fresh GET. A stalled request therefore leaves the editor on its skeleton; leaving and reopening still finds the same unresolved entry. The failed-prefetch fallback only helps a request that actually settles. Unresolved requests also evade map expiry and can accumulate while browsing cards.

Reproduction: run the actual TypeScript module through the installed TypeScript transpiler in a VM, provide a never-resolving fetch, call `prefetchRun('hang')`, then `peekLoad('hang')`. The entry exists, no expiry timer is scheduled for it, and the promise never resolves. This is a deterministic module/control-flow reproduction, not a real network outage browser measurement. Script: `/tmp/mavya-review-speed-unit.cjs`.

Required correction: bound prefetch transport/body time, expire entries from dispatch, and bound how long the editor waits for speculative work before attempting its normal load. Merely deleting the map entry cannot release an editor already awaiting that promise. Ensure late completions cannot override newer data or a create.

### 2. P2 — renaming a hovered card opens the old editor snapshot

Locations: `src/components/runs-list.tsx:156–163,249,277`; `src/lib/pending-runs.ts:46–65`; `src/components/run-view.tsx:146–152`.

Pointer/focus enters the card before the seller clicks its inline Rename control. The prefetch captures the old run. `rename` PATCHes the server and updates the list but never invalidates the pending snapshot. Opening the card within its retention window consumes the old title and skips GET. Other edits or deletion from another tab can similarly leave an obsolete snapshot. A previously unused create result can also become stale if the first tab leaves before consuming it and another tab edits/deletes the new run.

Browser reproduction on the HEAD production fixture: dispatch card pointer-over, wait 800 ms, click the real Rename control, type `Renamed title`, press Enter, wait for PATCH, then open the card. Output:

```
LIST AFTER RENAME Renamed title
EDITOR TITLE Fixture video
```

The fixture applies PATCH to its backing run, so a subsequent fresh GET would return the renamed title. There were zero browser runtime exceptions. Script/log/result: `/tmp/mavya-review-speed-prefetch.cjs`, `/tmp/mavya-review-speed-rename.log`, `/tmp/mavya-review-speed-rename.json` (`ROUNDS=1 PROBE=rename`). The deterministic module probe independently confirms snapshot staleness.

Required correction: invalidate prefetched data on successful mutations, including rename/delete, with protection against older in-flight completions. Define refresh behavior for cross-tab changes. Claude's rename-after-create/reopen test exercises a different path: it does not cover inline list rename after card hover.

## Matched offline speed rerun

Reused the baseline production fixture `/tmp/mavya-speed-20261106` and made `/tmp/mavya-review-speed-head` with precisely the changed HEAD files overlaid. Preserved the fixture's passthrough proxy, dummy browser auth, hidden links and Turbopack root. No `.env` or private store was copied. HEAD fixture production build passed. Read the installed Next client-directive documentation before adding temporary harness code.

Same Chrome for Testing **142.0.7444.61** for both builds, 1440×1000, CPU 2×, latency 250 ms, 10/2 Mbps, cache disabled, API fixture delay 250 ms, library delay 1,500 ms and Next route prefetch delay 2,500 ms. Three rounds, alternating baseline then HEAD within each round. Browser transport intercepts API calls; these are UI timing measurements, not cloud API tests. Corrected the reused stub to return `{run,source}` for editor POST. The script's inherited Chrome-156 label and empty before/after summary objects are boilerplate; use its raw `rows` and actual browser version.

Milliseconds, medians of three; feedback/readiness use the existing DOM predicates plus two animation frames, not hardware paint timing:

| Scenario | Baseline feedback | HEAD feedback | Baseline usable | HEAD usable | Usable delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| New video | 15.0 | 9.7 | 1,097.9 | 607.7 | −490.2 |
| Open video, no hover | 15.9 | 11.6 | 850.5 | 857.0 | +6.5 |
| Use library hook | 12.7 | 10.6 | 1,104.5 | 610.1 | −494.4 |

All 18 samples completed, zero runtime exceptions. Creation removes the POST→navigation→GET waterfall. It does not make editor data available before creation finishes.

Separately, HEAD Open video with 800 ms hover lead time: feedback **10.4 ms**, usable **610.1 ms** median, three samples, zero runtime exceptions. Each sample made one editor-data request total, started by hover and reused on click. This saves about 247 ms against matched HEAD without hover, while shifting API work before the click. Chunk/navigation latency remains; this is not Claude's warmer dev-copy 89 ms scenario.

Evidence: `/tmp/mavya-review-speed-compare.cjs`, `.json`, `.log`; `/tmp/mavya-review-speed-hover.json`, `.log`. Preserve raw rows when analyzing; the inherited summary groups only phases named `before`/`after` and is empty for our `baseline`/`head` labels.

## Security and entry-point review

The following judgments distinguish source inspection from live authenticated verification.

| Check | Result / evidence |
| --- | --- |
| Editor POST reads another user's run | No bypass found in cloud source. `currentUser` verifies the user/account state. Upsert ignores duplicate IDs, then `getRun(id,who)` filters both identity and owner; another owner's collision throws and becomes 503. It does not return that run. |
| Editor POST reads another user's hook | No bypass found. Both requested and stored-hook lookup use `getReference(id,who)`, allowing curated rows or the owning user's rows. A retry resolves the stored run's hook; a missing stored hook returns 404. Plain POST response shape is preserved. |
| HTTP response cache | Successful editor POST explicitly uses `private, no-store`; prefetch GET uses `cache:'no-store'`. Client module reuse still requires its own invalidation. |
| Same-tab sign out/sign in | Normal `signOut` performs a full document navigation, and sign-in also uses `location.assign`. That destroys the module map. No ordinary same-tab leak found through these flows. |
| Session changes without document reload | Map is keyed only by run ID, with no auth-change clearing or user partition. An externally changed session could consume a prior user's snapshot if it knows/retains the URL. This is a defensive gap, not a demonstrated exploit through the normal sign-out UI. Cover it with auth-change invalidation; cross-tab auth changes merit testing. |
| Signed out | Proxy APIs return 401; app destination redirects to signup with continuation. If session expires after page admission but before POST, the create result becomes the generic retry error. No authorization is bypassed. |
| Missing plan | Contrary to the request's “never sent today” aside, `session.ts` includes POST `/api/runs` in `PAID_CONTENT_WRITES`, so proxy 402 is possible. `startCreate` handles it and the live editor replaces the URL with `/pricing`; page admission independently redirects unpaid users. If the editor has already been left, its `alive` guard suppresses that redirect. |
| Account closing | `currentUser` returns null and the POST returns 401. Generic create error may appear; no create admission bypass found. Cached prefetched content can remain visible briefly without a new API authorization check; mutations still authorize server-side. |
| List header and empty state | Both call the same `newRun`; synchronous ref lock prevents duplicate handler dispatch before navigation. |
| Library / reference detail | Both generate ID, start the editor POST and navigate; hook selection is preserved in retry error state. Each uses a synchronous busy lock. Inspected; library path also measured above. |
| Legacy edit redirect | Unchanged; it ultimately opens RunView and therefore shares pending-load behavior. Not separately rerun in this review. |

The credential-free local JSON-store branch is not an account-isolation test. Do not infer production security from it. Authenticated multi-account and real allowance RPC behavior were not exercised here.

## Creation, navigation and dependent operations

- **503 and same-ID retry:** independently reran a browser fixture that rejects the first create with 503, clicks the displayed Try again control, and permits the second create. Both POSTs carry the exact same ID and the editor becomes usable with zero runtime exceptions. Evidence: `/tmp/mavya-review-speed-retry.cjs`, `.log`, `.json`. This verifies client recovery; cloud upsert idempotence is supported by source inspection, not a production write.
- **Slow create / PATCH ordering:** the page shows a skeleton until the creation promise yields `{run,source}`. The `!run || run.id !== id || !refs` render guard keeps title, steps, generation, export, upload and delete controls unavailable. Initial caption normalization PATCH runs only after the create response. The pagehide flush checks matching run ID. No newly introduced PATCH-before-create path was found. Holding the create response indefinitely has a 30 s client abort; the server might still commit, making same-ID retry necessary.
- **Double click:** ref locks in all three entry points are set synchronously before dispatch; retry removes its button synchronously on state update. Code inspection found no normal double-create path. A fresh click after Back intentionally gets a different ID, so a first request still completing can create an additional run; that is a new action, not a retry.
- **Back/forward:** source view effect cleanup resets busy flags, and RunView's `alive` guard prevents a departed page from applying results or redirecting. A consumed entry is removed so later mounts load fresh. These are source findings; Claude's 27–42 ms Back result was not independently remeasured. Unconsumed pending snapshots can still be stale, as discussed above.
- **Second tab:** the pending map is tab-local. Before the POST commits, another tab GETs a nonexistent ID and shows the generic missing error; there is no automatic retry on later commit. Reload is required. This limitation follows directly from navigating before creation and was not present in the old successful-create URL timing. It does not expose controls against a nonexistent run, but should be included in acceptance testing.
- **Delete immediately after create:** editor Delete is gated on a loaded run, hence follows POST success. Deleting from a second tab before the first consumes its pending response can still display a deleted snapshot; later saves fail. No deletion invalidation exists in the new map. Deletion racing an unused card prefetch has the same problem.
- **Abandoned create:** leaving the editor does not cancel creation; successful unused results live for another 60 s after settlement. A 30 s abort is not proof the server did not persist the run. The same-ID upsert protects retry; it does not cancel abandoned work.

A direct HTTP probe against the credential-free **production** fixture returned 500 from the existing `Production account storage is unavailable` guard before store work. It is **not** a passing API-contract test and is not counted in the measurements. Evidence: `/tmp/mavya-review-speed-api.cjs`, `.log`. Browser API timings above remain valid transport-stub measurements. Claude's full-source/retried-hook/404 tests are reported in the request, but were not independently reproduced against a real DB here.

## Worker queue, limits and observability

The actual `next()` scheduler was extracted without editing its body and exercised with fake awaited workers. For seven queued copies and two exports it produces:

```
p1,p2,p3,e1,p4,p5,p6,e2,p7
```

Source and deterministic execution agree: one job at a time, FIFO inside each class, exports receive a turn after at most three consecutive copies while exports wait, previews receive a turn after a running export finishes. No class starvation under finite-duration jobs. Already running jobs are not preempted.

**The bound is in jobs, not seconds.** Each copy can occupy the worker for up to its existing 15-minute execution deadline, so three ahead can add roughly 45 minutes to an export's wait, plus current work and cleanup. Queued time is outside `JOB_MS`; signed source/upload URLs can expire while waiting, and queue retention is six hours. This is a substantial heavy-load risk; no actual 45-minute workload was run. Earlier export-first scheduling had the opposite preview starvation problem.

Two observability issues remain:

- `/health` reports only `queue.length`, omitting up to 200 waiting preview jobs; it can report `queued:0,busy:true` under a large preview backlog.
- Job `ahead` is only its zero-based export-array position, omitting the running job and copies that now run first. It is not the number of actual jobs before execution. No application use of `ahead` was found outside the worker, so this is not currently a broken customer-facing position label. Label it explicitly or report both queues and scheduler state.

`MAX_QUEUE=8`, preview waiting cap 200, export-record cap 2,000, per-user active-export restriction and per-job abort remain. Preview records retain input/output URLs while queued and clear them when finished. No new concurrent encoding or larger decode allocation was introduced; this is source analysis, not an RSS stress measurement. Render admission checks passed against the actual worker HTTP server. Existing per-job limits are still active, but do not promise a 15-minute end-to-end queue SLA.

The stale preview comment still says exports go first and read originals; executable scheduling and working-copy behavior disagree with that comment. Correct it when implementing the requested fixes.

## Two-second missing-copy cache and R2 request cost

A missing key is now checked after two seconds instead of twenty. Once found, it is remembered indefinitely in that process. Approximate steady-state bound for **serial** checks is one R2 HEAD per missing key per two seconds per warm process (0.5/s; 30/min); checking both p480 and master can reach 1/s, 60/min per media item/process. At twenty seconds the comparable figures were 3/min and 6/min: up to a tenfold increase when callers poll often enough.

This is not a global hard rate limit. Separate instances have separate maps. Concurrent misses are not promise-coalesced, and each can issue HEAD before the first stores its result. Cold instances and the >5,000-entry map clear add requests. `requestPreview` can also HEAD the original; its separate ten-minute suppression normally prevents repeated submissions in one warm process. Polling less often than two seconds lowers the actual rate.

A foreground export polls every 2.5 s, so a missing master checked on each poll can be HEADed about 24 times/min/process rather than about three. Not every poll necessarily traverses `exportSource`; actual rate depends on the route phase. No live R2 traffic was generated. The shorter TTL improves subsequent readiness checks; it does not automatically replace an already-open original video element or provide a push readiness signal.

## Other validation and release scope

Independently passed in the temporary HEAD copy:

- Production `next build`, including TypeScript; separate `tsc --noEmit`.
- ESLint on all changed application TypeScript/TSX files.
- `render-admission-checks`, `render-checks`, `frame-schedule-checks` (**602 cases**).
- `verify-previews`, `verify-export-media`, `measure-export-quantization`.

The repaired media checks call the required frame-count stage; export-media also fits piece audio like the worker. Quantization reproduction yields 15 final frames and a red final pixel as expected. These passes test their synthetic cases, not real cloud uploads or all media formats.

Mono alone has `preload:false`; Sans/Satoshi and editor caption declarations remain. No font-family change was introduced. Region/deployment configuration is unchanged by this commit range; keep Vercel functions in iad1 near Supabase us-east-1. This review did not inspect an authenticated deployment dashboard to verify actual placement.

**Release gate:** resolve the unbounded prefetch wait and mutation invalidation blockers; then repeat stalled/failed prefetch, hover→rename→open, hover→delete→Back/Forward, multi-tab create/edit/delete and cross-session checks. Keep the creation gain, authorization checks, one-worker concurrency and media/frame correctness. The measured gain supports the approach, not a blanket “nothing can break” certification.

## Round 2 — f36800df853d0eb21b768936c70d1584229c75c7

**Verdict: ship.** The two Round 1 blockers are addressed in the inspected code and pass the deterministic reproductions below. This supersedes the earlier do-not-ship verdict for this commit. Independent browser confirmation is unavailable in this session because its sandbox denies local socket connections and listeners; no new browser timing or production-build pass is claimed.

### Required reproductions

I reran the original `/tmp/mavya-review-speed-unit.cjs` against the new source. Its printed assertions about absent expiry and missing rename invalidation are hard-coded descriptions of the old implementation, not valid Round 2 findings. It now records two dispatch-time 10,000 ms timers, and fails its obsolete three-copy scheduler expectation because the actual worker correctly alternates one each. I preserved that output in `/tmp/mavya-review-speed-round2-original-unit.log` and made an updated deterministic probe, `/tmp/mavya-review-speed-round2-unit.cjs`, with explicit assertions for the new behavior. It transpiles actual HEAD source and executes the extracted RunView loader and list rename handler, rather than separately reimplementing their logic.

All nine updated checks pass; output is `/tmp/mavya-review-speed-round2-unit.log`:

| Probe | Independent result |
| --- | --- |
| Stalled prefetch, abort-aware transport | Signal aborts at 4,000 ms; job resolves to null; entry is absent at 10,000 ms from dispatch. |
| Never-settling prefetch, transport deliberately ignores abort | Actual RunView branch starts fresh GET at 2,000 ms, returns its result and removes the pending entry. It no longer depends on the hover settling. |
| Never-settling unused prefetch | Entry expires at 10,000 ms even with no editor consumer. |
| Page left before hover/create completes | Prefetch race and create completion forget their entries before the `alive` guard rejects the departed consumer. |
| Hover → actual rename handler → open | Editor loader gets `Renamed title`. The test additionally prefetches old data during the outstanding PATCH; the post-PATCH invalidation drops that entry too. |
| Late completion of invalidated hover | Resolving the old request does not reinsert it into the map. |
| Second-tab fresh-load loop | Two 404 replies followed by success produce three GETs, with 1,000 ms between retries. |
| Actual worker scheduler | `p1,e1,p2,e2,p3,p4,p5,p6,p7` for seven copies and two exports; exports and copies alternate while both queues contain work. |
| Concurrent storage checks | Twenty simultaneous same-key misses issue exactly one mocked storage HEAD and all resolve together. |

I also attempted the original browser reproduction directly:

```
ROUNDS=1 PROBE=rename node /tmp/mavya-review-speed-prefetch.cjs /tmp/mavya-review-speed-round2-rename.json
```

It failed before loading any page: `connect EPERM 127.0.0.1:9232`. Chrome startup failed with `setsockopt: Operation not permitted`. A minimal local HTTP listener independently fails with `listen EPERM`, confirming the environment restriction. Evidence: `/tmp/mavya-review-speed-round2-rename.log` and `/tmp/mavya-review-speed-round2-listen.log`. Therefore the required **browser** hover → real title control → open rerun was attempted but could not complete. The passing rename result above is a deterministic handler/loader reproduction, not a browser observation. Claude's reported browser results remain corroborating supplied evidence, not my independently measured results.

### Diff review and remaining limits

- **Original stalled-prefetch blocker: closed.** Dispatch-based expiry, a four-second abort and the editor's separate two-second race solve distinct parts of the problem. Even an abort-ignoring hover cannot hold the editor. The normal fallback GET itself retains the existing lack of a timeout; this fix bounds speculative waiting, not every possible network failure.
- **Original inline-rename blocker: closed.** `dropLoad` before and after PATCH covers an existing hover and another hover during the write. Delete has the same invalidation bracketing. Identity-checked `forgetLoad` cannot delete a replacement entry, and late fetch completions cannot repopulate the map. `dropLoad` preserves create entries.
- **Create cleanup:** moving `forgetLoad` ahead of the `alive` check fixes retention by a departed editor consumer. Strictly, cleanup is attached by RunView, not by `startCreate` itself: a create whose editor effect never runs still has the 60-second dispatch expiry. Thus “never reused by a later visit” is stronger than the implementation guarantees for that unusual no-consumer case. This does not reopen either demonstrated blocker.
- **Second tab:** bounded 404 retry improves the initial race; creation taking longer than the retry window can still show the missing error and require reload. If the page leaves during the one-second retry sleep, the loop can send one extra GET because `alive` is checked before sleeping, not again before dispatch. The result is ignored by the outer guard. Neither is a release blocker for this change.
- **Worker:** one-job concurrency and existing job deadlines remain. A waiting export now waits behind at most one additional copy between export turns, rather than three; that copy can still take up to the existing 15-minute execution limit. Queue time is still outside that limit. `/health.copies` makes waiting copies observable. `ahead` still describes export-array position, not all intervening work, and has no current application consumer. These are the remaining operational limits from Round 1, not unresolved starvation bugs.
- **R2:** in-flight sharing removes concurrent same-process duplicate HEADs. The two-second negative TTL still permits roughly 30 serial HEADs/minute per continuously checked missing key per process; other instances retain independent caches. This is not a global rate limit.
- **Authorization and deployment:** no auth, ownership, paid-plan or deployment-region logic changed in HEAD. Round 1's account-isolation and cross-tab/session caveats remain; this commit does not claim a cross-tab invalidation protocol.

### Validation and scope

Independent **passes** in `/tmp/mavya-review-speed-round2`: `tsc --noEmit`, ESLint on the four changed application TS/TSX files, `render-checks`, and the nine updated deterministic probes. The installed Next client-directive guide was reread before preparing harness code. Logs: `/tmp/mavya-review-speed-round2-tsc.log`, `/tmp/mavya-review-speed-round2-eslint.log`, `/tmp/mavya-review-speed-round2-unit.log`.

The isolated production build was attempted but **did not pass**: Next could not fetch Google Fonts under the restricted network. Log: `/tmp/mavya-review-speed-round2-build.log`. `render-admission-checks` was also attempted and failed to start its local HTTP worker; the independently demonstrated listener restriction prevents that test here. These are verification limits, not evidence of a newly introduced product failure. No repeat of the unchanged media-rendering suite or new speed comparison is claimed in Round 2.

Only this Round 2 section was appended in the repository; existing tracked files remain unchanged. No commit, push, production request or cloud write was performed.
