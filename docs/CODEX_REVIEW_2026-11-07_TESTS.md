# Regression-test review — 2026-11-07

**Verdict: blockers.** The extraction is faithful and the tests add useful coverage, but this does not satisfy the founder's rule that every raised problem has a regression test. Several previously fixed user-visible problems can return while the entire `npm test` command stays green. These are test-acceptance blockers, not evidence that those product defects currently exist.

Reviewed HEAD `8b3d42d2bb61e887965ce4c17f076554eb24e6a1`, including its complete extraction diff against `f8b5ebc`. No product fixes, commits or pushes. Read the installed Next route-handler guide before mutations. Every temporary source mutation was restored byte-for-byte; this report is the only new review deliverable. The supplied request was already untracked and was preserved.

## 1. P1 — async tests can succeed without executing their assertions

`scripts/speed-fix-checks.cjs:24-25,43-44` starts an async IIFE, awaits creation, and relies on fake timers stored in an array. Unresolved promises and that array do not keep Node alive.

**Independent mutation:** add `return new Promise(() => {});` at the start of `startCreate` in `src/lib/pending-runs.ts`. Running `node scripts/speed-fix-checks.cjs` then exits **0**, with **empty stdout and stderr**. None of its 21 checks finishes. A never-completing create is a real regression, not a successful test.

Required test repair: retain a real watchdog that fails an incomplete run, clear it only after the awaited suite finishes, and assert the expected completion/check count. Exercise a deliberately unresolved dependency to prove the harness fails. An external timeout alone is insufficient when Node exits early with success. Apply the same completion discipline to asynchronous caption checks.

## 2. P1 — tested helpers do not guard the production integrations

I independently applied each mutation below and ran its corresponding suite. Every mutation survived. I then applied **all five together** and ran the complete `npm test`: it exited **0**, reporting **38 caption, 24 editor, 21 speed, 102 sound/queue checks and 602 frame-schedule cases**.

| Surviving mutation | Why the current tests miss it | Required regression test |
| --- | --- | --- |
| `run-view.tsx:155`: replace `Promise.race([known.job, late])` with `Promise.race([known.job])` | The fake fetch honors abort. The suite tests the library's four-second abort, never the editor's independent two-second escape. | Execute the real loader branch with an abort-ignoring prefetch; at 1,999 ms no fallback, at 2,000 ms fresh GET; fresh response becomes visible and old completion cannot overwrite it. |
| `runs-list.tsx:159-173`: replace all four `dropLoad(r.id)` calls with `void r.id` | Calling `dropLoad` directly proves the helper works, not that rename/delete invokes it before and after the write. | Hover → rename → hover during PATCH → successful completion → open must use the new title; equivalent delete case must not reopen the stale video. |
| `run-view.tsx:732`: replace `shiftSounds(cur.sounds, from, by)` with `cur.sounds` | The editor test invokes `shiftSounds` directly, never insertion. | Invoke the actual insert handler, inspect saved sound positions, and check finite insert point, multiple inserted clips, crossing sounds and Undo. |
| `editor-tools.tsx:1713`: replace `row: rowFor(rowOf(p))` with `row: 0` | The test constructs its own pasted pieces using the tested row mapper; production paste is never executed. | Actual group copy/paste into existing sounds must allocate distinct new rows and preserve each overlapping sound's full duration. |
| `render/sound.mjs:23`: zero every output channel after the first in the stretched-audio branch | `sound-queue-checks` supplies two identical channels but inspects only `[0]`; frame checks downmix audio to mono and do not assert expected per-channel amplitude. | Distinct left/right signals; assert both channels' length, amplitude, continuity and ordering, including the file adapter and a final partial IO chunk. |

The call-site mutations are intentionally small disconnects of already-correct helpers. Keeping helpers green while disconnecting them is precisely the regression risk these checks must address.

## 3. Mutations the suites correctly reject

These were separate runs, each restored before the next:

| Mutation | Observed failure |
| --- | --- |
| Return input texts immediately from `containTexts` | Caption fixture leaks onto frame 78 beyond its clip's last frame 69. |
| Round containment's returned end to milliseconds | Caption containment idempotence assertion fails. This run stops there, before the dedicated 1.0166-second assertion. |
| Remove `activeGroup`'s independently selected sound guard | “a sound picked after the group: the group is inert”. |
| Use the old global offset inside a copied clip in `groupPlacer` | Orange caption lands at 18 instead of 15. |
| Extend prefetch abort from 4 to 40 seconds | “a hung prefetch resolves to null after 4 s”. |
| Change `nextJob`'s mixed-queue threshold from `< 1` to `< 0` | Order becomes `eeccc` rather than `cecec`. |

Baseline `npm test` also passed all five suites before mutations. Mutation harness and detailed output are in `/tmp/mavya-test-mutations.py`, `/tmp/mavya-test-mutations.json` and `/tmp/mavya-more-mutations.py`; these temporary files are supplementary, not required repository artifacts. I did not independently rerun the historical-commit claims for `74490ed` and `dc62726`.

## Extraction fidelity

No behavioral discrepancy found against `f8b5ebc`:

- `partsChange` adds an explicit `source` argument in place of the closure; both callers pass the same source. Piece filtering, text remapping, speed, magnet gaps and stored parts remain equivalent.
- `deleteMany` becomes a wrapper around `deleteSelection`. Working-copy iteration, whole-demo removal, preserving the hook when every hook piece is selected, selected-text removal and the single save payload are unchanged.
- `activeGroup` preserves the original boolean expression, including the empty sound-chooser exception. Toggle order is unchanged.
- `groupPlacer` retains the same starts, membership, before/between/after placement and clamping. `pastedRows` retains sorted unique rows and allocation after the maximum existing row.
- Worker `next()` asks `nextJob` with initial streak zero, then the updated streak after each awaited operation. Copy/export shifts, streak reset and `busy` serialization remain equivalent to the old loop. The declaration matches the implementation. There is no new event-loop yield between choice and shift.

The queue test reconstructs the loop rather than exercising the worker; it cannot establish worker concurrency, actual counter wiring, failure recovery or jobs arriving during an await. This is a coverage limitation, not an extraction defect found here. Supplied Chrome comparisons were not independently rerun.

## Assertion quality and determinism

- Fake time avoids wall-clock/network flakiness, and the shared-preview lookup test uses a proper deferred gate. However, flushing exactly five microtasks is coupled to promise-chain depth: a harmless extra async layer can break it. Prefer explicit milestones and a bounded drain with a diagnostic failure.
- The fake clock does not implement cancellation or native timer IDs; `clearTimeout` remains the real global. Current tested paths do not require cancellation, but future timer cleanup would be tested inaccurately. Supply matching fake `clearTimeout` and an abort-ignoring transport case.
- JSON comparison avoids the VM cross-realm prototype issue for the simple current data. It also treats array `undefined`, holes and `null` alike and drops undefined object fields. Normalize into the host realm then use deep strict equality, with explicit checks where absence matters. The sound-shift expectation currently encodes `undefined` as JSON `null`.
- `check-module.cjs` transpiles without type checking and manually stubs imports, including validation and storage. These are useful route-handler tests, not Next runtime, persistence or authorization integration tests. Keep a separate typecheck gate.
- Regenerated-hook assertions check only `end <= 1`. They do not require finite times, positive duration, preserved text or nonnegative starts. The `retimeTexts` assertion likewise permits a zero-length caption. Assert the intended interval, content, identity and rendered frame ownership.
- `framesInside` skips captions whose start belongs to no frame interval. The real fixture adds useful exact frame checks, but the general oracle can accept unowned/invalid captions; explicitly validate gap ownership, finite times and positive rendered duration.
- `editor-checks` claims pieces across clips and magnet-on/off coverage, but partial-piece deletion is exercised in one clip only; magnet tests delete a whole clip. Add partial deletions across two clips, `partsChange` with magnet off, speed-adjusted pieces and associated text positions. Hook preservation currently checks that some hook exists, not that the selected hook's original pieces remain unchanged.
- Sound checks establish exact length and useful silence/step limits for their fixtures, not pitch fidelity, arbitrary source content or inter-piece join continuity. The 1.6× sine-step margin is a tolerance, not proof of inaudibility. Identical stereo inputs and inspecting only channel zero are especially misleading.
- Frame scheduling invokes installed ffmpeg/mediabunny with generated fixtures and real file IO; it passed here. Its 602 cases are cases, not a complete end-to-end browser-export certification. The new pure checks need no external service.

## Coverage of every named problem

“Partial” below means useful tests exist but the previously reported user path is not fully guarded. Absence from `npm test` is distinguished from absence anywhere in the repo.

| Problem | Current coverage and still-needed test |
| --- | --- |
| Seamless cuts | Strong existing frame/ffmpeg matrix, source-end sentinel, short audio and zero-picture-with-sound checks. Still add real browser decode/encode → joined export tests with clip audio enabled, adjacent-cut boundaries and distinct stereo; retain the maximum-duration isolated RSS and chunk-boundary regressions from the prior review as repository checks. |
| New video | Partial: pending-create success/error/402 and stubbed POST projection/retry. No test of immediate navigation before POST completion, actual skeleton, Try again preserving ID/hook, pricing navigation or departed consumer. Add a component/navigation test with a deferred POST; fix the async false-pass first. Stubbed `createRun` itself implements idempotency, so this suite does not test real persistence idempotency. |
| Hover prefetch | Partial: abort, dispatch expiry, identity removal and direct drop helper. Missing real hover wiring, editor two-second fallback with ignored abort, rename/delete bracketing, stale completion and departed consumer. Add the loader/list integrations above. |
| Preview queue | Partial: pure order and preview-ready sharing/cache. Add real worker drain with arrivals during work, failure, bounded copy/export alternation and maximum one active job; test preview-ready rejection clears its in-flight entry and permits retry. |
| Fonts | No font check in `npm test`. Existing `scripts/verify-claude-fixes.cjs:18-33` already covers preview font fallback/retry, so fonts do **not** have zero repository tests. Add/wire the applicable font regressions: preview/export intended weight and subset alignment, failed/retried loads and current preload policy (Mono disabled, required faces retained); actual canvas/browser comparison for rendered parity. |
| Caption leak | Best-covered new area: fixture, rounding, gap, regenerate/reconcile/export and real PATCH handler with stubs. Add validity assertions above and browser preview/export boundary frames; verify saved result is consumed on reload rather than only captured in an update stub. |
| Multi-select | Partial: pure toggle/stale-group and deletion output. Missing modifier selection in timeline/preview, sound-only mixed groups, actual Delete target after adding a sound, and one-step Undo/Redo. Add component event tests against saved run/sound state. |
| CapCut keys | No keyboard handler is exercised by these new tests. Add actual key dispatch for split/split-all, Q/W trims, cut navigation over internal pieces, frame stepping, copy/cut/paste, select-all including sounds, Undo/Redo and zoom; check editable-target guards, Mac modifiers and repeat behavior. Test the app's defined bindings rather than claiming universal CapCut parity. |
| Groups | Partial: placement helper examples. Missing actual copy/cut/paste assembly, selection ordering, layer durations/IDs, sound movement and a single Undo transaction. Add the real non-adjacent two-clip group scenario with text/sound before, inside and between clips. |
| Sound rows | Partial: row allocation and manually constructed overlapping pieces. Actual paste remains unguarded; use the surviving collapsed-row mutation as the acceptance check. Include sparse existing/copied row indices and repeated paste. |
| Inserts moving sounds | Partial: `shiftSounds` only. Actual insert call site can be removed without failure. Add actual handler tests for single/group insertion at beginning, middle and end, including sounds beginning exactly at the insertion and sounds crossing it. |

Release the extraction on its merits, but do not sign off this batch as “tests for every problem” until the silent async success and demonstrated integration/channel gaps are covered. No build/lint rerun was needed to establish these test failures; this review makes no new build or live-browser claim.

## Round 2

**Verdict: blockers for test sign-off.** HEAD `353d76d46e8e5bf8203dec8eb76e3fdee83ee531` fixes the asynchronous false pass and rejects all five previously surviving mutations at their new shared-code locations. The additional extraction is faithful on inspection. Two browser assertions still fail to establish the user behavior they claim to protect; correct those before claiming every raised problem is guarded. I found no new product-code blocker in this commit.

### Independent verification

- Ran the original `/tmp/mavya-test-mutations.py`: the first six mutations still fail. It then stops at its assertion that the old component-local race exists, because that expression moved. This is an obsolete harness target, not a test failure or a surviving mutation.
- Retargeted the five moved/shared mutations in `/tmp/mavya-round2-mutations.py`, preserving the original mutation intent and restoring each file in `finally`. All five exit **1**:

| Mutation at its current location | Observed assertion failure |
| --- | --- |
| Remove `late` from `pending-runs.pageLoad`'s race | “at 2 s it loads the usual way and shows that” |
| Remove both `dropLoad(id)` calls from `changeRun` | “dropped before the save” |
| Replace the insertion shift with `cur.sounds` in `edit-ops` | Blue's sound remains at 6–9 instead of moving to 12–15 |
| Force pasted sounds to row zero in `selection` | “copied rows get new rows of their own (0,0)” |
| Silence the second stretched-audio channel | Expected right-channel mean −0.25, measured 0 |

- Repeated the never-settling `startCreate` mutation with the actual 60-second watchdog, allowing more than 60 seconds for the child process. See the final result below. The old auxiliary harness's 15-second subprocess limit is too short to observe this watchdog and must not be mistaken for a successful watchdog test.
- Direct `finish` probes verify wrong count, explicit early `process.exit(0)`, and unresolved work all exit **1**; successful work with the expected count exits **0**. Shortened only the probe's supplied timeout to 100 ms. The actual speed suite expects **30**, not the historical 21 in the supplied description.
- Baseline `npm test`: **38 caption + 33 editor + 30 speed + 112 sound/queue checks passed**. The frame suite then failed with `spawnSync .../ffmpeg EPERM`, including child `status: 0`, in this restricted environment. I do not report a fresh 602-case pass here; the supplied pass remains Claude's evidence.
- `npx tsc --noEmit --incremental false`, browser-script syntax check and `bash -n scripts/browser/run.sh` passed. No new build or lint claim. Browser checks were inspected, not run, as requested for this socket-restricted sandbox. The supplied 29 passes and rename-disconnection failure were not independently reproduced.

### Remaining browser acceptance blockers

**B1 — P2: “New video opens at once” does not test navigation while creation is pending.** `scripts/browser/editor-browser-checks.mjs:161-175` times navigation against an unthrottled local POST and accepts anything below 1,500 ms. A regression that awaits a fast POST before navigating can satisfy both assertions. The later interception tests a failed create; it does not establish navigation before successful creation completes. Repeated clicks also restart the timing and can hide the first unresponsive click.

Required check: intercept and hold the creation POST before its response, click once after explicit hydration/readiness, assert navigation to that exact requested ID and visible loading feedback **while the response remains held**, then release it and assert the editor displays that run. Mutation acceptance: restoring await-before-navigation must fail. Keep a generous bounded timeout for readiness, but establish ordering with the deferred response rather than a local speed threshold.

**B2 — P2: the sound-only Delete-button test can pass with no button, and never clicks it.** At line 134, `!document.querySelector(...)?.disabled` evaluates to true when the selector returns null. An absent button passes the check labeled “the Delete button works.” An enabled button with a disconnected handler also passes, since the script proceeds to copy/paste instead of clicking Delete.

Required check: require an existing, visible, enabled button, click it, assert both selected sound IDs disappear while clips/texts remain unchanged, then one Undo must restore both sounds. Mutation acceptance: remove the button or replace its click handler with a no-op; either must fail. The separate keyboard Delete test does not cover a toolbar button's wiring.

### Other browser assertion weaknesses to tighten

- `until` returns the last run on timeout; it does **not** fail its predicate. Some following checks omit part of that predicate. For example, lines 109–110 can pass with clips still present if texts and sounds disappeared. Make `until` throw with the last state, or repeat the complete predicate in the assertion. Do the same for unchecked `waitFor` results in setup.
- The stale-group scenario at lines 99–104 checks that four texts remain, but never confirms that a sound was added, selected and then deleted. A broken Add sound button followed by inert Delete can pass. Assert the intermediate sound and final deletion, plus unchanged original text IDs/content.
- The sound Ctrl-click case checks only that the sound is selected; it would accept replacing the text selection instead of joining it. Require both exact selected labels.
- The overlapping-sounds case checks distinct row numbers and stored ends, not full effective playback duration or allocation after existing rows. Its new shared-code unit check does cover those helper properties; add them to the browser assertion when certifying actual paste assembly.
- Fixed sleeps, coordinate/DOM-class selectors and fixed ports make the suite machine-sensitive. Prefer state-based waits, stable accessible targets and isolated ports. CDP `send`/`ev` should surface protocol errors and `exceptionDetails` explicitly instead of turning them into undefined values. The whole-script watchdog prevents a silent hang, but failures will otherwise be harder to diagnose.
- `run.sh` is explicitly WSL/Windows-specific and starts **Next dev**, not a production build. A `CHROME` override alone does not make the shell runner portable. Its startup loop should fail explicitly when readiness times out, and cleanup should kill the actual server process tree. These are runner reliability improvements, not new product release blockers.

### Extraction and repaired coverage

The components visibly use `pageLoad`, `changeRun`, `insertClipsChange` and `pasteGroupLayers`. The insertion helper preserves ordering, label conversion, text/sound shift and save payload; merging its result into the live ref preserves unchanged sounds. Paste assembly preserves rounding, layer placement, new IDs, row allocation and existing-sound shift. `changeRun` now also invalidates on a rejected work promise through `finally`, a sensible strengthening. The create outcome mapping retains pricing/failure behavior and the consumer still rejects departed-page application. No unjustified behavior change found.

The watchdog uses a real referenced timer and an exit listener, closing the original Node early-exit hole. The added stereo assertions catch the original lost-channel mutation. The chunked file test compares distinct channels over a final partial chunk against direct synthesis; it proves adapter ordering and sample agreement, not an independent oracle for synthesis itself. Both are worthwhile regression guards.

### Do the explicitly deferred gaps block this round?

| Deferred gap | Decision and required follow-up |
| --- | --- |
| Font preload/fallback checks absent from `npm test` | **Nonblocking for this extraction/test repair.** Existing repo font checks remain; fonts did not change here. Wire the applicable existing checks into the documented validation command and add current preload-policy coverage before claiming `npm test` alone covers fonts. |
| Real worker drain with arrivals during work | **Nonblocking.** The worker extraction was already faithful and its code is unchanged in this round. Add a deferred-job integration test proving one active job, arrivals during await, alternation and recovery. Pure `nextJob` tests alone still do not prove worker wiring. |
| Browser export → joined video with clip audio and distinct stereo | **Nonblocking for this round; required for a new end-to-end export certification.** The frame/server matrix and new stereo/file-adapter checks cover narrower layers. Add real browser export/decode checks for both channels and adjacent-cut audio/picture boundaries. |
| Partial-piece deletion across two clips | **Nonblocking.** Single-clip partial deletion and multi-clip whole deletion exist, and deletion logic is unchanged here. Add the combined case with magnet on/off, speed, surviving piece IDs and caption positions. |
| Regenerated-caption validity assertions | **Nonblocking assertion hardening.** Assert finite, nonnegative starts, positive duration and exact intended ownership/content. Clarification to Round 1: the full regeneration loop includes export, whose positive-duration filter means removing/zeroing that caption can already fail when the test dereferences the missing exported caption. The narrow `end <= 1` assertions are weak, but that does not mean every zero-duration mutation passes the complete suite. The standalone retime assertion remains weaker. |

These deferrals do not reopen the repaired mutation blockers or show present product defects. B1 and B2 are specific gaps in the newly claimed browser regression coverage, not a demand to cover every conceivable interaction before shipping.

Final mutation result: the actual never-settling create exited **1** with `speed-fix-checks: did not finish within 60000 ms (0 of 30 checks ran)`. The original auxiliary harness was also rerun: its hang mode reaches its obsolete 15-second Python timeout (source restored); its combined mode reaches the new right-channel assertion and fails. Its old component-target string replacements are no-ops after extraction, so the retargeted per-mutation results above are the meaningful evidence. Logs: `/tmp/mavya-round2-original.log`, `/tmp/mavya-round2-original-more.log`, `/tmp/mavya-round2-mutations.log` and `.json`. All source mutations were restored; only this report remains modified. No commit or push.

## Round 3

**Verdict: blockers — one browser-runner cleanup defect.** Reviewed HEAD `2cbcf079269fca3ac85efce423a4a17c1b684409`. The Round 2 browser acceptance blockers **B1 and B2 are closed by inspection**. No product code changed, and I found no new product defect. The new cleanup trap must be corrected before signing off `npm run test:browser` as a reliable, isolated command.

### Closed browser findings

- **B1:** the script intercepts and holds the create POST, clicks once for the measured scenario, requires exactly one held request and navigation before release, and compares the requested ID with the URL ID. After release it waits for that run in storage and the page's input/no-error state. This establishes the ordering the previous local timing threshold could not. The final DOM assertion is broad (any input), but the held-request/ID/server checks establish the essential regression guard. Explicit editor readiness and title matching would strengthen it without blocking this round.
- **B2:** the script requires the exact two selected sound labels; locates an existing, enabled toolbar Delete button with an `offsetParent`; clicks its coordinates using mouse events; waits for zero sounds; checks three clips remain; and waits for Undo to restore two sounds. Missing-button and no-op-handler cases now record failures. Checking restored IDs/content rather than only count would be useful hardening.
- `until` now records a failure on timeout before returning fallback state, so downstream permissive assertions cannot erase the failure. Delete-all repeats its entire outcome predicate. `ev` throws on evaluate protocol errors and JavaScript exceptions. Sound modifier-selection checks the exact text-plus-sound labels.
- The stale-group scenario now proves the two-text group exists, then proves a plain-picked sound is the sole active selection, deletes it and checks the original four text IDs remain. This is valid coverage of the stale-selection state. It does not certify the separate song-API/add-new-sound flow, and the report should retain that distinction.
- Server startup now explicitly fails after its readiness deadline. The redundant first seed/open in the stale-group scenario can be removed later; it does not weaken the assertions.

### R3-1 — P2: cleanup can fail a passing run and skip cleanup; process ownership is unverified

`scripts/browser/run.sh:5,9` combines `set -euo pipefail` with this unguarded EXIT trap:

```bash
pkill -P "${SERVER:-0}" 2>/dev/null
kill "${SERVER:-0}" 2>/dev/null
fuser -k 3210/tcp 2>/dev/null
rm -rf "$WORK"
```

These cleanup commands have ordinary nonzero outcomes: `pkill` when no matching child remains, `kill` when the parent has exited, and `fuser` when the port is already free after successful shutdown. Under `set -e`, the trap stops at that command. A successful browser run can therefore exit **1** and never reach `rm`. A failure path can leave processes/temp files behind as well. The old trap guarded its kill; the new trap removed that protection.

**Independent, harmless reproduction:** ran the exact trap in a child Bash with process commands replaced by functions. With `pkill` and `kill` returning 0, `fuser` returning 1 (port already free), and `rm` replaced by a marker, an initial `exit 0` became **exit 1**, and the cleanup marker never ran. A separate failing-first-command probe likewise skipped subsequent cleanup. No real process was killed in these probes.

There is also no ownership check on `fuser -k 3210/tcp`: it targets whichever process owns that port, not specifically this run's server. A port collision can make the readiness probe accept an existing `/studio` service instead of the temporary server; port-wide termination is not an isolation mechanism. The `${SERVER:-0}` fallback is also inappropriate before `SERVER` is set: `kill 0` targets the current process group.

Required repair: capture and preserve the incoming exit status; guard cleanup operations that may legitimately find nothing; always attempt temp cleanup; and terminate only this run's recorded process tree/group, never an arbitrary port owner or PID zero. Reject an occupied port or use a verified dedicated port, and ensure readiness belongs to the spawned server. A fixed port is acceptable for a serialized local harness once collisions fail safely. Add small shell regression probes for success with an already-exited server, failure before SERVER assignment, cleanup-command failure, and an occupied port (using mocks where needed). Each must preserve the original result, finish cleanup and leave unrelated processes untouched.

### Deferred limitations

| Item | Blocks? |
| --- | --- |
| Fixed sleeps and coordinate/DOM selectors | **No.** They remain potential flakiness/maintenance costs; stronger outcome assertions and timeout failures prevent the original false passes. Prefer state-based waits over time. |
| Fixed port | **Not intrinsically.** Concurrent runs may be unsupported. Unverified ownership and port-wide killing in R3-1 do block the current runner. |
| WSL/Windows-specific runner | **No.** Its documented local platform scope is acceptable; it is not a portable CI command. |
| `next dev` rather than production build | **No for these interaction tests.** Do not use their success to certify production loading/performance or hydration behavior. |
| Effective duration of overlapping pasted sounds checked only in shared code | **No.** Existing unit coverage plus browser rows/end checks provides useful layered coverage. Add browser effective-end and row-allocation assertions before claiming full playback verification. |

The Round 2 deferred font, worker-drain, full browser-export/stereo, partial-deletion and caption-validity gaps retain their nonblocking assessments for this round.

### Verification and scope

`node --check scripts/browser/editor-browser-checks.mjs` and `bash -n scripts/browser/run.sh` passed. The cleanup failure above was independently reproduced. I did not run Chrome in this restricted environment; the reported **37 passing checks** and two browser mutation failures remain supplied evidence, consistent with the inspected assertions. I did not rerun unchanged offline suites or mutate product sources for this browser-only review. Only this report was appended; no commit or push.
