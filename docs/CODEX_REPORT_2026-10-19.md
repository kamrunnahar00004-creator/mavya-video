# Codex review report, 2026-10-19

## 1. Summary

- Feedback only, following the founder's latest instruction. Application code, prices, copy and plan contents are unchanged from `a45f9bb`.
- Assuming the backend is connected later, the focused app-founder workflow is worth testing; the present service promises and full-usage economics are the weak points.
- Studio cannot support expensive generation plus substantial human review at $99. Annual billing makes the problem worse.
- Content permissions, commercially usable music, reliable saving and repeatable generation quality matter more than adding features.
- Run a small paid cohort, measure published videos and repeat use, and keep Business a separately scoped service pilot.

## 2. Fixed

None retained. The founder clarified that this review is feedback only. I initially followed the request document's fix instructions, then undid all five of my local implementation commits and restored `main` to `a45f9bb`. The only deliverable in the working tree is this report. Proposed fixes below are recommendations, not changes made.

## 3. Found, not fixed

Severity describes consequence if exercised. Unauthenticated local prototype behavior is an expected future backend task, not evidence that the overall business is bad. No implementation is recommended merely to make a review checklist longer.

### High: an old failed save can overwrite a newer successful edit

`src/lib/client.ts:79`, `flushRun`: failure handling merges with `pendingSaves`, but ignores newer patches already removed from that map and queued in `saveChains`.

Repro: start PATCH A with title `old` and a text change; while A is pending, edit the title to `new` and let PATCH B enter the serial queue. Return 503 for A, then 200 for B. After three seconds, A's retry sends `old` again. A controlled temporary regression reproduced this exact payload ordering. It was run against a separate snapshot, not the founder's data.

Suggested fix: track intent revisions per section and retry only failed sections that have not been superseded. Preserve A's unrelated text edit without replaying its stale title. Cover delayed 5xx, network rejection, pending and already queued newer writes. Not done: feedback-only scope.

### High before public access: every data API lacks user ownership checks

Repro: without a session, GET `/api/runs` and `/api/assets`; POST a run; PATCH or DELETE another known run ID; GET a known media ID. These handlers share one store. An isolated API POST also accepted an unrelated Origin header. Origin checks alone would not authenticate direct callers.

Evidence: every file under `src/app/api`, and `src/lib/server/store.ts`. `CURATOR` is a server environment flag, not a caller identity. When enabled, every reachable caller gets that machine's curator privileges. When disabled, reference PATCH still permits title/source/analysis changes to curated records, although DELETE and review labels have curator guards. GET references also exposes pending/dropped records and curation metadata; frontend filtering is not access control.

Suggested fix: authenticated, tenant-scoped reads and writes, private file access, separate curator authorization, rate limits and signed jobs. Test cross-account denial, not just successful login. Not done: planned backend work and feedback-only scope. Do not expose the current data routes to customers in the meantime.

### High before money: attractive previews do not establish a deliverable generation pipeline

Repro: change the character, face or reference and Generate. `src/components/run-view.tsx:1090` waits ten seconds and returns `/samples/hook-sample.mp4`. Export at line 468 only shows a toast. This is known planned work. The additional risk is assuming that connecting one vendor will reproduce the advertised motion and identity at the cheapest model's price.

Suggested fix: a rights-cleared benchmark of actual character replacement, including failures and rerolls, before choosing the integration. A cheap image-to-video model is not proof of faithful motion transfer. Ship one reliable pipeline first. Not done: report only; the founder expressly said these integrations come later.

### Medium: collection limits silently discard accepted sound edits

Repro confirmed through the isolated API: PATCH 21 distinct sound pieces; response 200 contains 20. Rows above 20 are clamped too. `src/app/api/runs/[id]/route.ts:25`. Other bounds include 100 demo clips, 50 parts, 200 texts, 500 adjustment keys and 50 generation versions; the editor does not consistently explain/enforce matching limits. See `src/lib/server/run-validation.ts` and `applyGenerated` in `run-view.tsx`.

Suggested fix: agreed visible limits, atomic rejection rather than silent truncation, and actionable save failure state. Not done: product/copy decisions and feedback-only scope.

### Medium: upload and outbound-work limits do not protect server resources

Repro: upload a large multipart body. The 300 MiB check runs after `request.formData()` has parsed it, then `saveMedia` buffers it again. A text payload advertised as `video/mp4` was accepted in the isolated test. No aggregate disk quota, upload rate limit, decode probe, or account budget exists. `src/app/api/media/route.ts:7`, `src/lib/server/store.ts:160`.

Song catalog requests have no explicit deadlines; POST song buffers an entire preview with no byte cap. Concurrent sound GETs for different codes can start separate ffmpeg processes, even though duplicate requests for one code are coalesced. `src/app/api/songs/route.ts`, `songs/[id]/route.ts`, `sounds/[code]/route.ts`, `src/lib/server/source-audio.ts`. The preview URL comes from Deezer, not arbitrary user input; this is not a demonstrated unrestricted URL-fetch endpoint.

Suggested fix: bounded direct uploads, verified media metadata/dimensions/duration, streaming byte limits and fetch deadlines, worker concurrency and resource caps. Before using provider-returned URLs, validate destination/redirect policy too. Not done: backend architecture and feedback-only scope.

### Medium: a local file store is not a safe hosted persistence contract

Repro: run two processes against the same data directory, or edit the same complete section in two tabs. Per-process write serialization cannot prevent cross-process stale reads or collisions on `db.json.tmp`; whole-section last-writer-wins loses tab edits. `src/lib/server/store.ts:54`, `src/lib/client.ts`.

Deletion checks and unlinking are also outside one transaction: a reference can be added after the last-use check but before unlink. Run deletion does not garbage-collect every unlisted song/face/media file, and source audio revisions accumulate. File creation before a failed asset DB write can leave an orphan.

Suggested fix: transactional records, optimistic revisions, explicit file ownership/reference tracking and delayed garbage collection with a grace period. Never solve this by deleting the founder's files. Not done: migration belongs to the planned backend.

### Medium: billing usage is a reconstruction, not an accounting ledger

Repro: generate a hook, reuse it in another run, then delete the original run. The displayed usage changes with saved documents. Keeping only 50 history entries can lose earlier monthly generations. UTC calendar months also differ from a subscription's billing period. A fetch error becomes zero use. `src/components/billing-view.tsx:21`.

Suggested fix: immutable generation IDs, server-side reservations/settlements/refunds, subscription-period boundaries and idempotent provider callbacks. Reuse/export must not consume another AI hook. Keep the current counter diagnostic only. Not done: planned billing work, feedback only.

### Medium: marketing screens collapse their explanatory column on phones

Repro: at 390 px wide, open How it works. Browser measurement returned `grid-template-columns: 280px 0px`, 36 px gap, and child widths 280/0 inside a 356 px panel. `BODY` in `src/components/how-it-works.tsx:213` fixes the video column at 280 px without a small-screen alternative. Clipping avoids a horizontal scrollbar but does not make the text column usable.

Suggested fix: approve a stacked or scaled small-screen layout. Not done: changing the look was forbidden, and latest scope is feedback only.

### Medium: hidden/offscreen marketing work and reduced-motion handling are inconsistent

Repro: leave the landing page at its top. How it works advances every seven seconds despite being below the fold; its selected library row advances too. Switch to Demo and hide the tab: its video/frame loop has no visibility guard. `how-it-works.tsx:26`, `useCycle`, `DemoPanel`; `hook-demo-explainer.tsx:17` only observes intersection, not document visibility.

`src/components/loop-video.tsx:24` pauses on hide but does not resume on show. Its observer tests `isIntersecting`, not the stated one-third ratio, and reduced motion is sampled only at mount. The raw How it works library video autoplays even with reduced motion; Demo avoids play but still schedules frame updates. A final browser run against the restored baseline confirmed an offscreen step change, one video still playing during simulated tab hide, failure of the three hero loops to resume, and a Demo video that remained playing while hidden.

Suggested fix: one tested lifecycle for intersection ratio, document visibility, live motion preferences and cleanup. Pause offscreen timers; preserve explicit row/step selections. Not done: feedback-only scope.

The hero itself intentionally plays three videos. An unthrottled mobile-width read measured about 1.97 MB of hero video transfer alone. A temporary throttled desktop-Chrome diagnostic used 390 x 900, 150 ms latency and 250,000 B/s throughput: first paint about 0.86 s and three simultaneous decoders. That timing is not a real-phone performance guarantee. Some initial diagnostics were on the temporary candidate snapshot before rollback; they establish asset cost, not baseline lifecycle correctness. No reliable total media/GPU RAM measurement was obtained; JS heap is not video memory. Keep posters lightweight and measure low-end phone battery/memory before claiming a fast mobile experience. Reducing the number of visible loops needs design approval.

### Medium: older timeline policies still create surprising states

Repros and evidence: put sound at 7 s, shorten video to 2 s (`pieceEnd`, `src/lib/sound.ts:53`); turn magnet off and change preceding clip speed (`liveAdjust`, `run-view.tsx:122`); start a sound metadata/upload operation, edit another sound, then complete the first operation (`useSounds.pick`). Respectively: negative spans/out-of-video progress, later clips moving despite magnet off, and stale complete-section writes.

Suggested fix: explicit out-of-range and collision policies plus asynchronous operations rebased against current state. Not done: interaction/data-contract decisions and feedback-only scope. See the full older-item checklist below.

### Low: save error wording promises a retry for a rejection that will never retry

Repro: make a patch fail validation with 400. `flushRun` retries only network/5xx failures, but `SaveStatus` at `run-view.tsx:799` always says `Couldn't save, retrying`. Later correct saves can recover; closing the page does not durably preserve rejected or large pending edits.

Suggested fix: distinguish retryable errors from rejected edits; choose durable unsaved recovery. Not done: copy/workflow changes are forbidden.

### Low: analysis can wait indefinitely or retain failed media resources

Repro: a malformed video never emits loadedmetadata/seeked, or a progress callback/canvas read throws. `src/lib/analyze.ts:6` has no deadline, subscribes after assigning `src`, and only releases its video on success. Seeking the current time can await a seeked event that never arrives.

Suggested fix: register listeners before starting, bound waits, avoid redundant seeks, and release media in finally. Test missing events and mid-analysis failures. Not done: feedback-only scope.

### Low: production dependency classification breaks audio-only extraction

Repro: install production dependencies only and request an uncached library sound. `ffmpeg-static` is a devDependency in `package.json`, although `source-audio.ts` requires it at runtime. The route catches failure and falls back to the full video, hiding the missing binary and increasing transfer.

Suggested fix: retain the runtime binary or install it explicitly in the worker/container image; verify a production-only installation. Not done: feedback-only scope.

### Low: pricing animation arithmetic is rounded, and comparison credibility is a bigger issue

Repro: let CostStack complete, re-enter it, or enable reduced motion. It consistently shows $266, although its six displayed lines sum to $265.98. The $59 comparison yields 78% less after rounding. No duplicated accumulation/re-entry error was found. `src/components/pricing-page.tsx:17`, `CostStack:243`, `Math.round(running):302`.

Suggested fix: founder decides whether whole-dollar approximation is intentional. Separately substantiate current competitor prices, relevant licenses and equivalent deliverables. This stack is not six purchases every founder must make. Not done: the instruction specifically forbids price/copy changes.

### Low: dead code, broad bundles and misleading empty states

`run-view.tsx` is 4,885 lines. `LATER_STEPS` remains false with old branches; `buildProject` remains in `src/lib/client.ts`. LibraryView imports SourcePicker from the same giant client module. Run covers mount a metadata-loading video for every generated run; lists/history are not paginated/virtualized. Frame caching is bounded, but offscreen queued requests are not fully canceled.

Repro: open a large library/history or many generated runs; inspect mounted media and imported code. Simulate failed list fetches: several views turn errors into empty lists, and optimistic rename/delete lacks rollback. `library-view.tsx`, `runs-list.tsx`, `history-panel.tsx`, `billing-view.tsx`. `billing-view.tsx:11` still incorrectly says everyone is on Free.

Suggested fix: remove verified dead branches mechanically, split shared SourcePicker, use smaller read projections/pagination, and distinguish failure from empty data. Do not rebuild the editor to achieve this. Not done: feedback-only scope; error wording/layout needs approval.

### API coverage and bounded positive findings

Reviewed all 11 route files, including all exported methods:

| Route | Existing safeguards | Remaining issue |
| --- | --- | --- |
| `/api/runs` | Serial local creation | Anonymous global list/create, no quota |
| `/api/runs/[id]` | Section validation, local source restrictions | Anonymous read/write/delete, silent sound truncation, no revisions/body budget |
| `/api/assets` | Local listing | Global anonymous listing |
| `/api/assets/[id]` | Media ID validation, shared-use check | No owner check; check/unlink race |
| `/api/media` | MIME allowlist, 300 MiB file check, invalid multipart becomes 400 | Parsing/buffering before bound, MIME spoofing, no total quota |
| `/api/media/[id]` | Restricted filename pattern, byte ranges, private cache header | A known ID grants access; private cache header is not authorization |
| `/api/references` | Video lookup, bounded fields, curated-create machine flag | Global read/draft leakage; no caller identity |
| `/api/references/[id]` | Analysis validator, review/delete machine flags | Incomplete curated-write guard; no ownership |
| `/api/songs` | Search encoded/bounded; fixed provider endpoints | No deadline or account/rate budget; playlist ranking is not platform trend evidence |
| `/api/songs/[id]` | Numeric track ID, generic 502 failure | Unbounded external download, music licensing unresolved |
| `/api/sounds/[code]` | Restricted code, coalesced extraction, 60 s subprocess timeout | Anonymous source access, cross-code worker amplification, fallback transfers full video |

No arbitrary shell interpolation was found in the sound extractor: it uses execFile arguments. Existing ID/path restrictions and byte-range regressions are useful. No `.data` or `.env*` files are tracked; the checked application source contains environment flag names rather than embedded provider secrets. This is a source review, not a penetration-test certification or a check of unprinted secret values.

## 4. Open items from 2026-10-16

All 13 findings from that report's section 3 were rechecked against current source. Repros involving policy are not presented as newly settled behavior.

| Older item | Status now | Evidence and remaining work |
| --- | --- | --- |
| Generation history lacks immutable original inputs | Still open | HistoryPanel builds entries from current Run plus URL/time/note versions; `onUseGenerated`, `run-view.tsx:727`, imports current `from.hook` context. Need per-generation input snapshots. |
| Replacing demo retains destination text | Fixed by existing later work for ordinary clip-local text | `onUseDemo`, `run-view.tsx:734`, drops destination demo-local text and imports source text against corresponding new clip offsets, clearing gaps. Cross-clip text uses start-based ownership, so that separate boundary policy remains open. |
| Track/collection limits silently lose edits | Still open | Isolated 21-sound PATCH stored 20. Other collection bounds still mismatch unbounded marketing language. |
| Background save failures invisible | Core issue fixed by existing later work; retry ordering is worse than the old report described | Existing SaveStatus, subscribeSaves, pagehide flush and automatic network/5xx retry are present. The stale retry race above can overwrite newer saved data. 4xx wording and durable recovery remain unresolved. |
| Sound outside shortened video | Still open | `pieceEnd` can return 2 for a piece starting at 7; runSteps counts the sound record regardless of audible overlap. |
| Magnet-off speed changes ripple following clips | Still open | `liveAdjust` changes duration/remaps text without compensating the following gap. |
| Async media operations commit stale sections | Still open | Sound selection/upload completion still captures earlier sections; cross-run insertion protection does not rebase intervening same-run changes. |
| Multiple processes/tabs overwrite JSON sections | Still open | One process-local promise queue and fixed `.tmp` path; no revision checks. Same-process tests do not prove distributed safety. |
| Local server binds all interfaces, no auth | Partly fixed by existing later work | `npm run dev` now binds 127.0.0.1. `npm start` still uses Next's default binding. Authentication/ownership is still absent. No founder server was restarted or reconfigured. |
| Text boundaries, minimum duration, drag cleanup and keyboard editing | Still open | Clip-contained fixes do not define spanning/gap text ownership. Window pointer handlers and trim handles still need systematic cancellation/keyboard work. |
| Undo is per-editor session; step-5 volume ticks | Still open | Session-local stacks reset on close; stale external undo invalidation exists, but this is not durable unified history. Volume gesture grouping still needs attention. |
| External download and analysis cancellation | Still open | Deezer fetch/body waits lack explicit bounds; analyzeVideo lacks deadline/finally cleanup. sourceAudio's subprocess timeout is not a bound on those other paths. |
| Dormant code and stubs | Still open | False LATER_STEPS branch and buildProject remain; export and generation are intentionally pending backend work. Frame cache caps remain useful; Loops policy remains undecided. |

## 5. Claims vs reality

Status is about the product today. `no` also marks an unsupported factual/outcome claim, rather than pretending a marketing superlative was measured. Repeated claims are grouped, including inherited plan features. No copy was changed.

Evidence keys: **L** = `src/components/landing.tsx:39`; **H** = `how-it-works.tsx:18`; **X** = `hook-demo-explainer.tsx`; **P** = `pricing-page.tsx:17` and `:30`/`:64`; **Plans** = `src/lib/plans.ts:30`; **G** = `run-view.tsx:1090`; **E** = `run-view.tsx:468`; **B** = `billing-view.tsx:14`; **S** = `src/lib/edit.ts:274`; **C** = `src/lib/characters.ts`; **M** = `marketing-chrome.tsx:57`. Unqualified component names in this table are in `src/components`.

| Claim | Page | Status | Reality and file evidence |
| --- | --- | --- | --- |
| Mavya makes marketing easy | Landing hero | partly | Guided local creation/editing exists; no finished-file path yet. L, run-view, E. Ease has not been tested with new paying users. |
| Hook + demo is the #1 way to market your app | Landing hero | no | No comparative acquisition/channel data supplied or implemented. L. A format hypothesis, not a substantiated ranking. |
| Your next viral video | Landing hero | no | Neither generation nor an outcome guarantee exists. Source-video views do not predict a customer's result. L, G. |
| Under 2 minutes; finished video in minutes; film demo in a minute | Landing/H | no | No end-to-end timed completion test, real vendor latency, export or filming benchmark. Ten-second artificial wait proves nothing. H, G, E. |
| First video today; post on signup day; every plan makes AI hooks from day one | Pricing | no | Current code cannot generate the promised character hook or export it. P FAQ, G, E. Future launch acceptance criteria, not current behavior. |
| Viral hook library; start from a hook already viral | Landing/pricing | partly | Real curated records and metadata exist: local read-only inventory found 234 nonpending/nondropped curated records. Permission and outcome provenance are separate. SourcePicker/library-view, L. |
| 3.6M, 5.6M, 3.3M hero views; 5.0M/4.8M and likes/comments in demo | Landing/H | partly | Hardcoded labels on other creators' examples; not Mavya customer results, not a live verified counter. L HERO, H HOOKS. No scraping or independent count verification performed. |
| Copy the format, your character performs it, same moves/same timing | Landing/H | no | Character selection exists, actual performance replacement does not. H CharacterPanel, G. Motion fidelity remains an integration experiment. |
| No need to be on camera | Landing | partly | Uploads and character selection let the founder assemble a preview without filming a face. An original app demonstration still needs footage; AI character output is not connected. L, G. |
| Pick one of 70 AI characters | Landing/H | yes | The shipped character catalog has 70 selectable identities/images. C. This yes does not mean 70 functioning animated actors. |
| Your own photo/face, or describe a character | Landing/H/pricing | partly | Photo/described-face inputs are stored; they do not alter the stand-in generation. run-view face picker, G. |
| Unlimited AI characters | Plan cards/pricing | partly | Repeated cast selection has no charge, but cast is finite and custom character generation is absent. C, Plans, G. Unlimited paid model calls would need a separate cost rule. |
| 20/60/150 AI hooks per month | Pricing/cards | no | Constants are correct as an offer, but no provider execution, subscription entitlement or server quota exists. Plans, G, B. |
| Business unlimited AI hooks | Pricing comparison | no | Displayed Unlimited with no entitlement, budget or signed service scope. P, Plans BUSINESS. |
| Unlimited text on screen | Pricing/cards | partly | Static text editing exists. API caps text layers at 200 and bounds text length; not literal unlimited project complexity. run-validation texts, run-preview. |
| Unlimited shot-by-shot scripts for your app; Mavya writes the script | Landing/H/pricing | no | `shotList` maps stored reference recipes or returns four fixed default shots. Product-specific AI writing is absent; hook remixes are string templates. S, client.ts remixHook. |
| Upload or film the demo clip by clip | H/product explanation | yes | Single/clip demo upload, cut and assembly exist in run-view/edit. Does not include exported output. |
| Unlimited edits | Pricing/cards | partly | Local editor has trims, text, sound and adjustments without edit credits. Persistence limits, save races and boundary bugs qualify the claim. run-view, edit, run-validation. |
| Unlimited exports; download your video; ready to post | Landing/H/pricing | no | E only shows Rendering is not connected yet. No actual export/download pipeline. |
| Trending songs | H/pricing | partly | Deezer playlists/chart/search and 30-second previews exist, not a verified TikTok/Reels trend feed or commercial sync license. `/api/songs`, `/api/songs/[id]`. |
| Hook's original audio | H | partly | Local source sound can be extracted/previewed, subject to missing files/audio and permissions. sound.ts refSoundSrc, source-audio.ts. No export yet. |
| Songs are 30-second previews | Landing FAQ | yes | Current provider previews are used and saved locally. Songs route comment/POST. Availability is provider dependent. |
| Upload full track or add it on Instagram/TikTok | Landing FAQ | partly | Own-file audio upload exists. Platform music selection is an external manual action; suitability for commercial accounts is not guaranteed. L, run-view useSounds. |
| For Instagram Reels, TikTok and YouTube Shorts; anything vertical | Landing | partly | Vertical preview/editor exists. No rendered codec/size/platform-upload acceptance testing yet. L, run-preview, E. |
| You own the videos; post anywhere | Landing FAQ | no | No export or established combined rights grant for creator footage, music, likeness and generated output. L; terms/privacy links are placeholders in M. |
| 10 hooks x 10 demos = 100 videos | Landing explainer | partly | Combinatorial arithmetic is correct; no one-click batch generation/export feature. X VolumeMatrix, E. |
| More videos, more shots at going viral | Landing explainer | partly | More tests are possible in principle; no evidence of independent trials, distribution or better business results. X. Repetition can produce fatigue. |
| $29/$59/$99 monthly and $290/$590/$990 yearly | Pricing | partly | Displayed exactly by shared plan data; checkout cannot charge or fulfill subscriptions. Plans, B. |
| Two months free yearly; save $58/$118/$198 | Pricing | yes | Arithmetic: annual price equals ten monthly payments; priceOf and plan cards show equivalent monthly price. Plans, P PlanCard. No billing execution implied by this arithmetic yes. |
| Everything in the previous plan plus listed features | Pricing | partly | Feature inheritance is display data; no enforced entitlements. Plans plus/features, P. |
| Every plan has AI from day one; no free plan | Pricing FAQ | partly | Offer data has no free tier, but the studio is currently accessible without payment and AI is absent. Plans, B, G. |
| Try it free | Landing How it works | partly | Local studio access is free today; no defined trial exists, and pricing explicitly says no free plan. H, P FAQ. Founder must choose a consistent launch policy. |
| Priority generation | Pro/Studio/Business | no | No generation queue, priority classes, capacity reservation or SLA. Plans, G. |
| Weekly review and written feedback; team in your corner | Pro and above | no | No shipped submission/delivery process or evidence of an operating service. Plans, P FAQ. Can be manual with a named reviewer and turnaround commitment. |
| Weekly hook picks for your app | Pro and above | no | Comparison/FAQ promise it; no customer-specific selection/delivery process. P. Can be manual rather than a recommendation engine. |
| Every video reviewed before posting; hook/script/edit notes | Studio/Business | no | No submission queue, reviewer capacity, status or turnaround policy. Plans, P FAQ. Must distinguish final submissions from every generated attempt. |
| 1:1 guidance and priority support | Studio/Business | no | No defined channel, response window, appointment allowance or staffing evidence. Plans, P. No in-app system is necessary if a real manual service exists. |
| Dedicated team; we make/edit/post; send only your website | Business | no | No operating scope, app access/footage intake, approvals, publishing authorization or staffing evidence. Plans BUSINESS, P. A website alone does not reveal an authenticated product. |
| Pay for results; agreed monthly views quota; minimum; miss it and pay nothing | Business | no | No contract defines payable amount, baseline, window, platforms, fraud exclusions or which minimum is waived. Plans BUSINESS, P FAQ. Contact link alone does not establish delivery. |
| Book a call | Business card | partly | Link opens a mailto address, not a booking flow. P BusinessCard, Plans contact. Email delivery/response was not tested. |
| Change plans/cycle any time; upgrades immediate | Pricing FAQ | no | No subscription change operation. B placeholders; P FAQ. |
| Auto-renew; cancel in Billing; retain paid access until period end | Landing/pricing | no | Billing cannot manage a subscription. Landing says month while yearly says paid period, so annual policy also needs consistency. L, P, B. |
| Editing/exporting/reusing existing hook are free | Pricing FAQ | partly | No separate charges currently exist; editing/reuse work, export does not, and future accounting is absent. P, G, E, B. |
| One tool instead of six; all six in one place | Pricing | no | Not currently equivalent to six operational products, especially licensed music, generated scripts/video and exports. P STACK, G, E, S. |
| Six-tool prices $49/$20/$49/$110/$19.99/$17.99, total $266, 78% less | Pricing | partly | Local lines total $265.98; rounded $266 and 78% match code. These are hardcoded comparison inputs, not verified equivalent current subscriptions or a necessary customer spend. P STACK/CostStack. |
| Most popular Pro | Pricing/cards | no | Hardcoded `popular: true`; no customer mix data supplied. Plans. This may be intended merchandising, but it is not measured popularity. |
| Sign up / Log in; Terms / Privacy | Shared header/footer | no | First two go to `/studio`; last two point to `#`. M. None establishes an account or published legal terms. |

## 6. Business and feature plan

### 6.1 Unit economics and the overall offer

The plan has a credible customer and a narrow job: help an app founder turn a real product demonstration into repeatable short-form posts. Your marketing judgment and the guided handoff from hook to footage are the potential advantage. An avatar library, editor, or viral-template library alone is easy to substitute.

Assume the backend will be connected. The strategic question is whether customers repeatedly publish useful videos, rather than whether they can consume 150 generations. The current offer combines inexpensive software expectations, metered AI costs, expert weekly coaching and an agency guarantee. Those are four different cost structures. The top self-serve plan risks attracting the customers who consume the most AI and the most founder time.

The competition already spans these pieces: [Yorby](https://www.yorby.ai/) markets script remixing and account tracking; [Arcads](https://www.arcads.ai/) markets actors and an integrated ad creation/editing workflow; [Creatify](https://creatify.ai/) markets templates, generation and campaign tools; [Virlo](https://virlo.ai/) markets research/analytics. These are vendor claims, not an independent quality comparison. Hooked.so was inaccessible and ReelFarm's intended official domain was not confirmed, so I did not invent their current capabilities or prices. Compete on the specific founder outcome and measured time saved, not a larger feature checklist.

#### Public generation prices checked on 2026-10-19

USD API rates, not consumer subscription credits. Availability, acceptable inputs, output quality and contract rights require separate verification. The model names below matter: the live Runway page lists Aleph 2, not the older Aleph price sometimes repeated online.

| API/model | Public rate | Example raw cost for one generated clip |
| --- | --- | --- |
| Runway Gen-4 Turbo | 5 credits/s, $0.01/credit | 5 x 5 x $0.01 = $0.25 for 5 s |
| Runway Act-Two | 5 credits/s | 5 x 5 x $0.01 = $0.25 for 5 s |
| Runway Aleph 2 | 28 credits/s, minimum 56 credits | 5 x 28 x $0.01 = $1.40 for 5 s |
| Google Veo 3.1 Fast, direct Gemini API, 720p with audio | $0.10/s | 8 x $0.10 = $0.80 |
| Google Veo 3.1 Fast, direct, 1080p with audio | $0.12/s | 8 x $0.12 = $0.96 |
| Google Veo 3.1 Standard, direct, 720p/1080p with audio | $0.40/s | 8 x $0.40 = $3.20 |

Sources: [Runway API pricing](https://docs.dev.runwayml.com/guides/pricing/), [Google API pricing, Veo section](https://ai.google.dev/gemini-api/docs/pricing#veo-3.1). Runway's routed Veo Fast with audio is $0.15/s, different from Google's direct 720p rate. Do not mix providers in one cost estimate. A 4 s direct Fast clip would cost $0.40 raw if that duration/input mode is supported; 8 s is an explicit scenario, not a claim that every hook requires eight seconds.

Gen-4 Turbo and Act-Two have different input/output capabilities. Cheap pricing is not evidence that either delivers the advertised reference recreation. Verify supported duration, portrait output, face/hand fidelity and reference-video constraints in the actual paid account. No paid AI calls were made for this review.

#### Render, storage and bandwidth assumptions

Use a planning reserve of **$0.10 per quota hook**, in addition to generation, for text/character assistance, rendering and assets. It is not a measured production cost or an unlimited-export promise.

- Example: two 30 s exports per hook; each render takes two minutes on a two-CPU task. At [$0.40/hour for Render Workflows 2c-4g](https://render.com/docs/workflows-limits), four wall minutes cost $0.0267. Actual ffmpeg time, retries and minimum charges must be measured.
- Keep about 100 MB per project, including original/generated files and exports, for 90 days. At steady state that is 0.3 GB-month per new monthly project: $0.0045 at [R2 Standard $0.015/GB-month](https://developers.cloudflare.com/r2/pricing/). R2 internet egress is free; request operations, worker egress and other hosting traffic are not all free. Twenty writes plus 200 reads at published R2 rates add about $0.00016, before free allowances/rounding.
- Allow $0.03 for script/identity preparation as a model-independent placeholder, plus roughly $0.039 for retry/transfer/processing uncertainty. With Supabase storage instead, excess uncached egress is $0.09/GB and storage $0.0213/GB-month; normal short clips still fit this reserve. Full-length uploads, permanent retention and bulk exports do not. [Supabase pricing](https://supabase.com/pricing).

Fixed app/database hosting is separate below, so it is not counted twice in the usage reserve. An always-on worker replaces task-based render billing; allocate its fixed bill instead of charging both. Founder labor, acquisition, taxes, refunds, chargebacks, licenses and excess support are not covered by ten cents.

#### Full quota, one billable attempt per hook

Revenue is $29/$59/$99. `gross margin = (revenue - hooks x (raw model cost + $0.10)) / revenue`. This first table excludes people, fixed hosting and payment fees so the definition is explicit.

| Model scenario | All-in variable cost/hook | Starter, 20 | Pro, 60 | Studio, 150 |
| --- | ---: | ---: | ---: | ---: |
| Cheap Runway, 5 s | $0.35 | $22.00 / 75.9% | $38.00 / 64.4% | $46.50 / 47.0% |
| Aleph 2, 5 s | $1.50 | -$1.00 / -3.4% | -$31.00 / -52.5% | -$126.00 / -127.3% |
| Direct Veo Fast 720p, 8 s | $0.90 | $11.00 / 37.9% | $5.00 / 8.5% | -$36.00 / -36.4% |
| Direct Veo Standard, 8 s | $3.30 | -$37.00 / -127.6% | -$139.00 / -235.6% | -$396.00 / -400.0% |

For an illustrative US domestic-card merchant using Stripe Billing, reserve 2.9% + $0.30 for payment processing plus 0.7% of subscription volume. Actual country, international-card, FX and tax costs differ; this is not a quote for the founder's legal entity. [Stripe pricing](https://stripe.com/pricing).

| Cheap Runway scenario | Starter | Pro | Studio |
| --- | ---: | ---: | ---: |
| Monthly contribution after illustrative payment fees, before people/fixed costs | $20.66 / 71.2% | $35.58 / 60.3% | $42.64 / 43.1% |
| Annual revenue recognized per month | $24.17 | $49.17 | $82.50 |
| Annual contribution per month, same monthly quotas and annual payment fee spread over 12 months | $16.27 / 67.3% | $26.37 / 53.6% | $27.00 / 32.7% |
| Two paid model attempts per usable hook, monthly contribution | $15.66 / 54.0% | $20.58 / 34.9% | $5.14 / 5.2% |
| Two attempts per usable hook, annual contribution per month | $11.27 / 46.6% | $11.37 / 23.1% | -$10.50 / -12.7% |

The two-attempt stress case assumes the customer is owed 20/60/150 usable hooks and Mavya absorbs a reroll. If each successful vendor generation consumes one quota unit, that extra reroll consumes another unit instead; margins resemble the one-attempt row but the customer gets fewer usable posts. Vendor success is not customer acceptance. Failed/blocked provider jobs and duplicate requests need an explicit refund rule, not surprise charges.

At a 70% contribution target after those illustrative fees, the entire per-hook variable budget before people/fixed costs is about $0.368/$0.255/$0.172 monthly, or $0.318/$0.216/$0.145 on annual plans. Studio's raw $0.25 cheap generation already exceeds that target budget. Low usage can improve realized margin, but relying on customers not using the headline allowance is not a robust full-usage plan.

**Human service is the larger trap.** At an assumed $30/hour opportunity cost, a ten-minute weekly Pro review costs about $21.65/month. Cheap generation leaves Pro about $13.93 monthly, or $4.72 on annual, before hosting, support, hook picks and acquisition. Reviewing 150 Studio submissions for just two minutes each costs $150/month. Add one 30-minute guidance session: $165, against $42.64 contribution before labor. Even one minute per submission costs $75. Founder time is not free because it is unpaid.

Reviewing final submitted videos rather than every generated attempt can reduce load, but the exact service contract must be explicit. Do not secretly introduce a cap that contradicts every-video review. Your prices and plan counts remain unchanged in this report. Define turnaround, review depth, what counts as a submission, revisions and guidance availability before selling that promise. If customers reasonably expect intensive unlimited attention, the Studio offer is economically unsound at full usage.

**Is 150 for $99 survivable?** Narrowly as software with short, cheap, one-attempt generations and modest support; not as Aleph-quality replacement or eight-second Veo at full usage plus substantial personal review. It is not automatically a good business even in the cheap case. With the current promises, do not broadly launch Studio until actual quality, usage and review time demonstrate a positive fully loaded contribution.

Recommended rules for founder approval, not implementation: define a standard hook's model, maximum generated seconds and resolution; charge a quota unit per successful generation, including explicit customer rerolls; never charge edits/reuse again; refund infrastructure failures once; cap simultaneous jobs and reject duplicate requests; prohibit automated resale/bulk abuse; retain files for a stated period. Unlimited exports should mean repeat exports of a customer's projects with a bounded queue, not an unbounded rendering API. Unlimited character selection must not mean unlimited paid image-generation calls. Any premium-model credit conversion or service cap changes the offer and needs an explicit founder decision.

### 6.2 Must have before the first paying customer

Sizes are relative implementation/process effort, not estimates of calendar days. S = bounded task, M = several connected parts, L = core pipeline/integration work. These are launch gates for the intended self-serve offer, assuming the planned backend sprint proceeds.

| Order | Must have | Why it blocks money | Size | What can stay manual |
| --- | --- | --- | --- | --- |
| 1 | Rights-cleared sample set and successful paid generation benchmark | Need to know whether the promised product is possible at its allowed cost. Test roughly 20 representative hook inputs, multiple identities, durations and repeat attempts; record accepted outputs, latency and every dollar. | M | Founder rates identity, motion, text/artifact quality and publishability. No evaluator platform needed. |
| 2 | One faithful end-to-end export path | Customer pays for a usable post. Render must match preview cuts, speed, gaps, static text, fonts, crop, music and volume. Include portrait H.264/AAC, rotation, phone MOV/WebM, silent sources and upload failures. | L | Founder can inspect pilot exports; cannot ask customers to reconstruct the project in another editor to fulfill this offer. |
| 3 | Reliable persistence, private account/file ownership and recoverable jobs | Lost edits, leaked face photos and duplicate charges destroy trust. Include the save race, revision checks, idempotent job state and restore/deletion checks. | L | Founder can monitor failures and issue recovery/refunds. Access controls and job isolation cannot be manual. |
| 4 | Payment/entitlement ledger with limits enforced on the server | Checkout success is not entitlement; need webhook replay safety, renewals, failed payments, quota reset, cancellation and annual allocations. | M | Hosted Stripe Checkout/Portal, manual customer support and initial refunds. A concierge pilot may use invoices/payment links with a written scope. |
| 5 | Defined human-review service and a staffed delivery channel | Pro/Studio promise actual attention. Decide business hours, submission intake, turnaround and final-video definition before accepting subscriptions. | S/M | Email/shared review links/calendar and a spreadsheet are enough. No review dashboard or chat system required. |
| 6 | Commercial media rights, consent, terms/privacy and support contact | Downloadable output is not usable if the assets cannot legally be combined or posted. Include creator rights, music, face consent, retention and deletion. | M | Track licenses/permissions manually and have the intended launch markets' contract reviewed. |
| 7 | Production deploy, backups, spend caps, alerts and failure handling | Must survive a process restart, restore a record/file, retry a stalled job and stop runaway costs. No customer should depend on the founder laptop staying open. | M | Founder on-call and manual incident/refund handling for a small cohort. |

Do these in sequence around one golden path. Do not run four parallel feature sprints to make the pricing comparison true. A small clearly scoped paid concierge experiment is possible sooner, but it must honestly describe what the founder manually delivers; it is not evidence the advertised self-serve plans already work.

### 6.3 Add soon after, if the cohort uses the core flow

1. **A useful product brief saved once:** audience, factual capabilities, price, one compelling demo moment and forbidden claims. Convert that into an app-specific hook and shot list; ask for explicit generation. This removes repetitive work and prevents scripts inventing features. Do not scrape a website or generate a false app UI.
2. **Reusable real demo footage and project duplication:** let a founder test three meaningfully different hooks against one verified demo. Existing history is a start; immutable generation inputs and reliable clip/text reuse are prerequisites. Do not build a 100-job batch generator first.
3. **Practical publishing checks:** safe text zones, readable opening frame, no accidental black gaps, audible clipping checks, caption/copy suggestions and AI/music disclosure guidance. Keep text static. Measure preview/export parity before adding effects.
4. **A lightweight review loop:** submission link, received/reviewed state and delivered notes. Start with existing tools. Record review minutes and whether the founder acted on the advice.
5. **Basic funnel and outcomes:** source chosen, generation started/succeeded/accepted, export succeeded, user reports posting, repeat weekly creation. Let users paste a published link and optional view/signup results; use their supplied analytics or approved APIs, never scraping. Connect acquisition to qualified visits/signups, not views alone.
6. **Targeted compatibility fixes:** mobile filming/upload guidance, reliable phone-file processing, clear failed-save/upload recovery. Add only what actual pilot failures reveal.

### 6.4 Do not build now

- A CapCut competitor: more transitions, animated text, a bigger effects library, multicam, collaborative timelines, plugins or a complete editor rewrite. The timeline already has more policy surface than the narrow workflow needs.
- More model vendors, hundreds more faces, voice cloning, long-form generation, cinematic scenes or arbitrary product replacement before one hook pipeline works reliably.
- Auto-posting across every network, account farming, autonomous engagement, scraping, or a generic competitor-tracking product. Manual posting is an acceptable first boundary.
- A huge analytics dashboard, attribution platform, social scheduler, mobile app, team permissions suite, enterprise SSO, public API or white-label agency platform.
- A custom billing portal, custom auth or elaborate review/chat system when managed services and a human process suffice.
- More landing-page animation/polish before permissions, export fidelity, paid generation cost and first-week publishing are validated.
- A broad guaranteed-results agency hidden inside the self-serve subscription. Business can be a limited, separately contracted pilot; do not let it dictate SaaS architecture.

### 6.5 Risks that could kill it, and the smallest way to preserve the product

These are concrete release decisions, not claims that every use is unlawful. Launch jurisdictions, permissions and contracts were not supplied.

| Risk | Why it matters here | Safest practical response |
| --- | --- | --- |
| Creator footage/covers are treated as owned inventory | Landing explicitly labels its other-creators' loops LOCALHOST ONLY pending permission. API access and a public post are not proof of a commercial reproduction/remix license. | Obtain permission covering storage, marketing display and intended derivative use, or replace with owned/commissioned examples. Keep source/license/removal records. |
| Recreating a format becomes copying protected expression or a person's performance | The idea of reaction + demo is different from reusing a particular recording, soundtrack, script and likeness. | Extract the general structure, write original app-specific words, use consented performers and owned driving footage. For close motion/footage transformations, secure permission. US copyright protects expression rather than ideas. [Copyright Office](https://www.copyright.gov/what-is-copyright/). |
| Instagram embeds are mistaken for a rights transfer | Embedding may be an approved display method but does not automatically license downloading, rehosting or creating derivatives; availability/privacy can change. | Use the official embed only under its current terms and permissions, with a fallback link and removal process. Do not convert an embed into stored footage by a downloader. No scraping. |
| Meta Business Discovery/dev-mode access fails as a commercial supply chain | The app's actual permission grants, review status, approved purpose and contracts were not available. Current Meta documentation fetches were blocked, so approval/compliance cannot be verified from this review. | Review the actual app dashboard and [Business Discovery documentation](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery/) plus platform terms. Obtain required approval before depending on ongoing access. Maintain an independently licensed library that still works if the API stops tomorrow. Do not claim dev mode is blanket commercial permission or blanket proof of a violation. |
| Deezer previews are sold as exportable commercial music | The accessible developer terms expressly restrict ordinary service use to a noncommercial environment and private listening. A 30-second duration does not solve sync/master rights. | Do not base paid video music rights on public previews. Obtain a written commercial agreement or use music licensed for this SaaS/export use; alternatively export without that track and have users add eligible platform music. Platform business/ad libraries differ from personal-use music. [Deezer developer terms, IV and IX](https://developers.deezer.com/termsofuse). |
| A stock music subscription is assumed to cover every customer | A creator subscription is not automatically a sublicensing deal for a generation SaaS or all customers' ads. | Verify the exact commercial redistribution/synchronization grant, territories and customer coverage. Build a small properly licensed catalog first; do not promise every trending track. |
| AI face/voice impersonation, minors or fake testimonials | A consented fictional actor is different from pretending a real customer/celebrity used an app. FTC guidance specifically discusses AI stock avatars and fake underlying testimonials. | Restrict to consented adult likenesses/authorized voices, prohibit impersonation and fabricated experience, keep consent records, and provide a removal/report channel. Clearly present dramatizations. [FTC testimonial rule guidance](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers). |
| Platform disclosure and synthetic-content obligations | Photorealistic character footage can need an AI disclosure; merely labeling an edit AI does not clear copyright or deceptive claims. | Give platform-specific posting instructions and preserve available provenance. [TikTok AI content guidance](https://support.tiktok.com/en/using-tiktok/creating-videos/ai-generated-content), [YouTube GenAI disclosure](https://support.google.com/youtube/answer/14328491). For applicable EU deployments, assess Article 50 duties and scope rather than assuming one label covers every market. [EU AI Act](https://eur-lex.europa.eu/eli/reg/2024/1689/2026-07-27/eng). |
| Ownership/post-anywhere promise exceeds the rights actually held | AI output rights, creator footage, music and uploaded faces have different permissions. Commercial permission is not the same as exclusive copyright. | State the actual contractual grant after vendor/license review, retain a rights manifest and avoid promising unrestricted ownership of third-party assets. No current terms page establishes it. |
| Business views guarantee creates uncapped agency liability | Views vary by account, distribution and approval delays; bought/paid views can game the metric. The minimum and waived charge are undefined. | Written pilot scope: accounts/platforms, view source, organic/paid treatment, quota window/timezone, baseline, invalid traffic, approvals, client duties, minimum/waiver/refund and maximum exposure. Verify client-supplied/platform-authorized analytics. A quota should not be a promise of customers or revenue. |
| Good-looking videos do not produce valuable acquisition | A generic shock hook can attract people who will never use the app. Original viral performance may depend on account, timing or subject. | Measure qualified clicks, activated signups and repeat founder usage. Test hooks that accurately lead into the product. Stop optimizing for views if they do not produce the intended audience. |
| Provider quality, policy or costs change | A price table cannot guarantee likeness quality, queue time, approval of input clips or ongoing model access. Rerolls can wipe out contribution. | Track real accepted-output cost and p50/p95 latency, keep model/version/input provenance, enforce budgets and build a manual failure/refund fallback. Do not automatically fail over to a more expensive vendor without budget approval. |
| Founder becomes the bottleneck | Every-video review and 1:1 help scale with customers, not code. Business competes for the same expert time. | Limit initial cohort size to actual reviewer capacity, measure minutes and SLA misses, document a review rubric, and train a reviewer only after proving the service produces retention. Do not quietly ration a sold promise. |

### 6.6 Hosting plan

Do not deploy the current JSON/file architecture unchanged onto serverless hosting. Vercel Functions have a [4.5 MB request/response payload limit](https://vercel.com/docs/functions/limitations), whereas this app advertises 300 MiB file uploads. Route direct signed uploads to object storage; API handlers should authorize and enqueue work, not buffer full source videos. Runtime-local files are not durable account storage.

**Cheapest sane small-cohort pilot I would consider:** one paid Render 1c-2g service at $25/month, Supabase Pro at $25/month for Postgres/Auth and initially its included Storage, plus domain/email/usage. Run Next and one supervised job process on that host, with one render at a time, explicit ffmpeg CPU/memory/time bounds, durable DB job leases and restart recovery. Both processes use transactional DB storage, not separate JSON queues. This saves a worker bill at tiny volume but shares CPU and failure domain; benchmark responsiveness during the worst allowed render. If it cannot meet that test, separate the worker immediately. [Render compute pricing](https://render.com/pricing?trk=article-ssr-frontend-pulse_little-text-block), [compute specifications](https://render.com/docs/compute-plans), [Supabase pricing](https://supabase.com/pricing).

**Familiar, cleaner isolation:** Vercel Pro $20 + Supabase Pro $25 + Render 1c-2g worker $25 = about **$70/month base**, before overages, domain/email, licenses and AI. [Vercel pricing](https://vercel.com/pricing). Vercel Hobby is [personal/noncommercial only](https://vercel.com/docs/plans/hobby), so it is not the paid-business plan. Render Workflows can replace an always-on worker if task-based costs and operational constraints win in a measured pilot; do not add a second queue framework gratuitously.

Supabase's included 100 GB storage/250 GB egress are useful initially. Keep private originals/results there to minimize integration work, with signed reads, explicit retention and a deletion process. If video traffic makes storage/egress material, move blobs to private R2, leaving ownership and file keys in Postgres. R2 has a 10 GB-month standard free allowance and free internet egress, but requires another integration. Choose it from actual workload economics, not because one line says free.

Move in this order:

1. Back up local DB/media and inventory referenced IDs without deleting anything. Add a reversible import and reconcile record/file counts.
2. Establish account ownership and private object keys; separate curated licensed shared material from customer uploads. Preserve existing media identities through an explicit mapping.
3. Move records to Postgres and files to durable private storage; use direct signed uploads. Auth callback, data policies and storage policies must agree.
4. Put generation/render jobs in durable states with idempotency, attempt costs, leases, timeout and retry/refund policy. The worker owns ffmpeg and vendor credentials; the browser never does.
5. Add subscription entitlements/webhooks, deploy one small cohort, test restart/recovery and restore a backup, then widen access.

No AWS account is needed. Keep region choices close to users/worker where practical, separate preview/test/prod data and payment credentials, and set spend alerts/caps before provider calls. At ten customers, even a $50-$70 base is $5-$7 each; at 100 it is $0.50-$0.70 before growth. Neither allocation is in the contribution tables. Back up actual object files too; a database backup alone cannot recreate deleted footage.

### 6.7 Things missing from the plan

- **A decision rule for validation.** Proposed pilot: five app founders with real demos, followed for four weeks. Track first publishable export, whether they actually post, accepted generations per paid attempt, total dollars, review minutes and weekly return. Set success/failure thresholds before seeing the results. Suggested starting gates: four of five can publish without founder editing rescue; at least three return to create/post in week four; fully loaded contribution stays positive at realistic usage. Small samples guide the next cohort, not a public performance claim.
- **Customer inputs are the bottleneck.** Founders may not know their audience or have a compelling app moment. A licensed celebrity-like hook cannot rescue a confusing product demo. A simple product brief and a concrete shot list may create more value than more generations.
- **The two-minute promise has two clocks.** Separate active user time from upload, vendor queue, rendering and review turnaround. Human pre-post approval conflicts with instant completion unless capacity is actually available. Measure both clocks before publishing a timing claim.
- **A job's financial identity must survive deletion.** Deleting a run cannot restore credits, erase spend evidence or delete a file needed by another project. Canceling a subscription cannot make already paid exports disappear accidentally. Accounting and editable projects need different lifecycles.
- **Annual cash is not annual profit.** Quotas and review work continue for twelve months. Reserve vendor/service obligations and refunds; define monthly credit release, no-rollover/rollover, upgrade proration, annual cancellation access and failed renewal treatment. Do not front-load all annual credits accidentally.
- **Acquisition can erase the apparent margin.** At cheap-model Starter contribution around $20.66 before hosting/support, paid acquisition payback depends heavily on actual retention. Churn after one launch can make the product a one-time task sold as a subscription. Do not estimate lifetime value from a hopeful twelve-month tenure.
- **Language and app-claim accuracy.** Text expansion, font availability, emoji, RTL/CJK and generated words over app screens affect usable exports. Start with a declared supported set; avoid inventing product features or testimonials in templates.
- **Source/render reproducibility.** Capture model/version, input snapshot, font files/licenses and the render specification. A vendor output URL can expire, browser fonts can differ from ffmpeg, and an edited project must still export the same intended video tomorrow.
- **Privacy and abuse have operational consequences.** Face photos and screen recordings can contain private people, API keys or customer data. Keep them private, minimize retention, explain vendor processing and offer deletion. Handle takedowns without destroying unrelated customers' projects; keep only the minimal financial audit records required for the operation.
- **A narrow failure policy beats a bigger roadmap.** State what happens for a bad likeness, unsupported phone file, provider rejection, lost job, delayed review or takedown. Measure these cases, manually rescue a small pilot, and fix repeated failures before adding another feature category.

The recommendation is to proceed with a bounded paid pilot after the core deliverable and permissions are real. Keep the app-founder focus. Prove the production workflow and useful expert feedback; do not promise a profitable high-volume generation service, unlimited personal attention and guaranteed distribution from the same unmeasured budget.

## 7. Checks

Application restored to `a45f9bb`; no application changes retained. The three required checks were run against that code after rollback. Output:

```text
$ npx tsc --noEmit
[no output; exit 0]

$ npx eslint src
[no output; exit 0]

$ node scripts/review-checks.cjs
PASS: sound migration, piece/gap timing, malformed sections, storage recovery/concurrency, byte ranges, coalesced saves, bounded filmstrip cleanup
[exit 0]
```

Production build also succeeded in a separate `/tmp/mavya-review19-*` snapshot with a physical dependency copy. The first snapshot attempt used a node_modules symlink and Turbopack rejected a link leaving its root; that was a test setup failure, not an application defect. The successful build did not replace the founder's `.next` directory or restart the founder's server.

API checks used only the isolated server/store: anonymous list/create, valid title update, malformed sections/analysis, malformed multipart, spoofed MIME upload, byte range and 21-to-20 sound truncation. All review-created runs/references/assets were removed from that isolated store. The actual local inventory was read only: 331 references, one run, 113 assets, 234 visible curated records. No founder run was deleted or edited.

Browser checks used headless Chrome with `--mute-audio`: desktop/mobile layout, pricing normal/reduced-motion completion and re-entry, fast step switching, and media/visibility diagnostics. Baseline lifecycle findings are also directly evidenced in the restored source. This is not an exhaustive browser/device matrix. The temporary candidate implementation and extra regression changes were undone, not delivered as fixes.
