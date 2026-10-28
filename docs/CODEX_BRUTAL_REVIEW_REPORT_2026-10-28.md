# Brutal review and fixes, 2026-10-28

## Verdict

The complaint was justified. Missing route fallbacks were only one cause. Opening a video still awaited the catalog; selecting a hook could create an empty run before a second save failed; auth could wait without useful feedback. The commit titled "Open videos without waiting for the library" still contained a Promise.all dependency on that library.

This branch adds immediate link feedback, destination skeletons, atomic retry-safe creation, independent video loading and feedback for additional mutations. It removes unsafe request-triggered cover writes and mixed-account module caching, and restores live Auth user checks.

**The literal 100 ms criterion is not fully met: 3/51 after observations exceeded it, maximum 105.5 ms.** The complete before/after table and any 100 ms misses are below. These fixtures do not certify production INP or every click on every device.

## Scope and safety

Branch: codex/brutal-review-2026-10-28, created from local main bc79ce9. That adds the request document above application commit 2ced350. Reviewed the complete four requested diffs and their affected navigation, authorization, media, deletion and creation paths.

All commits use kamrunnahar00004-creator. Nothing pushed, merged or deployed. No real account creation, Stripe, fal, Gemini, email, render-service or R2 writes. Browser API traffic used offline fixtures; audio was muted. No scraping. No founder .data or .env changes or commits. Tests use temporary directories, stubs and disposable network-disabled PostgreSQL.

Prices, allowances, model/prompt selection, no-confirmation policy, Google flow, ID-based admin policy, text presets and default font remain. No new migration or environment variable. Skeletons preserve the app shell and major destination structure; exact pixel/CLS parity on every responsive breakpoint was not certified.

Read the target repository's AGENTS.md and installed Next 16.4 navigation/loading documentation; searched Ruflo mavya decisions. No specialized skill applied. Sites, image generation and OpenAI product documentation skills were unnecessary.

## Findings and fixes

Navigation numbers refer to the measurement table. Race/security findings use behavioral counts rather than invented latency.

| ID / severity | File evidence and concrete scenario | Fix / commit | Before / after evidence |
| --- | --- | --- | --- |
| F1 Blocker: cold navigation looked ignored | src/components/pending-link.tsx:6; src/components/navigation-feedback.tsx:8; src/components/app-shell.tsx. No destination fallback appeared before routing/proxy work | Nine loading files, immediate local link state and destination skeleton, synchronous acknowledgement before Next work. Covered page is inert; stalled client navigation has a retry error after 15 seconds. dd58dcd, 4c6a2fd, 463b2c8, ef8cad2 | Loading files 0 -> 9. Main navigation timing below. This does not make the allowance RPC faster |
| F2 High: hook-based creation could leave an empty run or duplicate runs | src/components/library-view.tsx:31; src/components/reference-view.tsx; src/app/api/runs/route.ts:13; src/lib/server/store.ts:183. POST succeeded before a separate source PATCH failed | Source, title and trim are in the initial insert. Client UUID persists across retries; duplicate identities do not overwrite existing rows. Ref guards stop double clicks. All three entry points show a video skeleton and prefetch only the requested shell in parallel with POST. Deadline 30 seconds. fde4e95, d598ec1, 31bd8fb, 4c6a2fd | Initialization mutations 2 -> 1. Two concurrent identical store calls -> one owned row. Foreign-owner collision cannot read/overwrite it; missing source fails before insert |
| F3 High: the catalog controlled whether a video opened | src/components/run-view.tsx:88. Promise.all held a successfully loaded video behind a slow/failing library request | Independent fetches; unselected videos open without the catalog. Selected reference is fetched directly, including outside the list window. dd58dcd, d598ec1 | Measured with 1,500 ms catalog versus 250 ms other API delay. Open-video timings below |
| F4 Medium: partial recipes could reach editing consumers | src/components/run-view.tsx selection/load effects; src/components/source-picker.tsx:38. Short recipe could reach shotList before the full fetch; incoming list could replace a hydrated entry | Await full reference before applying a partial pick, with busy feedback. Initial selected source is full before readiness. Preserve full entries against partial pages. dd58dcd, d598ec1 | Best-effort background hydration -> awaited owned API result. Short outgoing lists remain; server generation independently loads full references |
| F5 High: cover fill could overwrite curator edits | scripts/backfill-covers.mjs:45; former fillCovers in src/lib/server/covers.ts. Re-reading immediately before replacing the entire JSON is not concurrency control | Removed request-triggered fill. Manual backfill is curated-only, verifies current thumbnail and compares serialized JSON before updating. Concurrent change returns no updated row and is reported as failure. 5deb172, 4ec125b | Up to 6 derivative writes per list GET -> 0. Unconditional replacement -> conditional replacement. Script was not run against hosted PostgREST/R2 |
| F6 Medium: derivative grant scope was too broad | src/lib/server/covers.ts:8. Any listed row with smallCover and matching thumbnail text could get a signature | Sign curated derivatives only; match the complete canonical media path. Owned references keep normal access-controlled thumbnails. 5deb172 | Fixture signs one valid curated key; user-owned, missing-flag and foreign-URL variants get none. Defense in depth, not a demonstrated public exploit: user PATCH currently permits inline JPEG segment thumbs and does not expose smallCover |
| F7 Medium: covers were outside account cleanup | src/lib/server/account-deletion.ts:44. Derived keys were absent from deletion's media snapshot | Append deterministic cover keys after existing keys, preserving stored cursor meaning. Storage and old auth-phase deletions complete derivatives before auth removal. Keep strict bounded deletes; no late request-side creation. 5deb172 | Original-only -> original and derivative cleanup. Fixture exercises old auth-phase cursor too. Up to one extra missing-object DELETE per media ID |
| F8 Medium: broad claims-only authorization changed identity freshness | src/lib/server/who.ts:6; src/lib/server/usage.ts:12; src/lib/supabase/server.ts. Valid local JWT claims are not a current user record | Restore getUser through getSessionUser in currentUser/adminUser. Keep closing-account checks and admin UUID matching. Remove unused helper. 4e8d750, dd58dcd, 3c1b1f5 | Claims-only decision -> live Auth user lookup. Null user and closing-account deny; recreated UUID has no admin bypass. This restores an Auth request and is not a speed win |
| F9 Medium: mixed library cache lacked account scope/invalidation | src/lib/library-cache.ts:7. A session change within a surviving module could reuse prior owned references; edits/uploads could remain stale | Remove mixed module cache and eager dashboard warm. Each mount reads current API; errors are not cached. e8ad8c0 | Account-change fixture returns new response rather than old promise. Normal signOut already reloads the document, so its ordinary button was not a demonstrated cross-account leak. Fresh-read cost is reported below |
| F10 Medium: all=1 broke image batches and could truncate continuation | src/lib/server/list-pages.ts:8 and thumbnail mapping. A 2,000-ID image URL exceeds the handler's 24-ID bound. A hosted 1,000-row cap looked like the final page of a 2,000 request | Keep the 2,000-item window. Group images by <=24 IDs. Cloud keyset batches <=500 rows, <=8 queries per HTTP request, with owner/scope filters each time and continuation at budget exhaustion. e8ad8c0, 2ac8b06 | 2,301 references reachable under simulated 137-row server cap, including beyond 2,000. Valid image URLs. Existing 5,011-reference/1,011-run/2,011-asset paging checks pass |
| F11 Medium: auth open/close/provider setup delayed acknowledgement | src/components/auth-modal.tsx. getUser preceded the modal; closing awaited URL state; provider setup could take the feedback frame | Checking-account overlay; synchronous local dismissal; query-only native history close; paint loading before provider work with a hidden-tab escape. Pause covered background videos, restore only previously playing muted videos after removal can paint. d598ec1, 196b0be, cf93a1d, 70a8d1a, ef8cad2 | Auth timings below. Playback fixture stops current/late play attempts and never restarts deliberately paused or audible media |
| F12 Medium / low: misleading pending/error behavior | src/components/runs-list.tsx:127; src/components/reference-view.tsx:27; src/components/settings-shell.tsx; src/components/profile-view.tsx; src/components/account-chip.tsx:16 | Delete pending states; rename rollback; reference PATCH error checks; reload loading/error reset; avatar-remove busy state; reject non-OK profile payloads. Read failures no longer definitively claim missing content; catalog failures get errors. dd58dcd, d598ec1, 8f3b1a4 | Failed rename no longer retains unsaved optimistic title; profile 503 no longer reaches initials as an invalid Profile. Existing last-good-profile and settings outage fixtures pass |
| F13 Low: stale image failure and hover blanking | src/components/source-picker.tsx:415 and HookCard; dynamic editor in run-view.tsx | Track failed URLs rather than permanently disabling covers; original thumbnail fallback; keep still under incoming hover video. Explicit modal loading fallback for editor chunk. dd58dcd | New signed URL is eligible after old one fails; still stays mounted during preview load. Editor feedback and usable times below |

## Verdict on Claude's four commits

### c826afd: keep curated covers; reject unsafe automatic writes

The reported 331-row production backfill is an input, not an operation repeated here. Existing curated small covers remain useful; the bucket is not made public.

Six items per request did not bound total concurrent requests. A list GET could download/decode images, write objects and replace whole rows. The after() fill is removed rather than made more concurrent. Sharp is now only in the explicit maintenance script, not the list request runtime.

The manual script fails closed when its thumbnail/JSON changed. This is source-reviewed protection, not a claim of hosted execution. Missing covers use the existing fallback; new covers require explicit maintenance.

Future deletion handles derivatives addressable from the snapshot. Already-completed deletions that cleared their IDs cannot be retroactively repaired by guessing object ownership. No speculative bucket cleanup was attempted.

### 364dd97: revert the broad authorization switch

getClaims is valid signature/expiry verification, not inherently broken cryptography. The problem was adopting that freshness policy for every currentUser/admin operation and asserting an assured one-hour maximum without verifying hosted configuration.

Server operations again use the shared getUser helper. Non-admin IDs short-circuit adminUser before another Auth lookup; actual configured admins still require identity verification (3c1b1f5). Proxy and route cookie-refresh behavior remains; admin is UUID-based, never email-based.

This does not certify instant global token revocation. Supabase distinguishes local claims from current user lookup and documents that access tokens can survive sign-out until expiry. Actual sign-out-everywhere latency/TTL were not tested. See [SSR advanced guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide) and [sign-out behavior](https://supabase.com/docs/guides/auth/signout).

### 60c8b44: retain the window, fix transport assumptions

The final client still requests all=1 and can receive up to 2,000 references. The window was not reduced to 500. Batching is internal and bounded; a small hosted cap can give a smaller HTTP page with a valid continuation.

Scope, owner filters and timestamp ties are checked independently of browser filtering. An empty confirming query is possible. Eight-query ceiling prevents unbounded work under an unusually low cap.

This is not unlimited history or global remote sorting. Above the loaded window, users still need continuation before those entries join local sort/style filtering.

### 2ced350: keep slimming; replace cache and dependency chain

Studio all=1 output still strips recipe detail. Full selected references are fetched before use; server generation continues to retrieve authoritative references.

Mixed account data is not retained in an account-agnostic module. Full component-local reference data is protected against a late partial list. Cold video readiness is independent of the catalog.

Removing eager warm/cache can make the catalog itself slower than the old warmed path. That tradeoff is explicit in the measurements.

## Click and navigation measurements

All values are milliseconds, median of three repeats. Last column is the worst after-feedback observation.

| Action | Visual before | Visual after | Usable before | Usable after | Max visual after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Videos to library | 628.1 | 18.8 | 1094.7 | 2320.1 | 30.7 |
| Library to videos | 706.1 | 103.1 | 993.1 | 982.4 | 105.5 |
| Videos to settings | 377.5 | 34.5 | 657.3 | 690.4 | 36.6 |
| Settings to plans | 358.7 | 45.9 | 969.1 | 1007.4 | 47.6 |
| Settings to billing | 335.5 | 44.7 | 964.4 | 935.6 | 45.0 |
| Settings to usage | 323.0 | 48.0 | 323.0 | 359.7 | 52.1 |
| Settings to videos | 666.8 | 25.8 | 979.1 | 972.3 | 39.5 |
| Open video | 665.0 | 46.6 | 1317.4 | 1135.9 | 68.9 |
| Video to videos | 37.6 | 38.2 | 991.0 | 976.5 | 57.8 |
| New video | 28.7 | 21.3 | 1559.7 | 1350.7 | 21.6 |
| Use library hook | 1477.1 | 40.6 | 2079.4 | 1384.6 | 53.5 |
| Open editor | 29.1 | 60.5 | 417.7 | 569.7 | 64.3 |
| Reference detail (route probe) | 352.7 | 80.2 | 1055.3 | 1059.3 | 94.3 |
| Legacy edit redirect (route probe) | 655.4 | 44.4 | 1678.6 | 1760.8 | 46.1 |
| Landing to signup | 700.9 | 52.1 | 701.2 | 785.8 | 71.6 |
| Close signup | 442.2 | 83.9 | 442.2 | 84.1 | 100.7 |
| Signup to pricing (SDK and continuation stubs) | 96.9 | 40.8 | 1072.0 | 1060.0 | 76.9 |

**Hard 100 ms criterion: not fully met. 3 of 51 after observations exceeded 100 ms; maximum 105.5 ms.** These observations were not discarded. The conservative two-frame proxy can include scheduler delay, but this is not a clean every-click acceptance pass.

- Library to videos, repeat 1: 103.1 ms.
- Close signup, repeat 2: 100.7 ms.
- Library to videos, repeat 3: 105.5 ms.

The catalog-content regression is real: removing the mixed warm cache changes a warmed visit into a fresh read. Editor usable time also increased in this profile even though its explicit loading feedback improved. I would not label the entire app faster based on these results.

Raw evidence: [browser measurements](CODEX_BRUTAL_REVIEW_SPEED_2026-10-28.json), [proxy transport fixture](CODEX_BRUTAL_REVIEW_PROXY_SPEED_2026-10-28.json). Browser timings use client source f809f8d; the subsequent server-only admin short circuit does not execute in the intercepted APIs and was verified separately.

Protocol:

- Dedicated muted headless Chrome, 1440 x 1000, CPU 2x, network latency 250 ms, 10/2 Mbps.
- Three repeats per path/revision, browser cache cleared per source, source checks require actual loaded controls.
- Normal API stub delay 250 ms; catalog deliberately 1,500 ms to expose coupling.
- Prefetch delayed 2,500 ms; it may finish before click. Not every destination is necessarily unprefetched.
- Visual is first relevant UI/status mutation followed by two animation frames. Script/style/comment insertion and hidden probes are ignored. It is a DOM/frame proxy, not filmstrip pixels or trusted Event Timing/field INP.
- Usable means relevant fixture controls/data, followed by two frames. It does not certify media decode or provider completion.
- Proxy is passthrough only in temporary browser copies. Browser Auth SDK is a 250 ms stub; continuation is a stub redirect to the real local Pricing page. Real access decisions are covered separately by gate/handler/SQL suites.
- Reference-detail and legacy-edit rows use hidden client-link probes only in temporary copies. Legacy edit redirects to the shared studio, not a second editor.
- Incomplete preliminary runs were rejected after readiness/instrumentation bugs were found. The raw artifact contains the complete final run.

## Paid-check cache decision

No entitlement cookie/cache added. Each protected navigation/write still performs its authoritative paid check; checkout/webhook reconciliation is not bypassed.

Actual updateSession with an offline 250 ms allowance transport measured median **251.3 ms** over nine allowed navigations. Ten requests including a subsequent unusable plan caused ten reads; the unusable one redirected to Pricing. This models transport, not live Supabase performance.

The Vercel/Supabase servers are co-located in the US; their RPC does not inherently incur the founder's Japan-to-US RTT. No live tracing was performed. A loading file alone cannot display before a cold proxy responds. Client acknowledgement now precedes that work. Retaining the check avoids inventing a signed-cookie TTL, rotation and cross-instance invalidation scheme to hide a wait. Existing Stripe delivery/reconciliation latency remains, but no new app cache extends a stale grant after allowance changes.

Restored getUser intentionally adds identity-freshness cost relative to claims-only authorization. React.cache is not assumed to memoize ordinary API route handlers. The non-admin short circuit avoids a second Auth lookup on that path without weakening the real admin check; see [React cache context](https://react.dev/reference/react/cache).

## Other perceived-speed paths

- **Editor:** heavy code remains dynamically loaded; modal fallback acknowledges opening before download. Table separates acknowledgement and usable editor time.
- **Export:** progress becomes zero before save flushing, snapshot/font/PNG work and dispatch. In-flight guard remains. Normal polling stays 2.5 seconds with hidden/error backoff. Admission, rendering and recovery suites pass; no live export/capacity test.
- **Generation:** busy precedes saves/POST. Request identity, recovery, fallback/refund and ambiguity policy remain; normal polling 4 seconds with hidden/error backoff. No paid generation or quality claim.
- **Uploads:** busy before transfer/analysis; file picker is native feedback. Reservation/ownership/MIME/size/ETag checks pass. No bandwidth or malware-scanning certification.
- **Library hover:** still retained under incoming muted preview; no extra background media prefetch.
- **Settings/Billing:** route acknowledgement before requests, visible refresh/loading, existing deduplication and payment-confirmation behavior retained. No live Stripe/SMTP test.
- **Landing/auth/Pricing:** local link acknowledgement, checking-account overlay, synchronous dismissal and painted submit state address separate waits. Background playback is suspended under auth. Browser signup numbers use SDK/continuation stubs.
- **Speed Insights:** retained. Synthetic clicks are not production INP. Field data and real-device traces are still needed for video decode, fonts and large catalog long tasks.

## Validation

    Node 22.23.4
    21 scripts/*-checks.cjs             PASS
    8 scripts/verify-*.cjs              PASS
    npx tsc --noEmit                    PASS
    npx eslint src render               PASS
    npx next build                      PASS, 35 pages
    git diff --check                    PASS

Production build used a physical temporary copy of tracked production source without actual environment/data files. Browser overrides existed only in separate temporary copies. Real proxy and Supabase browser client remain in the product.

Build still emits the pre-existing TikTok Sans automatic fallback-metrics warning. Default font and CSS fallback remain. Passing build does not mean warning-free build.

New fixtures cover curated-only signatures, anchored path matching, live/closing identity decisions, account changes, valid image grouping, low-row-cap continuation, atomic replay/foreign collision, old deletion phases and background playback. Existing suites retain billing/auth, paid gates, SQL/refund ordering, source refusal, retention/upload, text and offline render verification.

API gate inventory remains 35 methods x 5 personas = 175 decisions. Permission to reach a handler is not a tested live 200 for every body.

## Remaining findings and limits

1. **Open acceptance item, strict timing:** 3 conservative after observations exceed 100 ms. Library-to-videos has a median above 100 ms. This branch does not earn an unconditional every-click-under-100-ms signoff. Use the measured verdict, not a universal response or production INP claim.
2. **Medium, catalog latency/size:** fresh reads sacrifice the old warm cache. Database projection still reads full recipe before studio output trimming (list-pages.ts and references/route.ts). Large analysis arrays/full-window rendering can dominate memory/CPU. Future caching must be curated-only or identity-scoped with explicit invalidation.
3. **Medium at scale, loaded-window sorting:** beyond 2,000 references, sort/style tabs cover loaded items until continuation. Correct paging is not global remote sorting.
4. **Medium, historical derivatives:** completed deletions with cleared IDs need an ownership inventory; retargeted/deleted curated references can leave obsolete derivatives. Requires reviewed maintenance, not guessed bucket deletes.
5. **Low / operational, maintenance concurrency:** automatic fill is gone. Manual compare-and-set failure needs investigation/retry; this is not a durable queue. Independent curator edits still have existing whole-row update semantics in updateReference, separate from the removed fill race.
6. **Existing policy matters:** canonical-media retention after unlisting, provider-result age/escalation, advertised Unlimited scripts/priority fulfillment and secure-password-change dashboard settings were not silently changed. Pending inquiries, uncertain generations, deletions, billing conflicts and alerts still need monitoring.
7. **Unverified live:** actual signing/JWKS/TTL configuration, global sign-out timing, regional latency, worker capacity, music rights, real SMTP/payments/providers, and mobile/Safari/Firefox parity.

## Handoff

Review the branch before merging. No migrations or new settings from this review need application. The strict timing acceptance item remains open for review. Acknowledgement before asynchronous work is fixed separately from completion latency. The measurements define the speed claim; no production certification, deployment, push or merge.

