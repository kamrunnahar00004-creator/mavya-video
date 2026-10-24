# Merged production-code verification, 2026-10-24

Branch: `codex/verify-2026-10-24`, based on main `45eed4a`. Local only. No push, merge, deployment, production database writes, paid model requests, live Stripe requests or emails. No browser or audio playback. No founder runs, secrets, prices, plan limits, model constants, prompts or UI styling changed. No migrations added or modified.

Four clear bugs were fixed in separate commits. Additional verification is in `27d61de` (V3). This is not production certification: the largest remaining concerns are repeated refunded generation attempts, scheduler fairness, incomplete visual parity and rollout compatibility.

## 1. Findings, ranked

### Critical

No new confirmed Critical finding. Original C1 remains closed by the owned durable-job API and SQL settlement boundaries, within the tested cases below.

### High

**V4. An unreadable paid result could launch another paid generation. Fixed, `6b817cc`.**

- Evidence: `src/lib/server/hookgen.ts:266`, `src/lib/server/generation-jobs.ts:60`.
- Breakage: successful result-response JSON failures were converted to null, then classified as provider failure. A paid successful task could trigger the fallback, or refund a fallback attempt while losing its result.
- Reproduce: stub status as COMPLETED, then return HTTP 200 with truncated JSON or `{}`. Before the fix, checkHook returned failed; the job's failed-task branch starts a fallback.
- Smallest fix applied: transient HTTP failures, unreadable JSON and successful but incomplete payloads throw, preserving the original task for recovery. Explicit 400/422 provider errors still use the existing single fallback/refund policy. Provider-safety checks cover all these cases; generation checks cover release rather than fallback on thrown polling errors.

**V2. A deletion waiting six hours could monopolize every recovery tick. Fixed, `37f1a75`.**

- Evidence: `src/app/api/internal/generations/route.ts:17`, `src/lib/server/account-deletion.ts:44`.
- Breakage: storage-phase deletion rows were eligible before cleanup_after. advanceDeletion returned without work, while cron returned before exports or generations. One ordinary deletion could halt unattended recovery for six hours and two minutes.
- Reproduce: cancel a deletion's billing, leave its cleanup_after in the future, close other job browsers, invoke cron. Previously the waiting deletion won every selection.
- Smallest fix applied: select cancellation work immediately, but select later deletion phases only when cleanup_after is due. Existing leases and grant grace remain intact. Focused query assertion and deletion/generation checks pass. Broader fairness remains V7.

**V6. Refunded jobs have no independent generation-attempt budget. Open.**

- Evidence: `supabase/migrations/0003_generation_jobs.sql:51`, `supabase/migrations/0005_generation_task_ids.sql` (failed transition), `src/lib/server/generation-jobs.ts:46`, `src/lib/server/hookgen.ts:197`.
- Breakage: a known failure on both attempts refunds the hook allowance. Those attempts can already have spent on Gemini outfit/image work. The next unique request can reserve again because refunded jobs are excluded from usage. Product/script daily budgets do not cover this generation preparation path.
- Reproduce locally by repeatedly reserving an entitled user's job, completing paid-preparation stubs, failing both provider attempts and reserving another unique key. The existing allowance/transition code permits the cycle without an attempt cap. This is a code-path reproduction, not a measured live abuse bill.
- Smallest fix proposed: a separate atomic attempt/preparation budget or cooldown that counts refunded attempts, plus a provider-error circuit breaker. Keep advertised successful-hook allowances unchanged. Not implemented because failure thresholds and recovery policy need an explicit operational decision.

### Medium

**V1. MP4 parsing could mistake payload bytes for the movie header. Fixed, `14b085c`.**

- Evidence: `src/lib/server/hookgen.ts:227`; duration flows into `src/lib/server/generation-jobs.ts:72` and `src/lib/generation-edit.ts:18`.
- Breakage: raw indexOf("mvhd") could select compressed mdat bytes before a real moov-at-end header. A wrong duration then stretches the hook and retimes text incorrectly, or changes reference-padding decisions.
- Reproduce: an mdat box containing a fake mvhd precedes a valid moov/mvhd describing 3.25 seconds. The former parser reads the fake values.
- Smallest fix applied: walk bounded ISO BMFF boxes and inspect mvhd inside moov. Tests cover moov before/after mdat, extended-size moov, truncated input and the existing truncated v1 case. Model constants and prompts are unchanged.

**V5. Missing FAL_KEY was classified as unknown paid acceptance. Fixed, `6b3556c`.**

- Evidence: `src/lib/server/hookgen.ts:73`, `src/lib/server/generation-jobs.ts:49`.
- Breakage: falHeaders threw inside the submit network catch even before fetch ran. A configuration error became HookStartUncertain, retaining the quota and requiring manual reconciliation for a task that was never submitted.
- Reproduce: start a words-only described hook without FAL_KEY. Previously the error was HookStartUncertain despite zero requests.
- Smallest fix applied: resolve headers before entering the network-acceptance catch. Zero-network regression verifies a normal configuration error. Existing fallback then terminal refund behavior applies. Motion preparation can still spend Gemini costs before discovering a missing fal key; preflight of all required services is proposed below.

**V7. Minute cron still has strict-priority starvation. Open.**

- Evidence: `src/app/api/internal/generations/route.ts:22` through `:37`.
- Breakage: one cancellation that repeatedly errors, continuing expired-upload/provider-object backlog, or a continuous export backlog can prevent the generation branch from running. Pro improves frequency, not fairness. One tick advances at most one category/job or batch; checking an in-progress job also consumes that tick.
- Reproduce: keep one export eligible at every tick while leaving a generation reserved and all browsers closed. Every invocation returns from advanceExport before querying generations. A persistently failing cancellation blocks still earlier.
- Smallest fix proposed: fair category rotation plus persisted retry/backoff eligibility; keep each invocation bounded rather than executing all categories sequentially under 300 seconds. No speculative scheduler rewrite included.

**V8. TikTok Sans preview and export request different font weights. Open.**

- Evidence: `src/lib/studio-data.ts:64`, `src/components/run-preview.tsx:396`, `src/lib/text-png.ts:36`.
- Breakage: preview asks Google for the default 400 face, then uses CSS weight 800, synthesizing bold. Export requests the actual 800 face. Glyph widths, wrapping and appearance need not match.
- Reproduce: unauthenticated GETs to Google Fonts CSS with family=TikTok+Sans and family=TikTok+Sans:wght@800 both returned 200; their font-weight declarations were 400 and 800 respectively, with different font-file URLs. This verifies 800 availability, not pixel equality.
- Smallest fix proposed: align preview loading and export with the same intended face and approve a visual comparison. Not applied under the no-UI-styling-change rule. Existing saved font identifiers are preserved; changing DEFAULT_FONT does not rewrite saved layers.

**V9. Protocol 2 does not distinguish the old 1080 worker from the new 720 worker. Open.**

- Evidence: `render/limits.mjs:15`, `render/server.mjs:178`, `src/lib/server/export-jobs.ts:43`.
- Breakage: both workers advertise protocol 2 despite incompatible fixed dimensions. Persisted 1080 jobs cannot be redispatched to the new worker; a new 720 job sent to an old protocol-2 worker passes health but is rejected. Dispatch errors retain the job until its six-hour failure horizon.
- Reproduce: give current validJob a formerly valid 1080x1920 payload: false. After a worker restart removes its RAM record, replaying such a stored job reaches POST and fails. The reverse occurs with a 720 payload against the old validator.
- Smallest fix proposed: explicit supported-dimension capabilities or a protocol revision, plus a deliberate drain/retry policy for stored legacy payloads. Do not silently resize an old payload's PNG positions. No production jobs inspected or modified. Founder reports app and worker already match, which reduces the mixed-version window but does not resolve persisted old jobs.

**V10. Unrecognized result duration silently becomes five seconds. Open.**

- Evidence: `src/lib/server/hookgen.ts:280`, `src/lib/generation-edit.ts:18`.
- Breakage: unsupported/fragmented/invalid movie-duration metadata falls back to DESCRIBED_SECONDS for motion results too. A successful eight-second result could be stored and edited as five seconds. A zero-duration movie header is also not a useful playback duration.
- Reproduce: return a successful download without a usable movie header from checkHook; seconds becomes five irrespective of the motion input. V1 fixes common box-layout ambiguity, not every container-duration case.
- Smallest fix proposed: validate positive duration and use a bounded media probe or verified provider duration, retaining finalization for retry when duration is unknown. No fabricated duration should settle a motion result. This needs broader container fixtures and ffmpeg finalization-budget review.

**V11. Glass export still cannot blur the underlying video. Open, original M6.**

- Evidence: `src/lib/text-styles.ts:43`, `src/lib/text-png.ts:71`, `render/render.mjs:133`.
- Breakage: backdropFilter inside a transparent standalone text PNG has no underlying clip pixels. The renderer only overlays that image; it does not blur video behind the glass region.
- Reproduce: place Glass/Dark glass text over a detailed moving clip and compare preview with an export. The architecture cannot reproduce the preview backdrop. This pass inspected that path; it did not run a browser pixel comparison.
- Smallest fix proposed: carry a backdrop-region effect into rendering or approve a visual alternative. Neither implemented because both change visual behavior.

### Low

**V12. A failed preview-font load is cached as loaded. Open.**

- Evidence: `src/lib/studio-data.ts:61`.
- Breakage: loaded is populated before the stylesheet succeeds, with no error removal. A transient failure can leave fallback text for that mounted app session while export separately loads the real font or errors.
- Reproduce: block fonts.googleapis.com on first load, restore it, then call loadFonts for the same family/subset. No replacement link is created.
- Smallest fix proposed: mark success after load, clear failed entries and permit bounded retry. Deferred with V8 to validate visible behavior together.

## 2. Verified OK, with actual checks

### A. Generation

- Re-read current hookgen, generation jobs/edit/API, cron and generation migrations. Four model paths remain the requested Kling variants. All share owner/app `fal-ai/kling-video`, so the first two model segments are correct for their queue status/result URLs. fal explicitly documents owner/app queue URLs and the three states used here. [Official queue documentation](https://fal.ai/docs/documentation/model-apis/inference/queue).
- generation-checks and generation-sql-checks passed: reservation before provider work, owned task lookup, unique request replay, parallel quota exclusion, monthly windows for annual subscriptions, lease-token fencing, one fallback/refund, completion CAS/replay and uncertain-start recovery. Cron and client cannot claim the same current lease concurrently in these SQL cases.
- Temporary provider links have an owner ledger before upload and 24-hour expiry; account deletion includes staging identities. Provider-safety checks passed for ambiguous submit identity, unknown status, transient result error, unreadable/incomplete result, refusal and duration-box fixtures.
- Missing GEMINI_API_KEY fails outfitFor before a motion fal submission; image refusal/no image throws before submit. Existing orchestration uses its one fallback and terminal allowance refund for deterministic failure. It repeats preparation rather than bypassing image refusal with an unsafe frame. This is code/stub verification, not a live refusal test.
- Setup uses a shared 210-second signal, including 120-second outfit work, at most 180-second image work, ffmpeg, staging and submit. Those individual maxima are not added as independent unrestricted waits. The route stays at 300 seconds. Budget-abort and prompt-preservation checks passed. Cold-start, filesystem and provider cancellation timing remain unmeasured.
- generationPatch uses returned seconds and speed when retiming; edited text/context changes retain history rather than blindly replacing it. Described requests specify five seconds. V10 qualifies duration fallback correctness.
- A sub-three-second reference really receives a cloned last-frame hold up to three seconds, with audio removed. That input contains a frozen tail. Whether Kling reproduces it exactly requires a paid visual test; the app has no result-tail removal. It must not be represented as verified motion quality.

### B. Export

- Added and ran `node scripts/verify-export-media.cjs` against the actual render argument builders and local ffmpeg-static. It creates synthetic 720p media at 30.30 fps, renders two pieces split at 0.99 seconds, verifies red-overlay pixels at 0.1, 1.1 and 1.9 seconds and their absence at 0.5 and 1.5, renders 12 overlays together, counts exactly 60 output frames and confirms two-second nonzero audio data. It removes only its own temporary directory. No playback or network.
- The looped image inputs and shortest=1 work for those cases; they did not alter tested output length/audio. This is stronger than argument-string assertions, but not every media/frame-rate combination.
- Current route, text canvas, worker dimensions and bounds all use 720x1280. Render zoom/pan/keyframes use spec width/height; no runtime render math retains 1080x1920. Remaining references are comments, arbitrary source-resolution/adjustment fixtures or an unused exploratory script ratio. Source video can legitimately be 1080p.
- Preview size is percent of container height; export size is percent of 1280. Layer coordinates remain percentages until PNG crop positions become frame pixels. Font/style differences remain V8/V11; full browser pixel parity was not established.
- Export/upload/SQL/worker-admission checks passed: saved-snapshot gate, manifest completeness, owned temporary PNGs, one active job/user, identical-payload replay, changed-payload conflict, output recovery after worker state loss, one append and bounded cleanup. Old base64 clients fail validation instead of silently dropping text. Old workers before protocol 2 are refused; V9 covers the shared-protocol dimension gap.
- countOverlayPixels still limits summed decoded image area. Looping does not multiply this by the number of video frames, but decoder/filter queues, threads and intermediate frames add memory beyond that sum. The 32 Mi-pixel ceiling is about 128 MiB for one RGBA copy alone. No 512 MB capacity certification or 200-layer worst-case benchmark was performed.

### C. Auth continuation

- Expanded auth-next-checks to execute the actual continue/callback handlers with stubs. No-plan -> Plans, active paid -> safe next, admin unlimited -> safe next, signed-out -> login, allowance outage -> next and exchanged code -> continue all passed. Existing URL control/backslash/external destination tests passed.
- Password login and immediate-session signup perform a full navigation through continue. OAuth and PKCE email-confirm callbacks exchange code then pass through continue. Signup with no immediate session correctly waits for confirmation. Supabase redirect allowlists and the actual deployed email template remain unverified; an implicit hash-token link or token_hash template does not use this code-only callback automatically.
- SQL allowance excludes past_due, so those users go to Plans. Billing still recognizes an existing delinquent subscription and blocks a new Checkout; this is not authorization to purchase a duplicate subscription. Sending past_due users directly to Billing would be a separate UX proposal.
- Allowance outage continuing next is deliberate availability behavior, not an entitlement bypass: actual paid API admission remains fail closed.
- /auth bypasses proxy session refresh, but route handlers read cookies directly and getUser verifies via the server client. Cookie setAll can write from route handlers; callback also exchanges the code there. Skipping proxy refresh does not inherently make the session unreadable. Maintenance redirects auth routes to landing before handler execution. Real refresh-token/cookie and Google/email round trips were not performed. [Supabase SSR guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs).

### D. Fonts

- DEFAULT_FONT and each new-layer path use TikTok Sans. Explicit saved fonts are retained. Preview invokes loadFonts for visible layers; export embeds the transformed-glyph subset and errors on missing CSS/font files.
- Public Google Fonts CSS returned a real weight-800 face. This confirms availability, not preview parity; V8 and V12 remain. Browser foreignObject embedding, mobile/Safari and all 50 rendered styles remain unverified.

### E. Recheck of every original finding

These statuses concern the merged implementation and local verification, not the superseded Part 1/2 snapshots. Current source was compared with the final Part 3 status in CODEX_FIX_REPORT_2026-10-23.md.

| ID | Result on merged code | Evidence/check |
| --- | --- | --- |
| C1 | Retained | Owned generate API, generation jobs, 0003/0005; generation and SQL suites |
| H1 | Retained; V6 adds attempt-cost concern | Atomic reservation and shared usage; parallel quota SQL |
| H2 | Retained | 0003 monthly-anniversary allowance; annual/clamping SQL |
| H3 | Retained | Webhook + billing-state + 0004/0013; fresh-state lease/order/replay tests |
| H4 | Retained | billing action revision/watermark CAS; billing/SQL tests |
| H5 | Retained within supported subscription shape | billing-change; decline, collected upgrade, renewal schedule and cancel/resume tests |
| H6 | Retained, legacy links still operational | Durable Checkout identity + deleted-account event handling; billing/SQL tests |
| H7 | Retained with V2 correction | Deletion snapshot/cancel/storage/auth order + late events + grant grace; deletion/SQL suites |
| H8 | Partial | Durable generation and leases pass; V4/V5 corrected new gaps; ambiguous acceptance/manual recovery and V7 remain |
| H9 | Retained | Upload reservation/HEAD/ETag conditional copy; upload/signing/SQL suites |
| H10 | Retained within section-write model | Atomic merge/append, AI latest token/input/source CAS; review/AI/SQL suites. Same-section stale writers can still win |
| H11 | Retained serializer fix | text-png prefix and invisible-text failure; all-50-style property checks; browser pixels unverified |
| H12 | Retained bounds, capacity unverified | render limits + real local HTTP admission and synthetic ffmpeg checks |
| M1 | Retained | Product/script paid/admin admission plus atomic 30/60 UTC-day request budgets; AI/SQL suites |
| M2 | Retained | Export local timer flush + successful save barrier + saved timestamp CAS; review/export/SQL suites |
| M3 | Retained | Individual PNG upload and complete manifest; upload/export/SQL suites |
| M4 | Retained | Shared safeNext and real handler redirect checks |
| M5 | Retained with V7/V9 qualifications | Durable export identity/output-first recovery/PNG cleanup; export/SQL/worker tests |
| M6 | Partial | CSS/subset/filter fixes retained; V8/V11/V12 and cross-browser parity open |
| M7 | Retained | production-config and store/auth/R2 guards; missing-setting matrix |
| M8 | Partial | <=300-second budgets, shared setup deadline and minute schedule verified; deployed latency/capacity unverified |
| M9 | Partial by chosen retention policy | deleteAsset only unlists cloud asset; dedicated retention test. Canonical storage persists until account deletion |
| L1 | Retained | settings single-flight/deadlines/error states + billing details; settings/billing checks |
| L2 | Partial | Durable contact/shared limiter/bounded fetch checks pass; delivery credentials and automatic pending-inquiry delivery unverified/unimplemented |
| L3 | Mostly retained | Node 22 package engines and actual checks; stale Hobby comments still exist in generate/account-deletion and old reports, without runtime effect |

All 0001-0014 were additionally applied together in exact order in a fresh network-disabled PostgreSQL 16 container. Every callable mavya RPC had service_role execution and no anon/authenticated execution; trigger-only helpers correctly need no direct service-role invocation grant. An initial overly broad assertion counted three trigger helpers as missing service execute; excluding trigger return types made the callable-RPC check pass. No permission defect was found there.

A TypeScript-AST comparison matched 25 literal RPC call sites to final migration parameter names/required arguments, including generic billingRpc calls. SQL suites also exercised actual calls, RLS-related restrictions and migration replays. This does not inspect production schema drift or every possible direct-table operation.

### F. Production configuration and spending boundaries

- All 21 `scripts/*-checks.cjs` suites passed on Node 22.23.4. Suites: ai, auth-next, billing-change, billing, billing-sql, budget, config, deletion, export, generation, generation-sql, media-retention, network, provider-safety, r2-signing, render-admission, render, review, settings, text, upload.
- `npx tsc --noEmit -p .` and `npx eslint src render` passed. The final V5 change was followed by affected provider/generation/budget checks, typecheck, lint and another production build; the full 21-suite run had already passed after V1/V2/V4.
- `npx next build` passed in an isolated physical source/dependency copy under /tmp, with no actual .env or .data, leaving the founder's .next intact. All 32 pages generated. This verifies compilation/prerendering, not credentialed runtime routes. Google font downloads are public, unpaid requests.
- The built route NFT manifests each contain ffmpeg-static/ffmpeg for generate, cron and sounds. Runtime ffmpeg imports occur only in hookgen and source-audio; the latter is only called by sounds. Production sounds redirect to cloud audio rather than extracting into local .data.
- Pro cron is `* * * * *`; no Hobby schedule restored. Route maxDuration values are <=300. Cron uses timing-safe bearer comparison and rejects missing/short/wrong secrets before its database work. Actual Vercel runtime settings, cron delivery and CRON_SECRET value were not accessed.
- No src/render runtime import of @runwayml/sdk remains. It is still installed in package dependencies and referenced by exploratory scripts; removing that unused package is optional dependency cleanup. RUNWAYML_API_SECRET is not required by the current runtime generation path.
- Paid runtime entry points are generate (server reservation before hookgen), product and script (AI budget before Gemini). There is no direct client-controlled fal task/result/refund path. Cron advances existing reserved jobs and may perform their first/fallback paid submission; it is not a no-spend endpoint. V6 qualifies generation rate protection.
- production-config rejects missing auth/service-role/R2 configuration; cloud helpers assert it. No silent protected-production local .data fallback was found in the reviewed paths. Development local storage remains intentional.

#### Stripe call inventory and restricted-key resources

| Actual call | Files | Required resource access |
| --- | --- | --- |
| checkout.sessions.create/retrieve/expire | billing-state.ts, account-deletion.ts | Checkout Sessions write/read, including expire |
| subscriptions.retrieve/update/cancel | billing-state.ts, billing-change.ts, account-deletion.ts, billing API, webhook | Subscriptions read/write, including cancellation |
| subscriptionSchedules.create/retrieve/update/release | billing-change.ts, billing API | Subscription Schedules read/write, including release |
| customers.retrieve with expanded default payment method | billing API | Customers read; Payment Methods read for expanded details |
| invoices.list | billing API | Invoices read; nested expanded objects may require their read access |
| billingPortal.sessions.create | billing API | Customer Portal write/session creation; configured payment-method-update flow |
| webhooks.constructEventAsync | webhook | Local signature verification using signing secret; no remote Webhook Endpoints permission needed |

Prices are supplied by configured IDs, not retrieved through a Prices API call. No explicit invoice-pay, payment-intent create, refund, customer create or payment-method mutation API call was found; Checkout/Portal perform their own configured workflow. Adding only Schedules write is insufficient if the other resources above are missing. Verify the precise dashboard labels and dependent permissions in a sandbox; no live restricted-key probe was made. [Stripe key guidance](https://docs.stripe.com/keys).

## 3. Improvements, proposals only

| Proposal | Expected impact | Risk | Effort |
| --- | --- | --- | --- |
| Fair retry scheduling with next_attempt_at/backoff and queue-age alerts | Unattended work progresses despite one bad category/provider | Medium: needs durable scheduling/failure tests | Medium |
| Independent generation-attempt/preparation cap and provider circuit breaker | Bounds V6 losses without consuming successful-hook allowance on every failure | Medium: support/retry policy must be clear | Medium |
| Validate FAL_KEY/Gemini availability before motion preparation | Avoids unnecessary Gemini charges when submit cannot run | Low; do not block words-only described flow on unused Gemini | Small |
| Reuse a retained verified first frame/reference on fallback | Saves repeated outfit/image work and setup latency | Medium: ownership/expiry and changed-input checks | Medium |
| Operator view for uncertain jobs with audited bind/refund actions | Recovers paid requests without blind resubmission | High if task ownership or evidence is guessed | Medium |
| Capability handshake plus legacy-job drain plan | Makes worker/app rollout and restart recovery explicit | Low/medium | Small/medium |
| Align font faces, load/retry properly and cache embedded subsets | Reduces mismatch, export font transfer and repeated font failures | Medium visual-regression risk | Small/medium |
| Measure worker peak RSS/disk/time with 1, 12 and 200 overlays and long cuts | Establishes a real supported envelope and cost per export | Low for isolated test host; no live user load test | Medium |
| Consider effect baking or bounded overlay batches after profiling | Fewer concurrent decoders/filter buffers and faster complex exports | Medium/high: timing and alpha parity | Medium/large |
| Store stage timings and actual vendor cost per attempt/result | Finds setup bottlenecks and loss-making retries | Low; redact prompts/photos/secrets from logs | Small/medium |
| Retention policy and safe delayed active-account garbage collection | Prevents storage growth under M9's safe retention policy | High deletion risk without an authoritative reference design | Large |
| Monitor pending contact inquiries and deletion/billing conflicts | Prevents durable failures from becoming invisible support failures | Low | Small operational work |

The checked public [Kling Standard motion-control page](https://fal.ai/models/fal-ai/kling-video/v3/standard/motion-control) lists $0.126/second. A 4.68-second request is about $0.59 for that video stage; three seconds is $0.378 and five is $0.63. This excludes outfit inference, image swap, fallback, storage, transfer and render hosting. Therefore $0.59 is not a fixed all-in hook cost. No price/plan change is proposed in code, and no live invoice was used to validate billing increments or failure charging. Track net contribution after actual attempts, including refunded allowances, rather than multiplying only successful outputs by one headline number.

Generation's reported roughly 3.5-minute vendor time is an input assumption from the request, not a benchmark from this pass. Reusing preparation can reduce setup and fallback latency; it cannot promise faster provider inference. Preserve model/prompts while measuring before attempting broader orchestration changes.

## 4. Migrations, environment and dashboard actions

- No new migrations, environment variables or dashboard changes are required by these four fixes. Existing 0001-0014 are untouched. No production SQL was run.
- Keep Node 22.x selected on both deployment services; keep Pro minute cron and existing <=300-second budgets. Verify cron delivery with an existing safe recovery operation, not a new paid test from this pass.
- Re-enter a strong CRON_SECRET of at least 32 characters. Keep app/worker RENDER_SECRET aligned. Verify FAL_KEY/GEMINI_API_KEY and all required Supabase/R2 settings in the dashboard without exposing values in reports.
- Confirm the Stripe restricted-key resource matrix above, especially Schedules release and Checkout expire in addition to write. Keep the webhook signing secret separate.
- Before another rollout, inspect whether legacy 1080 durable jobs still exist and choose a drain/retry policy. The request reports live app and worker are already on matching merged code; that claim was not independently authenticated.
- Preserve R2 CORS/signing behavior, monitor queue age/provider expiry and define a legacy unindexed-object lifecycle. No bucket policy was installed. Monitor pending contact and deletion/billing-conflict records; no email outbox was built.

## 5. Could not verify

No paid fal/Gemini execution, image-refusal response capture, generated-motion quality, frozen-tail outcome, real MP4 samples from fal, provider billing, live Stripe mutation, 3DS/renewal/Portal end-to-end flow, restricted-key authorization, production database contents/schema drift, R2 transfer/CORS, email delivery, actual Vercel/Render runtime, production memory/disk pressure or cron delivery was exercised. Those would require live credentials, production access or prohibited paid calls.

No real browser login/email/Google round trip, cross-tab edit interaction, CSS-to-PNG font embedding, full 50-style pixel matrix or Safari/mobile parity was run. The synthetic ffmpeg test verifies rendered overlay timing and audio, not DOM/canvas rendering. A 12-layer short export is not proof that the 200-layer/180-second admitted maximum fits the worker's RAM and time budgets.

Uncertain acceptance, pre-ledger task/object recovery, same-section stale editor writes, Glass blur, active-account media retention and contact delivery operations remain explicitly unresolved where described above. Passing local suites does not close those product/operational limits.

Stop here for Claude's review. Nothing has been pushed or merged.
