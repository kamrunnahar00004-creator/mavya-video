# Mavya launch readiness review, 2026-10-23

Reviewed revision: `5153f83` on local `main`. Feedback only, preserving the founder's explicit instruction. No application changes, commits, pushes, production writes or paid API calls were made. No Runway/Gemini request, Checkout, subscription change, email delivery or hosted render job was triggered. Tests used mocks, a muted browser and tiny synthetic local media. The unrelated untracked `scripts/fal-test.mjs` was left untouched.

**Verdict:** the connected product is materially further along, but generation accounting is not safe to leave exposed to unrestricted public use. Fix C1/H1 first, then annual allowances, billing ordering and account deletion. Passing TypeScript and ESLint does not establish those money/data invariants.

## 1. Findings ranked by severity

### Critical

#### C1. Generation GET trusts browser-supplied task/refund state and can start unlimited paid fallbacks

**Files:** `src/app/api/runs/[id]/generate/route.ts:39`, especially lines 44-61; `src/lib/server/usage.ts:60`; `supabase/migrations/0002_storage.sql:48`.

The GET handler authenticates a person but never looks up a stored generation linking that person, run and task. `fallback=1` and `gen=` are browser assertions. The existing `generations.task_id` column is never populated by recordGeneration.

**Concrete sequences, all reproduced with external services stubbed:**

1. Obtain a real failed task UUID, for example from your own earlier paid attempt. Repeatedly GET `/api/runs/<your-run>/generate?task=<failed-task>` without `fallback=1`. Each request starts another fallback, without allowance checking or recording a generation. This also works after exhausting quota or losing the plan, provided the caller owns a runnable project and knows that failed task ID. Concurrent polling can fork multiple fallbacks for one failure.
2. GET that failed task with `fallback=1&gen=<another-successful-generation-id-you-own>`. The handler deletes that independent quota row. Reuse the failed task to erase other successful charges. refundGeneration's user filter prevents deleting another user's quota, but does not bind a refund to the failed job.
3. Given another user's completed Runway task UUID, GET it as yourself, even under a nonexistent run ID. The done branch downloads that output and registers it as your media without getRun or task ownership checks. Random UUIDs are not practically enumerable; this is a missing authorization check for a known/leaked task ID, not a claim that all task IDs are discoverable.
4. Poll a completed task twice. Both requests download/save a new file and invent a fresh completion timestamp. There is no idempotent finalization.

**Smallest sound fix:** use a server-owned job record binding user, run, primary/fallback task IDs, quota reservation and terminal state. Authorize every poll against it; atomically claim the single fallback transition; ignore client refund/fallback assertions; refund/finalize exactly once and return the stored result on replay. Polling should not be an arbitrary Runway task proxy. A regex or a second allowance check alone does not fix this.

### High

#### H1. Quota check/reservation races, and database errors fail open after spend

**Files:** `src/lib/server/usage.ts:34`, `:54`; `src/app/api/runs/[id]/generate/route.ts:21` and `:29`.

**Breakage/repro:** with used=19 and Starter limit=20, send two parallel POSTs. Both see 19; both start paid work before either inserts its accounting row. The mocked route test admitted both. More concurrent requests amplify the overrun. Scene planning/frame generation can make this gap minutes long. A failed count query becomes `count ?? 0`; a failed insert becomes a null generationId and the route still returns success. An exception after a provider task started can also leave spend unrecorded.

**Smallest fix:** a database transaction/RPC reserves one unit conditionally against the correct billing window before any paid work. Fail closed on accounting errors. Bind a client request idempotency key to that reservation and persist the provider task before replying; settle or refund the reservation once. Admin bypass should still retain spend/job records.

#### H2. Yearly customers receive one year's usage window instead of monthly replenishment

**Files:** `src/lib/server/usage.ts:23`, `:38` and `:49`.

**Breakage/repro:** create an active annual Starter fixture with period January 1, 2026 to January 1, 2027 and 20 generations in January. In October, allowance still counts from January and reports reset next January. The comment at line 48 does not change the calculation. Reproduced by calling the real allowance function with a stub database. `Sub` does not even select the billing cycle.

**Smallest fix:** select cycle and calculate the current monthly allocation window inside the annual paid period, using an explicit anniversary/day-clamping policy. Use that identical window in atomic reservation and the UI reset date. Do not reset the full annual period or silently turn the offer into 20/60/150 hooks per year.

#### H3. Webhook dedupe and ordering are read-then-write, not atomic

**Files:** `src/app/api/stripe/webhook/route.ts:27`, `:57` and `:71`.

**Breakage/repro:** concurrently deliver an active subscription event at created=100 and a cancellation at 200. Both read the old watermark 0. Let the 200 upsert finish, then release the 100 upsert. Both handlers return 200 and the final row is active with watermark 100. Reproduced with controlled database promises. Equal-second events are also allowed to overwrite each other by `<=`. An error reading the current row is ignored and treated as if no row existed. Checking billing_events before writing does not serialize different events or concurrent duplicate deliveries.

**Smallest fix:** apply state/order and claim the event in one database transaction with a conditional update/lock. Handle equal timestamps by reconciliation with current Stripe subscription state rather than assuming payload arrival order. Do not mark an applicable event done if its user/state could not be resolved; distinguish a legitimate ignored event from a lookup failure.

#### H4. Billing actions can overwrite a newer webhook and rewind its ordering watermark

**Files:** `src/app/api/billing/route.ts:95`, `:104`, `:111`, `:129`.

**Breakage/repro:** action reads row watermark 10; Stripe update starts; a webhook stores a newer cancellation with watermark 200; action's save then unconditionally upserts its earlier result with timestamp 10. Mocked handler returned 200 and restored active state. Subsequent old events can now pass ordering again. `save` also ignores a returned Supabase error, so a user sees success despite an unrecorded local state.

**Smallest fix:** avoid a second unconditional state writer, or make the action write conditional on the subscription ID and row revision it read, never decreasing the watermark. Reconcile a conflict instead of overwriting it. Check database errors. A webhook confirming later is not a guarantee that another webhook will arrive after the stale overwrite.

#### H5. Time-prorated upgrades grant a full higher quota before payment and permit upgrade/use/downgrade arbitrage

**Files:** `src/app/api/billing/route.ts:98`, `src/lib/server/usage.ts:47`.

**Breakage/repro:** a paid Starter user changes to Studio within the same monthly cycle, consumes the extra 130 hooks, then changes back shortly afterwards. Code immediately grants Studio's full limit, while Stripe's `create_prorations` normally defers positive prorations to a later invoice and credits unused time on downgrade. The price difference can cover only minutes of service although the entire extra AI allowance has been spent. Default payment behavior also does not make the higher entitlement conditional on collection. This is a source/protocol finding, not a live charge test. [Stripe proration behavior](https://docs.stripe.com/billing/subscriptions/prorations), [subscription update API](https://docs.stripe.com/api/subscriptions/update).

**Smallest fix:** define an upgrade credit/payment policy and enforce it server-side. Collect and confirm the appropriate upgrade amount before releasing incremental AI allowance; schedule downgrades for renewal or prevent consumed-credit liability being credited away. Account for failed/unpaid invoices. Prices and published plan counts need not change, but time-based proration alone cannot price immediately consumed compute.

#### H6. Multiple Checkout sessions can create multiple paid subscriptions; later events can revoke the wrong one

**Files:** `src/app/api/billing/route.ts:80`; `src/app/api/stripe/webhook/route.ts:47`; `supabase/migrations/0002_storage.sql:59`.

**Breakage/repro:** before any subscription row exists, open Checkout in two tabs and complete both sessions. No per-user creation lock, session reuse or idempotency key prevents two subscriptions. With customer_email, Stripe can create separate customers. The database has one subscription row per user; whichever event wins replaces that row, without canceling the other paid subscription. Later cancellation/update of the old subscription is also applied by user_id without checking that it is still the user's current subscription, potentially removing paid access for the newer one. A temporary row-read outage is treated as no subscription, allowing the same path.

**Smallest fix:** fail closed on billing lookup errors, serialize/reuse pending Checkout per account and use Stripe idempotency. Reconcile duplicate paid subscriptions explicitly. Apply lifecycle events by subscription identity, not just user metadata, and never let an unrelated older subscription's deletion erase the current one.

#### H7. Deleting an account leaves Stripe charging and R2 customer files behind

**Files:** `src/app/api/account/route.ts:8`; `supabase/migrations/0002_storage.sql:28`, `:59`.

**Breakage/repro:** a subscribed user with uploaded/generated files presses Delete account. The only external action is Supabase auth.admin.deleteUser. Cascades delete the database rows, including Stripe IDs and media ownership records, but no Stripe cancellation or R2 deletion occurs. The customer loses the login needed to cancel; future webhook writes can fail against the deleted auth-user foreign key. R2 blobs are retained without their ownership index. No live account was deleted to establish this.

**Smallest fix:** durably capture subscription and owned-object IDs first; cancel billing successfully or retain a retryable cancellation tombstone, then delete/schedule deletion of owned blobs and finally remove auth data. Make the operation idempotent and retain only necessary audit records. A SQL cascade cannot delete Stripe/R2 resources.

#### H8. Reloading during generation can charge the customer and lose the output

**Files:** `src/components/run-view.tsx:1108`; `src/app/api/runs/[id]/generate/route.ts:30` and `:60`.

**Breakage/repro:** click Generate, wait for POST success, then reload/close the page. Task/fallback/generation IDs live only in local async variables. No persisted task is resumed; the server never writes the completed hook into the run. Closing between a done response and the browser's PATCH loses the saved hook too. Exceptions polling a permanently invalid/missing task are disguised as running; after 120 four-second polls the UI says try again with neither recovery nor a reliable refund. Navigating/altering the run while the old callback completes can apply stale input context to its later state.

**Smallest fix:** the bound durable job from C1 should own generation inputs, completion, quota settlement and run/history attachment. Reload resumes that job; a client callback should not be the only durable completion mechanism. Persist success even if the person leaves the page.

#### H9. Direct upload grants are not bound to an owner, size or immutable finalized object

**Files:** `src/app/api/uploads/route.ts:21`, `:27`; `src/lib/server/r2.ts:61`; `src/lib/server/store.ts:263`.

**Breakage/repro:**

- `finish` accepts any valid existing, unregistered media object ID matching the extension. It never verifies that this user received `start` for that ID. A mocked finish with no prior start was accepted. If B learns A's pending media ID and finishes first, B claims it; an already registered object instead hits the unique key, so this is not a demonstrated takeover of arbitrary registered media.
- Start with declared size=1, upload more than 300 MiB, never finish. The PUT signature binds type but not declared size; rejecting at finish does not remove or prevent the oversized stored object.
- Reuse the same 15-minute signed PUT after successful finish to replace content/size. The registered metadata remains stale. No content validation/checksum or finalization barrier makes media immutable.

**Smallest fix:** persist a per-user upload reservation, expected type/size, expiry and completion state; authorize finish against it. Bound the actual upload, validate HEAD/content, and finalize into an immutable key rather than leaving a reusable PUT capability on the final object. Expire/delete abandoned/rejected staging objects. UUID secrecy alone is not an ownership protocol.

#### H10. Supabase run locks do not prevent lost updates across Vercel instances

**Files:** `src/lib/server/store.ts:201`; `src/app/api/runs/[id]/export/route.ts:143`; product route line 66 and script route line 124.

**Breakage/repro:** two function instances read the same runs.data JSON. A writes `{...old, exports:[new]}`; B writes `{...old, texts:newTexts}` and erases A's export. Their in-memory runLocks are independent. The same applies to product/script completion and browser saves. Two export polls can each snapshot the same exports array before updateRun; even a same-process lock then serializes stale complete arrays, losing one export. A slow script for product A can land after product B cleared script, restoring a stale script whose refId still matches the current hook.

**Smallest fix:** merge requested sections atomically in Postgres with a revision/CAS or row lock. Append exports idempotently by media/job ID inside that transaction rather than passing a stale array. Check product/reference input revisions before applying AI results. Do not rely on a process-local promise for a distributed storage invariant.

#### H11. Exported outline/gradient styling does not match preview; hollow text disappears

**Files:** `src/lib/text-png.ts:17`, `:61`; `src/lib/text-styles.ts:21`, `:26`, `:69`.

**Breakage/repro:** export an Outline or Hollow text. The serializer transforms WebkitTextStroke into `-webkit--text-stroke`, with a second hyphen. WebkitTextFillColor and WebkitBackgroundClip have the same defect. Muted Chrome ran the actual textPng implementation against all 50 styles using Arial: Outline's PNG was byte-identical to Plain, Hollow returned null, and Chrome discarded the invalid stroke declaration. ExportButton silently filters out null PNGs. Gradient text-fill declarations are also invalid; a successful PNG decode is not proof the styling survived.

**Smallest fix:** correct the vendor-prefix conversion and compare rendered PNG pixels/bounds with preview fixtures for all style groups, especially transparent/hollow/gradient. Treat unexpectedly blank nonempty text as export failure, not silently omit it. This finding needs no UI restyling.

#### H12. Render worker can be monopolized or exhausted despite one-job-at-a-time execution

**Files:** `render/server.mjs:38`, `:49`, `:61`, `:73`, `:103`, `:126`, `:148`, `:158`; export route lines 22 and 90.

**Breakage/repro:** submit many authenticated export requests, or one job whose download/probe/ffmpeg never finishes. There is no per-user admission/concurrency limit, bounded queue, job wall-clock deadline or subprocess kill deadline. All inputs are downloaded/probed concurrently; the 600 MiB cap is per file, not per job. probe accumulates stderr without a bound. Output upload reads the whole MP4 into Node memory. PNG validation checks only three signature bytes and compressed size, not IHDR dimensions; a small compressed huge-dimension PNG can demand enormous decoder memory. The final pass opens up to 40 overlays/sound inputs, so sequential clip rendering does not prove a fixed 190 MB peak for every valid spec.

The expiry loop removes old queued jobs from the map but leaves their IDs in queue. After a long-running job, work then accesses an undefined job before its try block. An unhandled rejection can kill/stall the worker. A running job never expires. Signed inputs/output can expire while waiting six hours. Deploy/restart loses all in-memory job state.

**Smallest fix:** cap per-user queued/running exports and total input bytes/counts/dimensions, validate specs defensively at the worker, impose fetch/probe/ffmpeg/job deadlines with process termination, bound stderr, stream uploads, and expire queue entries consistently. Reject jobs that cannot start before their signed links expire. Durable job state/leases are needed for restart recovery. No destructive OOM/load test was performed; these missing bounds are directly visible in code, not a measured worst-case memory claim.

### Medium

#### M1. No-plan accounts can repeatedly spend Gemini money on product/script routes

**Files:** `src/app/api/runs/[id]/product/route.ts:29`, `script/route.ts:59`; `src/lib/server/gemini.ts:14`.

**Repro:** register without buying a plan, create your run, repeatedly POST a valid product URL; once a brief/hook is present, repeatedly POST script. Both authorize ownership but have no plan check, rate budget, caching/idempotency or output token cap. They make real paid model calls. These calls were stubbed/not executed.

**Smallest fix:** explicitly choose a bounded free onboarding allowance or require paid entitlement; enforce a per-user/time/global spend budget and deduplicate identical work. Unlimited editing is not permission for unbounded server-side AI spend. Gemini fetching the product URL is not demonstrated SSRF into Vercel's own network; the fetch is provider-side.

#### M2. Export can use unsaved cuts/settings while drawing current text

**Files:** `src/components/export-button.tsx:12`, `:49`; `src/components/run-view.tsx:105` and `:125`.

**Repro:** a save returns 400/500; press Export while SaveState is error. saved() resolves for every state except saving, so rendering proceeds with the last server copy. Separately, click Export within 250 ms of an adjustment/text commit: the run-view timer has not yet enqueued its patch, and flushRunSaves only sees the separate client queue. PNGs can be current while trim/speed/timeline is stale.

**Smallest fix:** flush the owning editor's live commit timers into one explicit save barrier, await successful acknowledgement of the exact project revision, and export that revision plus its text snapshot. Abort on save failure; error is not equivalent to saved.

#### M3. Valid text projects silently lose layers or exceed Vercel's request limit

**Files:** `src/lib/server/run-validation.ts:59`; `src/app/api/runs/[id]/export/route.ts:22`, `:51`, `:88`; `src/components/export-button.tsx:53`.

**Repro:** save 41 visible texts (API permits 200) and export: only the first 40 payload entries are considered, without warning. Oversized/invalid PNG entries are skipped with a successful job too. A pair of valid ~2 MiB PNGs already becomes over 5.3 MiB in base64 JSON, above the platform's 4.5 MB request cap, despite each being below MAX_PNG. Drawing many full-frame canvases in Promise.all also increases browser peak memory.

**Smallest fix:** reject unsupported layer/PNG counts and sizes clearly instead of dropping output. Stage PNGs with bounded direct uploads and a small manifest, or enforce an aggregate payload budget compatible with hosting. Draw with bounded concurrency. [Vercel payload limits](https://vercel.com/docs/functions/limitations).

#### M4. Client login next-path guard can redirect outside the site through control characters

**Files:** `src/components/auth-modal.tsx:19` and `:117`. The server callback's helper at `src/app/auth/callback/route.ts:5` does not have this defect.

**Repro:** `/?auth=login&next=%2F%09%2Fevil.example`. The client permits the decoded `/TAB/evil.example` because it does not literally start `//`. Browser URL normalization strips the tab; `window.location.assign` resolves it as `https://evil.example/` after successful password login or immediate-session signup. Verified with the standard URL parser; no external navigation was performed. This is an open redirect/phishing issue, not a demonstrated session-cookie leak.

**Smallest fix:** reuse the callback's parse-and-same-origin check on the client and reject controls before assignment.

#### M5. Export finalization and temporary-object cleanup depend on continued browser polling

**Files:** `src/components/export-button.tsx:33`, `:64`; export route lines 82-94, 116-156; `render/server.mjs:24`.

**Repro:** start an export and close the project tab. The worker can finish/upload, but no GET registers that MP4 or appends it to run.exports; overlay PNGs are not cleaned. After restart or six-hour job retention, the browser no longer has a recoverable job record. A putObject failure partway through the overlay loop occurs before the try/catch, leaving earlier PNGs too. URL expiry does not delete R2 objects.

**Smallest fix:** persist job/output/temp identities before dispatch, finalize idempotently via a server callback/reconciler, and expire abandoned temp objects independently of browser polling. Test any actual R2 lifecycle policy; none is defined in this repo.

#### M6. Remaining export parity limitations: glass, transformed font subsets and look ordering

**Files:** `src/lib/text-png.ts:34` and `:61`; `src/lib/text-styles.ts:43`, `:74`; `src/lib/adjust.ts:115`; `render/render.mjs:54`.

**Repros:** Glass/Dark glass use backdrop blur. A transparent text-only PNG has no underlying video pixels to blur, so it cannot reproduce the preview's backdrop blur. With a non-system font, lowercase text in Caps/Spaced asks Google for lowercase glyphs but CSS draws uppercase glyphs, which can fall back. Font download failure silently returns fallback CSS. Nonzero warmth plus contrast is ordered differently: preview applies brightness/contrast/saturation then warmth; export combines warmth with brightness before contrast/saturation. Noncommuting filters cannot guarantee identical pixels.

**Smallest fix:** serialize correct CSS first (H11); subset the actual transformed glyphs, fail clearly on missing required fonts, and align filter order with golden fixtures. For real backdrop blur, either render against video pixels or explicitly approve a supported substitute. Those visual-policy decisions were not silently made in this review. Font-specific/Safari/Firefox parity remains unverified.

#### M7. Cloud configuration silently falls back to unsafe/local behavior instead of failing closed

**Files:** `src/lib/server/store.ts:18`; `src/lib/server/usage.ts:35`; `src/lib/server/who.ts:5`; `src/lib/supabase/session.ts:16`.

**Repro:** deploy production without one R2 setting while Supabase remains configured. cloud() becomes false, store functions use .data and allowance declares the caller admin/unlimited; configured AI routes can still attempt spending while persistence fails. Without public auth settings, currentUser becomes local and the proxy bypasses auth. These are supported development fallbacks, not safe production defaults.

**Smallest fix:** validate the complete production configuration at startup and refuse service when storage/auth/accounting dependencies are absent. Permit local mode explicitly in development only. Actual production values were not inspected or changed.

#### M8. Generation setup and cold export dispatch have insufficiently defined function budgets

**Files:** `src/lib/server/runway.ts:50`, `:118`, `:171`; `src/lib/server/gemini.ts:29`; export route lines 16 and 104.

**Repro:** slow Gemini planning (up to 120 s), image generation wait (up to 180 s), source work and fallback can exceed a function's configured duration before a generation ID is recorded. Export's explicit 60 s includes all sequential overlay storage/signing and parsing, then permits 55 s just for the sleeping worker request. Five seconds of prework consumes that margin. A timeout can leave a started provider/renderer job without a returned ID; retry can duplicate it.

**Smallest fix:** keep an idempotent durable job before slow work, set measured explicit function/step deadlines with cleanup/recovery headroom, and make dispatch retriable without duplicate jobs. Verify deployed Fluid Compute/maxDuration settings instead of assuming 120 s fetch timeouts extend the function. Vercel documents 300 s default with Fluid Compute, but actual project settings were unavailable. [Function duration limits](https://vercel.com/docs/functions/limitations).

#### M9. Asset deletion can remove a profile picture still in use; large inventories weaken last-use checks

**Files:** `src/lib/server/store.ts:361`, `:168`, `:284`; `src/app/api/profile/route.ts:50`.

**Repro:** use an uploaded image as the profile avatar, then delete its My files asset. deleteMediaFile checks runs/library references, not profiles, and can unlink the avatar. Its reference check also considers only the capped first 1,000 runs and 5,000 references; an older retained project can be missed. A concurrent new reference after the check is another check/delete race. Deleting a run itself does not reclaim unlisted generated/song files.

**Smallest fix:** query authoritative references without UI listing limits, include profile use and make deletion a delayed/idempotent garbage-collection operation with a final ownership/reference check. Do not scan a paginated display API to decide whether to destroy a file.

### Low

#### L1. Past-due and API-failure settings states are confusing; Checkout confirmation can wait indefinitely

**Files:** `src/lib/server/usage.ts:29`; `src/app/api/billing/route.ts:26`; `src/components/settings-shell.tsx:98`; `billing-view.tsx:27`; `usage-view.tsx:9`.

Billing deliberately includes past_due so the customer can manage the existing subscription; usage denies new AI spend for past_due. That difference is not itself an authorization bug. But Usage can say No plan while Billing shows the plan/payment due, and failed reads become null/no subscription rather than an unavailable state. Billing's 15-try counter is local to an effect that depends on changing sub data; returned subscription objects with no live sub have null, but reload identity is stable, so ordinary null polling does terminate. If requests hang, intervals overlap; no fetch deadline cancels them. A stale successful response can also overwrite a newer reload.

**Repro:** make /api/usage fail while /api/billing returns past_due, or stall billing details/Stripe while returning from Checkout. Confirm the user is not invited into another purchase merely because state loading failed.

**Smallest fix:** distinguish entitlement from billing-management state and transport failure, bound/cancel reload requests, keep a single monotonic polling deadline and show a payment-confirmation recovery path. Do not treat a usage mismatch as permission to create a second subscription.

#### L2. Contact delivery and catalog fetches still need operational checks/bounds

**Files:** `src/app/api/contact/route.ts:31`, `:41`; `src/app/api/songs/route.ts:18`; `songs/[id]/route.ts:11`.

**Repro:** on read-only hosting without valid Resend delivery, a legitimate contact message returns 500 with the existing email fallback. It is not falsely acknowledged as delivered; however Business inquiries are lost unless the person uses that fallback. The IP rate limiter is process-local, so multiple instances/restarts bypass its intended limit. Deezer metadata/preview fetches have no explicit deadline/streamed byte budget and preview downloads buffer whole responses.

**Smallest fix:** verify actual Resend sender/recipient setup, persist delivery safely where needed, use a shared rate budget and bound external requests/response sizes. No test email or external media download was sent.

#### L3. Stale comments/default SDK/runtime assumptions obscure operational behavior

**Files:** `src/app/api/account/route.ts:3`, `src/lib/supabase/server.ts:42`, `src/app/api/billing/route.ts:16`, `src/lib/server/runway.ts:24`.

Comments still describe account data moving to storage later, the admin client as deletion-only, billing as webhook-only, and earlier four-second costs. Actual code differs. The local regression suite also emits Supabase's Node 20 deprecation warning; the render package requires Node >=22.

**Repro/fix:** compare those comments with call sites and the six-second constant; document actual writer/job/cost behavior and verify deployed Node versions. No working code needs a stylistic rewrite to correct these descriptions.

### Business/plan sanity: full usage already makes Studio loss-making

**Evidence:** `src/lib/plans.ts`; `src/lib/server/runway.ts:29`, `:171`, `:195`; `src/lib/server/usage.ts`. Prices/limits were not changed.

Checked public API pricing on 2026-10-23. Code uses Runway Veo 3.1 Fast with audio=false: 10 credits/s at $0.01/credit, so 6 s costs $0.60. Image preparation/vision adds to this; the founder's approximately $0.70 per hook is a reasonable planning scenario, not a measured account ledger. The documented image rate depends on resolution, so do not infer a precise image bill solely from the prompt ratio. [Runway pricing](https://docs.dev.runwayml.com/guides/pricing/).

| Full monthly usage | Starter, $29/20 | Pro, $59/60 | Studio, $99/150 |
| --- | ---: | ---: | ---: |
| Generation at $0.70/hook | $14 | $42 | $105 |
| Revenue less generation only | $15 (51.7%) | $17 (28.8%) | -$6 (-6.1%) |
| Annual revenue recognized monthly | $24.17 | $49.17 | $82.50 |
| Annual monthly revenue less generation | $10.17 (42.1%) | $7.17 (14.6%) | -$22.50 (-27.3%) |

Those margins exclude Gemini product/scripts, render/worker uptime, files, payment fees, support, reviews and acquisition. As an illustration, add $0.10/hook for processing/storage/other variable work plus US domestic-card Stripe 2.9% + $0.30 and Billing 0.7%. Monthly contribution then becomes about $11.66/$8.58/-$24.86 before fixed hosting/human work; the analogous annual monthly contribution is $7.27/-$0.63/-$40.50. Actual merchant country/contract fees may differ. The ten-cent processing reserve is an assumption, not an export benchmark. [Stripe pricing](https://stripe.com/pricing).

For Studio just to break even after those illustrative payment fees, all costs together must fit below about $0.634 per hook monthly, $0.530 on annual, before allocating fixed hosting or founder time. Six-second video generation alone is already $0.60 before frame prep. Unlimited exports also need abuse/concurrency protection even though legitimate repeated editing/export should stay free.

**Options with prices/150 unchanged:** stop accounting/fallback/upgrade leakage first; enforce the genuine quota; measure actual accepted-output cost and failure charges; secure a lower vendor cost for the approved six-second quality; cache/reuse unchanged preparation and generation inputs where the intended result really is reusable; explicitly budget a small loss-making pilot if that is deliberate. Do not secretly cap below 150, exploit the annual reset bug to hide cost, or add prohibited ffmpeg post-processing. Do not assume every failed/refused video is billed: use provider ledger/refund behavior; frame/planning spend may still survive a customer credit refund. Broad Studio promotion at full usage needs an explicit loss budget or a verified cost reduction, not hopeful low utilization.

## 2. Verified OK, with stated coverage

- **Signed-out guards and ordinary isolation:** proxy session validation covers the listed app/API paths; data handlers use currentUser or getSessionUser and store getRun/listRuns/updateRun include user_id. Media read requires own or explicitly shared media; foreign registered media is not openly readable through /api/media. Assets/reference ownership paths were reviewed. Generation task ownership is the major exception in C1. Songs GET relies on the proxy rather than its own handler check.
- **Curated writes:** reference PATCH now rejects curated changes unless CURATOR=1, as do review/delete controls; user references are owner checked. CURATOR=1 is machine-wide, not a user role: keep it off on the public deployment. I could not inspect that deployed flag. No client flag alone grants access.
- **RLS source:** migration 0002 enables RLS with no public policies on runs/library/media/assets/generations/subscriptions/billing_events and grants service-role access. The request's all-tables/no-policies description has a legitimate exception: profiles has own-user select/update policies in 0001. Profile queries are in server route code using the authenticated RLS client. Browser Supabase usage is auth; no direct client table reads/writes were found. Applied production policies were not queried.
- **Secrets in source imports:** all NEXT_PUBLIC uses found are Supabase URL/anon key, maintenance or curator flags. Runway, Gemini, R2, Stripe, service-role and render credentials remain server-side in inspected imports. The anon key is not a service-role key. This is not verification of the actual deployed key values or compiled production assets.
- **Stripe signature boundary:** raw request text is passed to constructEventAsync with webhook secret before event processing; missing/bad signatures return 400. Billing plan/cycle is selected from server plan/env-price mappings, not a user-supplied arbitrary price ID. Subscription period helper supports both old top-level and current item-level fields; cancel_at and cancel_at_period_end are both recognized; resume explicitly clears cancel_at. These are source checks, not live Stripe tests.
- **Retry-save improvement:** sentPatches now protects a failed patch from replaying sections already queued/sent by a newer patch on that client. The earlier review's simple stale retry overwrite is addressed. This does not provide cross-instance JSON merging, stale AI completion protection or cross-tab revisions.
- **Export authorization and SSRF boundary:** POST loads only the caller's run. inputLink permits owned/shared media, fixed library audio or restricted app-public paths; stored localVideo validation prevents arbitrary external clip URLs/path traversal through the normal run PATCH. GET verifies renderer meta.who, runId and mediaId before registration. A caller cannot simply pass another user's export job ID to claim it. Renderer download accepts HTTP(S) generally and redirects, so this relies on the trusted server-built spec/shared secret; independent host/IP validation remains defense in depth, not a demonstrated arbitrary-user SSRF through the current public route.
- **Header/path safeguards:** signed download filenames replace non-word/space/dot/hyphen characters, so CR/LF/quotes are removed before Content-Disposition; route also bounds the name. Media IDs and library shortcodes use restricted patterns. Server OAuth callback parses next against its own origin, rejects backslashes/protocol-relative paths and checks resulting origin. The weaker client helper is M4.
- **Render auth/process basics:** shared bearer secret must have >=16 characters, comparison checks lengths then uses timingSafeEqual, and all job endpoints require it. /health reveals queue/busy only. ffmpeg uses argument arrays, not shell interpolation. Request body has a 2 MB cap, input streams have a 600 MiB/file cap, and work has finally cleanup on handled completion/failure. These do not imply the missing queue/decode/time budgets are safe.
- **Timing/short-piece smoke:** actual plan/stepArgs/finalArgs rendered only synthetic red/blue 90x160 clips locally, each split into ten 0.3 s pieces at speed 2. Expected color switch was 1.5 s; output was red at 1.45, blue at 1.55/1.70. A suspected cumulative short-piece timing defect was not reproduced and is not reported as a finding. Static inspection aligns gap/piece length formulas, speed-adjusted audio, clip volume, file-time keyframe offsets and normal sound-piece bounds. This is not complete pixel/audio parity testing.
- **Cloud/local ffmpeg paths:** with cloud correctly enabled, sounds redirect to pre-extracted R2 audio; .data audio extraction is local-only. Generation uses mkdtemp under OS tmp and cleans it, while ffmpeg is now a runtime dependency and traced into generate/sound functions. No extra production ffmpeg entry point was found in src. Contact's read-only-disk failure is caught and email can still deliver.
- **Auth UI change:** immediate-session signup/password login now uses a full page load, addressing stale prefetched signed-out redirects; signup without a session shows email confirmation notice. Google uses the server callback. Live Google/email confirmation and delivery remain unverified, and the client next-path issue still needs fixing.

### Validation performed

No repository tests were modified. Temporary `/tmp/mavya-review23-*` harnesses transpiled the current route functions with explicit database/provider/auth stubs, blocking unknown imports. Confirmed fallback/refund/task replay, parallel quota admission, annual-window behavior, unreserved upload finish, concurrent webhook rollback and billing watermark rollback. They do not contact Stripe, Supabase, Runway, Gemini, R2, Resend or the hosted renderer.

Muted headless Chrome executed actual textPng plus text-style modules on about:blank, using Arial to avoid remote font fetching: 50 styles attempted, Hollow blank, Outline identical to Plain. Local ffmpeg used only synthetic colors and silence, never generated hooks. Temporary synthetic media was removed after the test.

Required checks against unchanged application code:

```text
$ npx tsc --noEmit
[no output; exit 0]

$ npx eslint src
[no output; exit 0]

$ node scripts/review-checks.cjs
[Supabase SDK warns that Node 20 and below are deprecated]
PASS: sound migration, piece/gap timing, malformed sections, storage recovery/concurrency, byte ranges, coalesced saves, bounded filmstrip cleanup
[exit 0]
```

The regression command ran with Supabase/R2 environment variables unset for that process, ensuring its store tests stayed in isolated local mode. No .env file was loaded. No deploy/build replaced the founder's running .next directory. No commits or pushes were made.

## 3. Could not verify, and why

1. **Live payment/usage/generation/render behavior:** deliberately did not create a customer/account, pay, mutate subscriptions, start hosted jobs or call paid models. No live defect reproduction consumed credits. Route mocks demonstrate control flow, not deployed database latency/SDK/account behavior.
2. **Restricted Stripe key permissions:** inspected every call: Checkout Sessions create; Customers retrieve; Subscriptions retrieve/update; Invoices list; Billing Portal Sessions create; local webhook signature verification. Stated writes on the corresponding resources plus Payment Methods read appear consistent, assuming billing documents includes invoice read. There is no explicit Price/Product retrieve, invoice-finalize/pay, refund or event-retrieve call requiring those extra permissions today. I cannot establish the actual rk_live key's resource grants, expansion dependencies or account settings from source; check sandbox equivalents and Workbench permission errors without exposing the key. Changing upgrades to immediate collection may introduce additional required invoice permissions. [Restricted keys](https://docs.stripe.com/keys).
3. **Deployed database state:** migrations and code were reviewed, not production SQL. Cannot certify applied RLS/grants, schemas, webhook subscriptions/secrets, price IDs/amounts, event history, current user balances or whether external reconciliation jobs already exist.
4. **R2/Vercel/Render settings:** did not inspect secret values or cloud dashboards. Cannot verify bucket CORS/lifecycle/public-access settings, exact six-hour/one-hour link validity in production, production curator flag, ffmpeg tracing artifacts, deployed Node version, maxDuration/Fluid Compute, worker memory/disk, region or cold-start duration. Source signs media links for one hour and export links for six hours as requested; expiry and bearer sharing are inherent to signed URLs.
5. **Full export/device matrix:** no Safari/Firefox/iOS test, Google-font network failure test, full-resolution 40-overlay memory/load test, long-media OOM test, complete keyframe/look golden-pixel suite, audio-loop boundary waveform comparison or deployed preview/download check. Those limits are disclosed rather than inferred from the small synthetic success.
6. **Actual unit costs and quality:** no vendor ledger, paid generation acceptance/retry statistics or current support/review workload was measured. The cost table is a dated public-rate scenario using the founder's $0.70 estimate, not a claim of measured margin.

No fixes or fix commits are included. The requested report is the only review-authored repository change.
