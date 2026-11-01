# Full audit and speed pass, 2026-11-01

Branch: **codex/full-audit-2026-11-01**, from clean main **094d25e**. Local work only, no merge/push/deployment.

Twelve concrete defects fixed, including paid-result save races, copied-hook recovery and lost export footage. Measured work per playback frame is lower; this is not evidence that all production lag is cured. Mobile layout and same-section save conflicts remain serious.

Raw samples, API requests, render counters, source inventory/hashes and export pixels: [CODEX_AUDIT_EVIDENCE_2026-11-01.json](CODEX_AUDIT_EVIDENCE_2026-11-01.json).

## 1. Speed table: before, after, how measured

Actual Next 16 production builds in isolated physical copies, baseline versus this branch. Dedicated muted Chrome on Windows, 1440x1000, CPU throttled 2x, three samples per action. Both builds have the same diagnostic render counters and fixture-only proxy bypass. API replies are intercepted at 120 ms, with 24 synthetic runs and 60 curated references. Main UI media are synthetic 180x320 clips; the separate filmstrip test uses 720p. No dev-server timings.

Cold clears/disables browser cache. Repeat is a new document with browser cache enabled, not a retained SPA state. FP/FCP are Paint Timing entries; ready means tested controls exist, sampled at 100 ms intervals. It is not formal TTI. JS transfer includes HTTP overhead and diagnostic code in both artifacts, not a claim about the deployed bundle.

### Loads, medians

| Route / visit | FP ms before -> after | FCP ms before -> after | Ready ms before -> after | JS transferred bytes before -> after |
| --- | --- | --- | --- | --- |
| /studio / cold | 128 -> 136 | 128 -> 136 | 398.3 -> 392.7 | 243,219 -> 243,437 |
| /studio / repeat | 88 -> 80 | 88 -> 80 | 345.4 -> 350.7 | 300 -> 300 |
| /studio/&lt;id&gt; / cold | 68 -> 60 | 68 -> 60 | 372.2 -> 372.4 | 310,523 -> 310,950 |
| /studio/&lt;id&gt; / repeat | 68 -> 60 | 68 -> 60 | 339.4 -> 341.8 | 300 -> 300 |

Cached documents still execute JS. Encoded script-body bytes:

- /studio: 239,919 -> 240,137 bytes.
- /studio/&lt;id&gt;: 305,423 -> 305,850 bytes.

Three local samples and 100 ms readiness polling cannot establish a production p95 or attribute small timing differences to a fix. Repeat run readiness is essentially flat. This branch does not deliver a large bundle-size reduction.

### Interaction feedback, medians in ms

Measured from DOM click/input/pointer dispatch through two requestAnimationFrame callbacks in the real production UI. This is a conservative synthetic paint proxy, not trusted hardware input or field INP. New video measures initial feedback, not completed remote creation. Seek targets the preview slider keyboard path; drag targets the selected full-editor trim handle.

| Action | Before | After |
| --- | ---: | ---: |
| New video | 31.8 | 33.4 |
| Step 1 | 22.6 | 27.1 |
| Step 2 | 22.9 | 28.6 |
| Step 3 | 27.4 | 27.4 |
| Step 4 | 24.9 | 26.9 |
| Step 5 | 36.3 | 34.3 |
| Step 6 | 33.1 | 32.9 |
| Choose your character | 23.0 | 23.7 |
| Phone play | 31.7 | 33.2 |
| My files | 33.5 | 33.2 |
| My files Generated hooks | 23.6 | 22.8 |
| My files Characters | 21.3 | 21.2 |
| My files Demos | 20.3 | 20.2 |
| My files Uploaded | 32.5 | 33.1 |
| My files Music | 34.0 | 23.2 |
| My files Hooks | 30.8 | 33.0 |
| My files Exported | 29.1 | 19.3 |
| Edit video | 32.5 | 33.3 |
| Editor play | 31.2 | 25.9 |
| Select clip | 33.4 | 33.4 |
| Drag timeline handle | 6.7 | 14.8 |
| Select text | 33.2 | 33.4 |
| Type text | 11.8 | 13.4 |
| Seek | 26.9 | 30.6 |
| Viral library | 40.8 | 35.8 |

All recorded actions resolved; both full Chrome runs report zero uncaught browser exceptions. Small changes in this table are mostly noise. A two-frame sample cannot certify a one-frame maximum.

### Per-frame work and media

Counters are per recorded playback window, roughly **1.2 seconds** including click settling, not exact counts per second. They are render/function invocations, not component CPU milliseconds.

| Counter / window | Before median | After median |
| --- | ---: | ---: |
| Phone frame renders: RunView | 0 | 0 |
| Phone frame renders: RunPreview | 76 | 76 |
| Phone frame renders: timeline | 76 | 0 |
| Phone frame renders: soundPieces | 76 | 0 |
| Editor frame renders: RunView | 0 | 0 |
| Editor frame renders: WholePlayer | 76 | 76 |
| Editor frame renders: WholeControls | 75 | 75 |
| Editor frame renders: TextOverlay | 75 | 0 |
| Editor frame renders: Filmstrip | 0 | 0 |

RunView does not rerender every playhead frame. RunPreview, WholePlayer and ClipEditor own their clocks. WholePlayer still rerenders WholeControls; the stable onPatch callback prevents unchanged TextOverlay rerenders. ClipEditor still maps local text objects each frame at src/components/editor-tools.tsx:227. Filmstrip already has an explicit stable-value memo comparator.

The dashboard has 24 live DOM video elements for 24 generated tiles. Opening all steps and the full editor leaves six DOM videos in this fixture, plus the filmstrip module can retain up to eight detached players, with four active decoder tasks globally. These counts were not reduced. Cumulative decoder byte counters are recorded but are not decoded-memory measurements.

Separate actual 720p filmstrip test: six samples across a 192 px / 3 s strip yielded 6 distinct frames using 1 decoder element; 234.9 ms first pass, 0.0 ms cached repeat. It reads pixels through the actual filmstrip module. Normal geometry samples one frame per 32 px, capped at 80 per piece; sample times round to 0.5 s and the shared cache deduplicates. This is not 80 new decodes every animation frame. Decoded GPU/RAM bytes were not available.

### Payloads and API round trips

Compact projections happen in PostgREST selection, not only after loading full JSON. A deterministic same-record fixture through actual listPage code is 120,377 bytes full, 161 bytes for faces and 290 bytes for history. Large project, script and product context are omitted; My files keeps hook versions, demo cuts, text, sounds and exports needed for reuse. Owner filters and private/no-store behavior remain. Cards omit full analysis/recipe and fetch the owned full reference on selection. JSONB detoasting/SQL CPU gains are unmeasured.

Observed load requests: /api/profile, /api/usage, curated /api/references, /api/runs?view=summary on Videos; /api/runs/&lt;id&gt;, generation recovery GET and recent-face prefetch on a run. A library-selected run also fetches its full /api/references/&lt;id&gt; after the run. My files adds history, assets, cards and file preferences. The raw trace lists paths, methods and payload bytes. New endpoints do not eliminate required requests.

Live existing-deployment baseline used one disposable confirmed account, three samples per endpoint. Every response was 200; the user/profile was deleted successfully. No billing, upload, generation or export action. These are full response durations from this execution environment, not simulated API delays or a live after-change comparison.

| Live GET | Median ms | Samples ms | Body bytes | Server-Timing |
| --- | ---: | --- | ---: | --- |
| /api/profile | 301.6 | 1805.0, 301.6, 291.4 | 115 | not emitted |
| /api/usage | 353.2 | 570.8, 332.4, 353.2 | 162 | not emitted |
| /api/runs?view=summary | 348.2 | 410.3, 321.0, 348.2 | 2 | not emitted |
| /api/runs | 480.9 | 553.5, 311.0, 480.9 | 2 | not emitted |
| /api/assets | 307.7 | 349.4, 288.8, 307.7 | 2 | not emitted |
| /api/references?view=catalog&scope=curated&all=1 | 978.5 | 1584.5, 971.1, 978.5 | 431,669 | not emitted |
| /api/file-prefs | 515.3 | 659.7, 495.1, 515.3 | 24 | not emitted |

The first Profile response was much slower than its later samples. Without Server-Timing I cannot assign that to Auth, database, function startup or R2. The request states iad1/us-east-1; deployment region configuration was not changed or independently certified.

## 2. What made the old Etsy app feel faster

This is a source comparison with /home/farhan/listinglens at 5a70a97, not a replay of its former deployment. No Etsy call was made.

- The old dashboard assembled data on the server. listinglens/src/app/(app)/dashboard/page.tsx:52 runs entitlement, dashboard hydration and shop reads in parallel after identity verification. Current studio pages mount client components, which then fetch APIs. Loading a selected reference follows the run fetch with another fetch at src/components/run-view.tsx:118. That adds browser/server round trips.
- Old ProductCard renders a supplied image thumbnail, at listinglens/src/components/dashboard/product-card.tsx:21. Current generated tiles mount videos at src/components/runs-list.tsx:24. The 24-item browser fixture had 24 live dashboard videos. An image grid does not initialize those media pipelines.
- The old shop page dynamically imports its editor/dialog at listinglens/src/components/dashboard/shop-home.tsx:27. The new run page also splits its editor, but warms that chunk after 300 ms and retains opened steps. Playback clocks, timeline geometry, frame extraction and synchronized media are substantial additional workloads.
- Old navigation feedback starts in click capture at listinglens/src/components/nav-progress.tsx:58. The new app has immediate navigation feedback too. Immediate feedback and completed database work are different measurements.
- The old dashboard uses sized image thumbnails and batched signing. My files used full run JSON and recipe-bearing reference lists. This branch trims those reads without caching private histories.

These explain plausible differences. They do not establish that the old database, region or production p95 was faster. No matched historical trace exists.

## 3. Bugs fixed, with file, line and scenario

| ID | Scenario and fix | Evidence |
| --- | --- | --- |
| F1 High | A stale hook save reads before generation completes, then writes after completion, erasing the paid result despite the HTTP guard. Put missing-generated protection under the database row lock | supabase/migrations/0018_preserve_generated_hook.sql:6. Real PostgreSQL fixture writes a completed 4.737 s hook, then the stale pre-generation snapshot. Clip, timing and later text remain, only hook words change. Foreign owner returns no row; migration replays twice |
| F2 Medium | Two My files preference requests read the same R2 JSON and overwrite each other. Add conditional writes with up to five reread/reapply attempts; serialize local changes | src/lib/server/store.ts:455, src/lib/server/r2.ts:34, src/app/api/file-prefs/route.ts:25. Tests cover conflicts, create-only writes, removal and non-conflict errors. Missing object version fails closed |
| F3 Medium | Account deletion leaves prefs/&lt;user&gt;/files.json, containing seller-provided names and file identities | src/lib/server/account-deletion.ts:53. Delete this deterministic object strictly after grant grace and before auth removal. Storage failure blocks removal; retry is idempotent |
| F4 High | An owned reused output depends on the donor's generation row for duration. Donor deletion can make the recipient retry forever | src/lib/server/generation-jobs.ts:61, :93, :104. New task identity carries duration as cache/&lt;seconds&gt;&#124;&lt;job&gt;. Existing SQL grammar accepts it. A removed donor lookup still completes with no provider start/poll. Older cache&#124;&lt;job&gt; identities remain supported. Account closing is rechecked before falling through to paid setup |
| F5 Medium | Pasting a product URL invokes Gemini before Analyze is clicked | src/components/product-step.tsx:183. Removed paste-to-analyze. Paste edits the field; Analyze/form submission remains explicit. Fixture loads, step/tab changes, chooser and editor openings invoke no AI |
| F6 Medium | Pending blob URLs survive cancel/unmount; after the first batch error later files keep transferring behind disappeared tiles | src/components/editor-tools.tsx:1891, :1949, :1964. Track/revoke URLs, abort on unmount/failure, preserve the original error. Existing filename ordering and three-transfer admission remain. Already accepted files can remain in My files; cancel is not rollback |
| F7 Medium | Uploaded-hook analysis waits forever for metadata/seek, or throws while leaving a detached decoder loaded | src/lib/analyze.ts:6, :41. Bound event waits, avoid a decoded no-op seek, pause/unload in finally. Injected media error verifies listener removal and decoder teardown |
| F8 Low | MediaVideo repeatedly attempts forbidden canvas reads on ordinary storage playback; scheduled captures can outlive the source | src/components/media-video.tsx:6, :17, :38. Ordinary playback uses decoded frames or supplied posters without a second pixel video. Capture is limited to CORS-readable/blob/data sources; frame callbacks and timers are canceled. pixelLink remains the analysis/filmstrip path |
| F9 Low | A new generated caption rounds 4.737 s to 4.7 s | src/lib/generation-edit.ts:30. Preserve milliseconds; regression expects 4.737 |
| F10 High | Independent intermediate-frame rounding accumulates across short cuts; final-duration trimming removes later content | render/render.mjs:86, :108, :150. Quantize cumulative boundaries, enforce intermediate fps and normalize joined timestamps before overlays. Real 720p reproduction: ten 50 ms pieces; source final pixel red [253,0,0], before export black [0,0,0], after red [253,0,0]. After intermediates alternate 2/1 frames, totaling the final 15. Existing 60-frame, 30.30 fps, overlay and audio checks pass |
| F11 Medium | Script preparation buffers up to five 300 MB product files before discarding files outside its 12 MB inline budget | src/app/api/runs/[id]/script/route.ts:63. Check owned media size before download and skip files that cannot fit. Regression proves a 300 MB file is not downloaded. Final byte-budget enforcement remains |
| F12 Medium | Picking an owned hook from My files can fetch its full reference but fail to insert it because it was absent from the curated page list | src/components/run-view.tsx:357. Insert the fetched full reference instead of mapping only existing entries. A fixture executes the actual extracted pick handler with an owned partial reference, verifying recipe retention and selected-source identity |

R2 evaluates conditional writes atomically at storage, which is why F2 works across function instances rather than just one Node lock. [Cloudflare R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/).

Performance changes also project recent faces, My files history and reference cards at the database boundary, memoize unchanged preview timeline/sound data, and stabilize text-edit callback identities. No private history or entitlement cache was added.

**Deployment dependency: manually apply migration 0018 before deploying the app. Deploy the changed Render worker too; app-only deployment does not fix F10.** No existing migration was edited. Prices, plan contents, auth rules, generated-hook prompts/models, text styles and output resolution remain unchanged. F10 changes composition/export rendering, not post-processing of generated hooks.

## 4. Bugs found but not fixed, ranked by what a paying customer would hit first

| Rank / severity | File and scenario | Next step |
| --- | --- | --- |
| 1 High: narrow-screen usability | src/components/app-shell.tsx:8. At 390 px, WebKit measures a 142 px main area because the sidebar stays 212 px wide. No document overflow does not mean usable content | Responsive navigation/editor design plus physical iPhone testing. I did not hide navigation or change the look to claim a mobile pass |
| 2 High: incomplete save conflict model | src/lib/server/store.ts:234 and supabase/migrations/0008_atomic_runs_ai.sql:19. Two tabs save whole demo/text/sound sections; later snapshots win. F1 protects an absent generated result only. A stale save carrying an older generated clip can still replace a newer one, because intentional My files replacement uses the same operation | Section revisions or mutation intents, server CAS and client reconciliation. Blind deep merge corrupts deletes, Cut/Undo and ordered arrays |
| 3 Medium: completion replaces dirty local edits | src/components/run-view.tsx:232, :238. A generation response replaces hook/text state while a text/adjustment edit can still be in its 250 ms debounce window | Source-level race, not a full authenticated race replay. Reconcile completion against dirty local sections and server revisions |
| 4 Medium: indefinite recovery | src/lib/server/generation-jobs.ts:110 and src/lib/server/hookgen.ts:276. Older cache tasks with deleted donors cannot recover their duration. Successful-but-incomplete provider output or unmeasurable duration can retry indefinitely | New reuse tasks are fixed. Old records and ambiguous paid results need support settlement/age policy; never automatically respend or refund unknown accepted work |
| 5 Medium: recent characters omit older edited runs | src/components/run-view.tsx:1334, src/lib/server/list-pages.ts:64. One 24-run page is ordered by creation, then sorted by updatedAt in the browser | Add bounded actual-recency query and matching cursor. Compact projection preserves existing behavior, not global recency |
| 6 Medium: script input CAS omits notes/photos | src/app/api/runs/[id]/script/route.ts:189 and supabase/migrations/0017_ai_input_cas.sql:19. A script can finish with old notes/screens while product/source still match | Include all semantic prompt inputs in CAS. Decide how to disclose a stale script until explicit Send; do not run AI automatically |
| 7 Medium: deletion disclosure versus retention | src/lib/server/store.ts:390 and src/app/privacy/page.tsx:37. Removing an asset unlists it; canonical cloud media remain until account deletion | Align disclosure or design transactional reference-aware reclamation. Retain the safe ownership ledger |
| 8 Medium: interrupted drag/inactive UI lifecycle | src/components/run-view.tsx:1791, src/components/run-preview.tsx:64, src/components/editor-tools.tsx:752. Opened steps retain media. Many pointer listeners clean up on pointerup, with no pointercancel/unmount path | Shared drag lifecycle and inactive-player policy. F6/F7/F8 fix particular leaks, not every listener |
| 9 Medium: plan promises exceed automatic fulfillment | src/lib/plans.ts:35, :46 and supabase/migrations/0008_atomic_runs_ai.sql:53. Unlimited scripts meet a 60/day budget; no plan-specific provider queue priority found. Reviews/consultancy need actual manual fulfillment | Founder decision on fulfillment/disclosure. Prices/features were deliberately not changed |
| 10 Medium: production latency lacks phase timing | src/lib/supabase/server.ts:48 and src/components/run-view.tsx:118. Live reads perform identity/account/data work, sometimes followed by another browser fetch. No live Server-Timing header | Instrument Auth, SQL, R2 and serialization. A fixture's artificial reply delay is not database timing |
| 11 Medium: remaining large buffers | src/lib/server/hookgen.ts:291, src/lib/waveform.ts:10. Provider results and waveforms buffer whole bodies; upload bounds do not bound all external or decoded allocations | Bounded streams and decoded-duration budgets. F11 only closes oversized screenshot discard |
| 12 Low/operational: availability/support | src/lib/server/store.ts:326 maps media lookup errors to missing; contact inquiries can stay pending without an outbox; some handlers rely on framework 500s | Keep fail-closed ownership, distinguish unavailable from missing, monitor pending contact/deletion/conflict/uncertain work |

lastProduct was rechecked at src/lib/server/store.ts:187. Cloud mode orders by product.at through a JSON path; carried copies deliberately receive a new at. I did not reproduce a malformed live query. Read failure permits creation without carried context; globally latest product during concurrent creation remains a data-model/policy limitation, not a silent rewrite.

Generation admission retains atomic refund/admission migration 0015, not just the TypeScript precheck. Replays and accepted work do not mean fresh starts. Expired starting leases become uncertain; running leases can be reclaimed. New reuse task grammar is tested against PostgreSQL. Closing-account snapshots include deterministic generation output identities, including copies in flight. A reuse failure can still select normal paid generation under the existing Generate click; cache hits are not guaranteed.

No new cross-user read or unsigned paid-action bypass was demonstrated. Gate inventory exercises 38 API methods against five personas, 190 decisions. Focused suites cover owners, RLS/service-only RPCs, checkout ownership, event order/replay, allowance, deletion and grants. These do not certify every production configuration. CURATOR=1 remains a deployment-wide trusted capability.

The 97 hooks without recipes and uncalibrated contrast/temperature/exposure points remain explicitly accepted limitations. No recipe-generation or calibration spending was started.

## 5. Speed work left, ranked by gain against risk

| Priority | Work | Gain / risk / infrastructure |
| --- | --- | --- |
| 1 | Instrument server phases and remove authenticated load waterfalls | High likely gain against measured 300-1,000 ms reads. Time Auth, closing-account check, allowance, SQL, R2/signing and serialization without personal/secret headers. Server-seed or combine run plus selected source after the same authorization; parallelize independent reads. Measure production p50/p95. Do not cache entitlement or weaken getUser |
| 2 | Persistent owned thumbnails, images instead of video tiles | High likely decoder gain: 24 generated tiles create 24 videos. Derivatives need ownership, immutable revision keys and deletion coverage. Use explicit upload/generation completion or maintenance, not AI on list GET. Storage/worker cost and safe fallback required; no paid backfill run |
| 3 | Separate static lanes/settings from playhead | WholePlayer/WholeControls still render about 74 times in the roughly 1.2 s sampled playback window. Text overlays are now stable. ClipEditor also recreates local text objects. Medium implementation risk: preserve drag callbacks, Cut/trim/Undo, keyboard focus, speed, text and sound |
| 4 | Responsive navigation/editor plus inactive media policy | High value for mobile visitors. Physical Safari/iPhone, touchcancel, backgrounding and memory pressure tests. More than an overflow patch |
| 5 | Query/index work based on real plans; complete recency | My files still loads three sources because tabs/counts need them. Payload trimming is not zero requests. Consider bounded combined summaries and updated-time recency. Production EXPLAIN first. Recency or section-CAS work may need migrations |
| 6 | Region choice from customer geography | Keep compute and primary database together until a matched test justifies moving both. Japan functions plus Virginia Postgres can add trans-Pacific trips per query. Supabase region change requires a new project/migration, Auth/config/callback/webhook cutover and rollback. Budget/geography unmeasured; no hosting change made |
| 7 | Edge reads for curated data only | Could improve the roughly 979 ms live catalog. Publication/auth boundary, link lifetime and curator invalidation must be explicit. Never share-cache owned rows, profile, preferences or allowance. Existing curated client-cache safeguards remain |
| 8 | Upload resumability if failures justify it | Direct PUT already avoids proxying video through Vercel; batch concurrency is three. Multipart helps interrupted large clips, not every upload. Needs signed parts, validated completion, abort/expiry cleanup and retry identity. No client transcode |
| 9 | Remove cosmetic reuse wait only if policy changes | REUSE_SHOW_MS=3500 delays copied results intentionally. UI reacts immediately, but completion is not delivered as fast as storage permits. Kept the approved experience |
| 10 | More virtualization/preloading only for a measured target | Progressive curated cards already exist. A My files code-warming trial did not show repeatable click gains and was removed. More preloading can increase parse/transfer contention |

Compute placement near data is Vercel's recommendation, not a universal fix from moving one component. [Vercel regions](https://vercel.com/docs/functions/configuring-functions/region). Supabase documents creating a new project and migrating to change region. [Region change](https://supabase.com/kb/troubleshooting/change-project-region-eWJo5Z), [migration guide](https://supabase.com/docs/guides/platform/migrating-within-supabase).

## 6. Anything unsure, unfinished or unverified

- This does not certify an instant app. A universal one-frame target, real-user INP, production capacity and all media/browser combinations are not established.
- Production reads were measured on the existing deployment, not a deployed version of this branch. No live after-change server claim, SQL EXPLAIN or production write-flow matrix.
- Server-Timing phase breakdown, formal TTI and decoded GPU/video-buffer memory remain unverified. Readiness, FP/FCP, JS transfer, render counts, video elements and frame extraction are separate measurements. A decoder byte counter is not RAM.
- WebKit on Windows exercised desktop and mobile emulation. It is not branded Safari, a physical iPhone, touch hardware or iOS memory testing. Linux WebKit initially lacked host libraries; Windows WebKit ran successfully.
- Real exports use synthetic media and actual local ffmpeg/render arguments. Focused checks cover output frames, text PNG timing and audio data, not browser-to-hosted-worker parity for every font/keyframe/adjustment/mix. Negative contrast and intermediate Temp remain uncalibrated.
- No fal/Gemini, Stripe payment/refund/replay, email, paid hosting change, real media upload or deployment. Live testing created one disposable confirmed Auth user/profile, signed in for 21 reads, then deleted it successfully. No founder run/media changed; no session/credential persisted in this report or repo.
- Baseline inventory: 152 src files, 6 render files, 17 migrations, 80 scripts, excluding dependencies. Inventory/cross-cutting searches cover the trees; deep review focuses on the runtime/security/interaction paths in the request. Curation/provider experiment scripts were not executed because they can scrape, spend or mutate data. This is not line-by-line semantic proof of every historical utility, or absence of all bugs.
- Reproduced failures, source-level races, policies and untested behavior are distinguished. Remaining items are not called fixed because tests pass.

### Verification and handoff

Final functional files were checked in a separate physical copy without the founder's environment, data or running Next build. Git history was provided only for the historical prompt fixture. Measurement copies alone bypassed the proxy and added counters; neither is in app code. Suites use explicit network/provider stubs and isolated PostgreSQL containers.

    21 scripts/*-checks.cjs        PASS
    10 scripts/verify-*.cjs        PASS
    npx next typegen             PASS
    npx tsc --noEmit             PASS
    npx eslint src render        PASS, no warnings
    npx next build              PASS, 36 generated pages
    git diff --check            PASS

The build retains the existing TikTok Sans fallback-metrics warning; fonts were not changed to hide it.

New regression coverage includes preference conflicts, owner-scoped projections, decoder failure cleanup, oversized screenshot preflight, millisecond text, donor-independent reuse, task grammar, atomic stale-hook protection and short-piece real exports. Existing billing/auth/generation/upload/export/security checks remain clean.

Manual drivers: scripts/measure-full-audit.cjs, scripts/measure-audit-webkit.cjs, scripts/measure-audit-filmstrip.cjs, scripts/measure-export-quantization.cjs and scripts/instrument-audit-build.cjs. WebKit was installed outside the repo; no dependency/lockfile changes.

Review the branch. Manually apply 0018, deploy the app and changed Render worker, then repeat authenticated timings and physical-device checks. Nothing pushed, merged or deployed.
