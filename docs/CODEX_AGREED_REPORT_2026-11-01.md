# Agreed fixes, 2026-11-01

Branch: codex/agreed-fixes-2026-11-01, created from main 5b853c0. Exactly the four requested items are implemented. No merge, push or deployment. No migrations, dependencies, infrastructure, copy, prices or deliberate visual changes. No founder .data, .env, runs or running .next changed. Claude should verify this branch before merge.

## 1. Generation completion and unsaved edits

Implemented in src/components/run-view.tsx:232 and src/lib/generation-edit.ts:33. Completion merges the generated hook with dirty text/adjustment sections instead of replacing them. Existing generation timing rebasing remains in use. The merged state and run ref are updated synchronously before a pending debounce can save; the original pending save still runs. An adjustment-only edit still accepts the generated hook words.

scripts/verify-agreed-fixes.cjs executes the actual RunView callback initializers and actual client patch queue with controlled timers: edit, generation completion at 100 or 249 ms, original 250 ms debounce, then outgoing HTTP PATCH. Eight interleavings cover text, hook adjustment, both and demo adjustment. It deliberately omits a post-completion ref effect, verifies new generated media plus the unsaved values, and validates the resulting body with the actual run validator.

A separate actual production-browser regression reproduces lost text on main and passes after: type in the real textarea, release the existing generation poll before the debounce, then inspect visible text and outgoing PATCH. The new source and edited text both survive. This uses simulated completion, not a paid generation.

## 2. Phase timing

Implemented in src/lib/server/read-timing.ts:10 and :19. AsyncLocalStorage isolates each opted-in GET. Server-Timing contains exactly auth, account, sql and r2 duration entries. Nested phases are not double counted. Complete awaited operations include response body parsing; the test upstream flushes headers before delaying its body to verify this.

GET wrappers:
- src/app/api/profile/route.ts:37
- src/app/api/usage/route.ts:9
- src/app/api/runs/route.ts:8
- src/app/api/runs/[id]/route.ts:9
- src/app/api/references/route.ts:13
- src/app/api/assets/route.ts:7
- src/app/api/file-prefs/route.ts:8

Phase measurement points: src/lib/server/who.ts:9, src/lib/supabase/server.ts:42, src/app/api/profile/route.ts:28, src/lib/server/list-pages.ts:55 and :93, src/lib/server/store.ts:110, :179 and :431, src/lib/server/usage.ts:23 and :34, src/lib/server/billing-state.ts:21, src/lib/server/r2.ts:81 and :89.

getUser and the account check remain in place. No entitlement cache was added. No user IDs, emails, keys or SQL/query text are added to the header. No fetch body cloning or buffering was added.

Before: zero of seven handlers emitted phase timing. After: seven of seven do. Example after headers from the real-handler fixture, milliseconds:

| GET | Auth | Account | SQL | R2 |
| --- | ---: | ---: | ---: | ---: |
| profile | 14.46 | 0.00 | 15.28 | 0.00 |
| usage | 10.86 | 14.59 | 51.81 | 0.00 |
| runs | 10.07 | 13.62 | 13.80 | 0.00 |
| runs/id | 9.50 | 13.50 | 13.02 | 0.00 |
| references | 9.64 | 13.61 | 13.63 | 0.00 |
| assets | 9.69 | 13.67 | 13.45 | 0.00 |
| file-prefs | 9.91 | 13.89 | 0.00 | 36.98 |

Zero means that phase did no measured work on that path. Profile retains its existing auth-only account policy. SQL aggregates independent parallel operations, so summed phases can exceed elapsed wall time. R2 includes local signing and file-prefs transfer where used, not later browser media downloads.

Three-round median handler wall times in the controlled local fixture:

| GET | Before ms | After ms |
| --- | ---: | ---: |
| profile | 28.82 | 42.60 |
| usage | 44.02 | 50.99 |
| runs | 41.58 | 54.23 |
| runs/id | 40.47 | 49.52 |
| references | 39.23 | 49.83 |
| assets | 39.16 | 49.34 |
| file-prefs | 42.57 | 53.19 |

These samples show diagnostic coverage, not a speed gain from instrumentation. The measured after requests were slower in this run; this small sequential local sample does not isolate instrumentation overhead from host/runtime variation. No production latency claim is made.

Boundary: the wrapper attaches timing to responses returned by the handler, including returned error responses. Earlier proxy rejections and uncaught framework-generated errors remain outside it. Their behavior was not changed.

## 3. Run and selected reference

src/components/run-view.tsx:120 requests /api/runs/id?view=editor. src/app/api/runs/[id]/route.ts:9 returns the owned run plus its selected reference using the existing getRun/getReference ownership checks. A missing or inaccessible selected reference remains a 404. Legacy GET consumers keep the original run response. The editor response is private, no-store. The independent library catalog request remains.

| Measurement | Before | After |
| --- | ---: | ---: |
| Run plus selected-reference HTTP requests | 2 sequential | 1 |
| Auth calls for that pair | 2 | 1 |
| Account checks for that pair | 2 | 1 |
| Run/reference SQL reads | 2 | 2 |
| Real-handler fixture combined median | 80.67 ms | 63.25 ms |
| Browser run-page cold usable median | 562.3 ms | 453.2 ms |
| Browser run-page repeat usable median | 452.9 ms | 343.5 ms |

Handler tests cover signed out, missing run, missing/foreign reference, successful envelope, legacy shape and no legacy extra source read. No ownership predicate was weakened.

## 4a. Videos tiles

src/components/runs-list.tsx:30 adds an IntersectionObserver with a 200 px near-viewport margin. It mounts the same video element near the viewport and removes it away. No stored thumbnail, backfill or paid operation.

In the 24-run, 1440 x 1000 fixture, mounted tile videos fall from 24 to 18 at the top and from 24 to 18 at the bottom. IDs prove actual turnover: top mounts 0 through 17; bottom mounts 6 through 23. The first six unmount and the last six mount. The measured visible media rectangle is unchanged at 171.15625 x 304.265625 px. Counts depend on viewport size. Browsers without IntersectionObserver retain the all-mounted fallback.

## 4b. WholePlayer and controls

src/components/editor-tools.tsx:415 uses a per-mounted playback clock. Only dynamic leaves subscribe: WholeMedia at :602, WholeAudio at :625, WholeTransport at :1088 and WholePlayhead at :1119. WholeControls at :658 keeps its static lanes outside frame updates. AdvancedSettings uses the original AdjustmentControl markup at :2258, with only the keyframed zoom row subscribed through ClockedMotionRow at :2333. Gesture starts and toolbar actions read current clamped time when invoked.

Median render counts during matched approximately 1.2 second playback samples, including click settling:

| Component | Before | After |
| --- | ---: | ---: |
| WholePlayer | 76 | 1 |
| WholeControls | 75 | 1 |
| AdvancedSettings | 75 | 1 |

Dynamic media/audio/transport/playhead and keyframed zoom still update approximately 75 times in the sampled window. This moves frame updates out of static parents; it does not claim to eliminate video, audio or keyframe work.

The actual browser fixture checks timeline trim dragging, text editing, keyboard seek, Cut, Undo, Redo and retained editor focus. Clip counts are 2, 3, 2, 3 before Cut, after Cut, Undo and Redo in both builds. Keyframed zoom changes from 0 to 22 in both builds while static settings avoid frame renders. Existing suites cover speed, split timing, sound pieces and editor validation. Audio was muted throughout. This was not an exhaustive cross-browser gesture or audible sync certification.

## Verification and evidence

Final source passed:
- All 32 scripts/*-checks.cjs and scripts/verify-*.cjs suites.
- npx next typegen.
- npx tsc --noEmit.
- npx eslint src render, no warnings.
- npx next build, 36 pages generated.
- git diff --check.

The production build retains the existing TikTok Sans fallback-metrics warning. No unrelated font change was made.

Every suite and the release build ran in a separate physical copy with the real proxy, no diagnostic counters, no actual .env/.data, Node 22.23.4 and isolated offline fixtures. SQL tests use disposable test databases. Measurement builds separately add counters and bypass the proxy only inside their credential-free copies; those changes are not in app source.

Reproducible tools: scripts/verify-agreed-fixes.cjs, scripts/instrument-agreed-build.cjs, scripts/measure-agreed-fixes.cjs and scripts/measure-agreed-reads.cjs. Existing isolated module loaders receive an identity timing stub; their assertions remain intact. Browser measurements use three matched rounds per build, muted Chrome, 2x CPU throttling, 24 synthetic runs, 60 references and 120 ms intercepted API latency. Real-handler measurements use actual Next GETs and Supabase Auth SDK against a dummy local Auth/SQL server, with offline R2. They are different fixtures and must not be mixed as production timings.

Raw samples, headers, tile identities, render counts, errors and the real-browser dirty-edit regression are in docs/CODEX_AGREED_EVIDENCE_2026-11-01.json. Browser error arrays are empty.

## Unfinished and handoff

All four requested implementations are complete. Production/geographic latency, live authenticated service behavior, Safari/mobile parity and audible sync remain unverified. Header coverage boundaries and the slower local timing sample are disclosed above. No additional product fixes were made, and inherited audit items remain outside this branch. No new migrations or environment variables are needed.

No real account creation, paid API call, email or production data write occurred. Only silent synthetic fixture video played; no music or audible playback occurred. No merge, push or deployment was performed. Claude verification remains the next step.
