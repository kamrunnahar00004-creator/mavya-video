# Claude fixes verification, 2026-10-24, Part 2

Reviewed `03702c3` and the request in `docs/CLAUDE_FIXES_FOR_CODEX_2026-10-24.md`. Branch `codex/verify-2-2026-10-24` started from main `b0fa4d0`. No push or merge. No paid calls, production database writes, live Stripe/Resend calls, browser playback or scraping. No changes to prompts, models, prices, plan limits, UI styles, migrations, .env files or founder data.

Two bounded fixes are committed. Claude's changes improve the earlier findings, but V7 is not a guarantee of completion under 300 seconds, and a cap checked outside reservation is not a strict transactional cost bound.

During this review, main independently advanced to `1c20bcc` (Pricing sign-in/checkout changes). That commit is not on this branch, was not changed here, and is outside these verification results. In particular, auth assertions below concern the requested pre-1c20bcc snapshot, not the newest live sign-in destination.

## 1. Findings

### Critical / High

No new confirmed Critical or High finding in the reviewed delta. The known concurrency allowance in V6 remains a financial exposure, explicitly accepted in Claude's request; it is not newly described as a strict ten-attempt bound.

### Medium

**P2V1. The failure cap blocked idempotent reservation replay and counted the wrong event window. Fixed, `480bc87`.**

- Evidence: `src/lib/server/generation-jobs.ts:28`, `:30`.
- What broke: at ten refunds, reserveGeneration returned attempts before the reservation RPC could return an already reserved job. Retrying a lost POST response could return 429 although the job already existed. The query also used created_at, so jobs created more than 24 hours earlier but refunded recently were excluded from the recent-refund cap.
- Reproduction: stub ten recent refunds and an owned existing request/run job, then repeat its POST key. The old helper returns no job. For the window defect, create the job 25 hours ago and refund it now; the old created_at predicate excludes it.
- Smallest fix applied: at the cap, return an owned same-run/same-key replay or already active job before rejecting new work. Both lookups retain owner/run predicates, and they create no new reservation. Count the rolling 24-hour window using refunded_at. Successful-hook plan allowances, the threshold of ten and admin exemption are unchanged.
- Checks: new `verify-claude-fixes.cjs` covers below-cap admission, at-cap rejection, owned replay without another reservation, refund timestamp filter, count-error propagation and admin exemption. The initial replay assertion failed before the fix. Existing SQL owner/lease/quota tests still pass.
- Qualification: this preserves the existing policy that active work may continue after admission limits are reached. GET polling already continued such work. The cap is not applied to recovery of a previously accepted request.

**P2V2. Duration probing still allowed invented five-second or zero-second completion. Fixed, `bc6f9e5`.**

- Evidence: `src/lib/server/hookgen.ts:252`, `:282`, `:294`.
- What broke: a valid mvhd with zero duration skipped probing because zero is not null. If both header parsing and ffmpeg probing failed, checkHook still returned done with DESCRIBED_SECONDS. That silently settled an unmeasured motion result at five seconds, preserving the main part of V10 despite its new probe.
- Reproduction: provide a zero-duration movie header; previously seconds was zero and ffmpeg was not called. Or return a download with no usable header and ffmpeg stderr containing Duration: N/A; previously seconds became five.
- Smallest fix applied: treat nonpositive header duration as unknown. Use ffmpeg when needed, and throw if duration remains unavailable. The existing polling catch releases the lease and retains the original paid task; it does not start a fallback or refund a result merely because measurement failed. Described-hook request duration remains five seconds, with no model/prompt constant changes.
- Checks: provider fixtures cover valid-header fast path, zero-header probing, a measured 7.25-second result, unreadable stderr and timeout-like failure, plus finally cleanup. `verify-export-media.cjs` also creates real local media, zeros its movie-header duration, and executes actual checkHook/ffmpeg with HTTP stubbed. It measures the real two-second length from the remaining container metadata. No provider traffic or playback.
- Qualification: an unreadable result now remains pending instead of being falsely settled. A terminal age/support policy remains open, just like successful-but-incomplete fal payloads. This fix does not invent a refund deadline.

**P2V3. Cron error continuation can exceed the combined 300-second budget. Open.**

- Evidence: `src/app/api/internal/generations/route.ts:54`, `src/lib/server/work-budget.ts:6`, `src/lib/server/export-jobs.ts:41`, `src/lib/server/account-deletion.ts:33`.
- What breaks: the loop can try all five categories after failures. Each operation has its own timeouts, but the route has no shared deadline or remaining-time admission check. A later generation can start its full setup after earlier slow failures consumed most of the invocation. A killed starting job can become uncertain after its lease expires, even when no fal submission happened yet.
- Concrete reproduction run: execute the actual route with a fake clock, starting with the upload category. Three preceding steps each consume a simulated 70 seconds then throw; generation consumes 210 seconds and succeeds. The handler returns 200 after a simulated 420 seconds. No wall-clock delay or external I/O was used. On a 300-second deployment the invocation cannot complete that schedule.
- Smallest safe fix proposed: propagate a shared invocation deadline into recovery operations and decline to start an expensive step without enough remaining time for its work and durable settlement. Fast failing categories may still fall through. Stripe and the polling probe need their own remaining-time handling too; simply racing a promise against a timer would leave paid work running and is unsafe.
- Why not patched here: enforcing this correctly crosses deletion, export and generation workflows. A superficial timer or changing maxDuration would not establish safe cancellation. The rotation itself is retained and tested rather than replaced with an incomplete timeout fix.

### Low

**P2V4. The font fallback cannot distinguish unsupported weight from transient stylesheet failure. Open.**

- Evidence: `src/lib/studio-data.ts:70`, `:87`, `src/lib/text-png.ts:36`.
- What breaks: any link error, including a transient network error, switches preview to the default face. If that fallback succeeds, the family stays cached and weight 800 is not retried in the same app session. Later export can successfully fetch the real 800 face, reintroducing the face mismatch under this failure sequence.
- Reproduction: call loadFonts for TikTok Sans; fire the 800 link's error callback, allow the default link to succeed, then call loadFonts again. No new 800 link is created. The new DOM fixture exercises the same fallback/cache mechanism. Full browser pixels were not compared.
- Smallest fix proposed: distinguish an actual unsupported-weight response from transient load errors, or retry the intended weight after transient fallback with an explicit shared face-selection policy. Do not infer HTTP 400 from a link error alone. Deferred because this affects visible font fallback behavior, which this review must not change.

## 2. Direct answers to Claude's questions

### 1. Rotation, fairness, budget and HTTP status

The modulo arithmetic is correct. With all categories ready and one invocation delivered each minute, deletion, upload cleanup, provider cleanup, export and generation each get the first opportunity once per five minutes. A stuck category no longer always precedes every other category. Tests execute all five first positions, an error followed by successful work, all errors, no work and unauthorized access.

This is category fairness, not guaranteed item completion or an SLA. Missed ticks can skip a category's first opportunity. Multiple minute invocations may overlap, and a selected row can lose its claim race to another worker; the wrapper then reports success even if the advance function found nothing to claim. Existing per-job SQL leases remain the protection against concurrent advancement. Per-category poison rows and queue-age monitoring still matter.

The aggregate time budget is not correct in the general slow-error case; see P2V3. The static <=300 check only confirms configuration and existing stage-budget tests, not total route runtime.

Returning 200 after some useful progress despite another category's failure is reasonable for a partial-progress cron. Returning 503 when a step failed and none progressed is also reasonable. It does not arrange an immediate retry: Vercel documents that failed cron invocations are not retried, and that delivery may be missed or duplicated. The next scheduled tick is a separate invocation. Alert on the logged category failures and job ages as well as HTTP status; otherwise a repeatedly failing category can be hidden behind successful work elsewhere. [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

### 2. Count-query failures blocking generation

Throwing a count-query error and returning 503 before a new reservation/provider start is the correct fail-closed behavior for this cost control. An unavailable database should not be treated as zero failures. The outage can block a POST replay too; GET recovery of an existing job does not use the count query. The tests verify no reservation on a count error, plus the route's existing reservation-error-to-503 behavior.

P2V1 corrects the separate at-cap replay bug when storage is available. The returned count still uses an app-level read followed by the reservation RPC. Concurrent requests can exceed the threshold as accepted in the request; distinct runs can already have in-flight work when the tenth refund occurs. It is a rolling 24-hour window, not a midnight reset, and admins are intentionally exempt. A future strict budget belongs in the reservation transaction, not another JavaScript mutex.

### 3. Built-in and system fonts

The filter still excludes keys in FONTS and names in SYSTEM_FONTS before any link creation. The DOM fixture requests anton, geist, Arial and Helvetica and creates zero links. Their next/font/system rendering path was not changed by Claude's per-family logic.

For Google families actually in use, the intended first request now includes wght@800, matching export. Picker previewText remains one batch with a subset and default face. Tests verify deduplication, 800-to-default fallback, removal of both failed links followed by retry, and failed picker-batch retry. P2V4 qualifies transient fallback parity. A stylesheet loading successfully also does not prove its underlying font bytes loaded; browser FontFaceSet/pixel tests remain separate coverage.

### 4. probeSeconds cost and timeout

A local 20-second ffmpeg metadata probe is a reasonable bounded fallback stage within an otherwise timely 300-second poll. It runs only after the fast parser fails and does not render/transcode the video. The real offline test passed. It does add a full temporary-file write, process startup and disk/RAM pressure on top of a result already buffered in memory. Result-download byte size remains unbounded by this function.

The 20-second timeout alone does not guarantee the whole poll/cron finishes under 300 seconds. Provider status/result/download can consume 30+30+60 seconds before probing; ownership checks, storage, completion CAS retries and previous cron failures are additional work. The probe also does not consume the AsyncLocalStorage workSignal. P2V3 remains relevant. No cloud latency or memory benchmark was performed.

## 3. Verified changes and regressions

| Change | Result and evidence |
| --- | --- |
| V6 failure cap | Admission/error/admin checks pass with P2V1. Outside-transaction concurrency remains explicitly accepted, not eliminated |
| V7 category rotation | Actual route tested at all five minute offsets and on partial/all failures. Grant-wait deletion predicate retained. Aggregate budget remains P2V3 |
| V8 intended Google font face | 800 first request and unchanged built-in/system skip verified; transient fallback caveat P2V4 |
| V12 retry after failed font CSS | Failed primary plus failed fallback removes cache; later call retries. Failed picker batch also retries |
| V9 worker protocol | Worker health test passes with protocol 3 and size 720x1280. App requires protocol 3 before dispatch; export suite passes. No runtime protocol-2 acceptance was reintroduced |
| V10 duration | Fast header path and actual ffmpeg fallback verified, with P2V2 preventing zero/invented durations |
| Explicit 400/422 non-JSON | Added both plain-text status fixtures; both return provider failure. Explicit JSON refusal still fails; successful unreadable JSON and successful incomplete payloads still throw, preserving V4 |
| Earlier overlay change | Real 720p ffmpeg test passes for start text, 30.30 fps piece boundary, final-frame interval, inactive intervals and 12 overlays; exactly 60 frames and two-second nonzero audio data |
| Earlier auth continuation | Existing actual handler/safeNext regressions pass on this branch's requested snapshot; newer main Pricing redirect commit not included |
| Existing safety layers | All original 21 suites pass, including SQL ownership/quota/leases/CAS, billing, deletion, uploads, render admission, production config and retention |

No new model, prompt, plan or visual-style edits. budget-checks still confirms prompt/model preservation, <=300 route declarations and the minute Pro cron schedule. Built manifests include ffmpeg-static/ffmpeg in both generate and recovery routes.

## 4. Checks actually run

Node 22.23.4:

```text
All 21 scripts/*-checks.cjs                 PASS
node scripts/verify-claude-fixes.cjs        PASS
node scripts/verify-export-media.cjs        PASS
npx tsc --noEmit -p .                       PASS
npx eslint src render                      PASS
npx next build                             PASS
```

The complete suite was rerun after both code fixes. PostgreSQL suites use disposable network-disabled local containers. Service/model calls in the new tests are explicit stubs. review-checks runs with cloud-auth/R2 environment values unset and NODE_ENV=test. The production build used a separate physical copy of tracked source and dependencies without real .env or .data, preserving the founder's running .next; all 32 pages generated. Public Google-font build fetches are unpaid. The fake-clock cron experiment is a failure reproduction, not a passing budget certification.

## 5. Migrations, environment, deployment and remaining work

- No new SQL, environment variables, credentials or dashboard changes required by these two fixes. Existing migrations 0001-0014 untouched. No production migration or credential inspection.
- Keep Node 22, Pro minute cron, <=300-second budgets and matching protocol-3 worker/app. Claude reports production had no open old exports/generations before rollout; this was not independently queried here.
- The protocol change addresses the old mixed-1080/720 handshake. It does not convert arbitrary legacy payloads. Reported empty queues remove that particular cutover problem if accurate.
- Still open by explicit decision: Glass/Dark glass backdrop parity, manual uncertain-job reconciliation, stricter transactional attempt accounting and a terminal/support policy for indefinitely incomplete/unmeasurable results. No operator tool or refund-age policy built.
- Prioritize a real shared recovery deadline and remaining-time admission, then per-category failure/age alerts. Keep the accepted cap limitation visible in cost estimates. A refund allowance does not undo already incurred preparation cost.
- Browser font-byte/foreignObject rendering, live model quality/refusals, provider billing, production storage transfers, deployed cron/runtime/capacity, live Stripe/email and production database drift remain unverified. No paid test or production write was substituted for a local fixture.

Stop for Claude's review. The branch remains local and unmerged.
