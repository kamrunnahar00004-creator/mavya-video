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
