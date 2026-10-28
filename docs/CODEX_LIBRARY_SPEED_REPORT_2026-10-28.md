# Library speed review and fixes, 2026-10-28

## Result

The library regression is recovered in the matched fixture. Videos to Library usable time fell from 2,761.3 ms to 1,159.1 ms. Repeat visits fell from 620.2 ms to 197.8 ms. Library to Videos feedback fell from 239.7 ms to 18.5 ms, with all three final observations below 32 ms.

A first cold document still has a real network/startup cost: 3,601.4 ms became 3,226.9 ms under the deliberately slow 1,500 ms catalog stub. This is not an instant-cold-load or production INP claim.

Branch: codex/library-speed-2026-10-28, from main 7491331. That includes the merged brutal-review fixes and the new request. No push, merge or deployment.

## Chosen cache and alternatives

Chosen: a curated-only request plus a short-lived, immutable in-memory client cache. Restore a background curated warm on the Videos page. No owned rows, full recipes, account identity or entitlement decision enters that cache.

| Approach | Decision and evidence |
| --- | --- |
| Curated-only module cache | Chosen. Requests coalesce across Videos, Library and the hook picker. The repeat test makes no additional catalog request. Scope is enforced in the database query and verified again before caching |
| Private HTTP cache alone | Not chosen for this path. Catalog replies are private, no-store, so cookie-bearing responses are not reused and HTTP age cannot stack with module TTL. Other existing API modes retain their policies |
| sessionStorage | Not needed. Avoid persisting signed URLs and snapshots across reloads or managing storage limits. A full reload intentionally starts fresh |
| Server projection cache / use cache | Could help a genuinely DB-bound cold request, but was not needed for the observed client/render bottlenecks. It adds another freshness window and invalidation for API edits and out-of-band curator scripts. No live DB timing justified that extra cache here |

No paid-plan cache, entitlement cookie, new environment variable or migration. getUser identity checks remain unchanged.

## Who can see what, and staleness

- GET /api/references?view=catalog&scope=curated&all=1 authenticates through currentUser/getUser and queries owner = curated on every database batch. A catalog request with a different scope is rejected before reading data.
- All users receive the same curated card projection. The cached page contains reference IDs and public catalog metadata, not user/account IDs or owned references. Existing pending/drop flags are still filtered by the UI; this does not introduce a new secret/published classification.
- Client validation rejects any response containing a non-curated row or lacking its partial marker. It does not silently cache the valid portion of a mixed response.
- The cache is frozen recursively. Components cannot change shared arrays or nested metadata in place.
- TTL is 60 seconds from request START, not completion. Wall and monotonic clocks both participate, so a rollback or frozen wall clock does not extend reuse. An expired or failed entry is never returned as stale-while-revalidate.
- Same-tab reference save/delete invalidates the module after success. A pre-edit request that finishes late cannot repopulate the cache: its callers are redirected to the current fetch.
- Out-of-band curator edits can remain in a REUSED module snapshot for at most 60 seconds. The next load after expiry fetches again, with a 15-second client request deadline. Failure is reported rather than extending the old entry.
- This is request-cache freshness, not a live subscription. An already rendered page remains a snapshot until its ordinary load/reactivation/reload; an offline or already open screen does not receive pushed curator edits. That was also true before this cache.
- Owned references remain on uncached per-request paths. Selected references/recipes are fetched explicitly with cache: no-store before use; uploads and edits are not merged into the module cache. Continuation pages are curated-only but always fetched fresh.
- Normal sign-out reloads the document and discards the module. Even an SDK account change within a surviving tab can reuse only identical curated data. It cannot retrieve the previous user's owned references from this cache.
- Existing cover grants have substantially more remaining lifetime than the 60-second cache window: the existing default signed-read cache retains at least about 31 minutes. No grant or expiry policy changed. Canonical media IDs are immutable.
- Inline thumbnail batch URLs get a new snapshot version on each catalog fetch. A refreshed metadata snapshot therefore does not reuse the old five-minute SVG thumbnail response. No server or bucket purge is claimed for arbitrary external image rewrites.

Cached metadata never authorizes generation, storage or billing. Existing proxy/API ownership, paid checks and live identity decisions remain authoritative.

## Smaller database and API payload

src/lib/server/list-pages.ts now projects the current card path at the database level. It selects card statistics, source identity, caption/summary, style and review verdict, and only analysis.segments[0].thumb. It does not retrieve the full analysis, recipe, history or model explanations for that path.

The projection becomes a partial Reference with analysis = null and no recipe. A partial pick goes straight to the normal full-reference/server-create path, rather than trying to analyze and PATCH a curated video because analysis is absent.

Raw/detail-rich modes remain available for consumers that need complete references. The current catalog and studio all=1 card projections use the compact query. Existing owner filters, 2,000-item window, 500-row database batches, eight-query ceiling and cursor behavior remain.

| Quantity | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| DB response JSON | 27,596,021 B | 195,510 B | 99.3% |
| API response JSON | 7,739,376 B | 263,363 B | 96.6% |
| API gzip | 72,356 B | 8,631 B | 88.1% |

These are matched SYNTHETIC bytes, not the founder's live database. The fixture has 331 curated rows plus two private sentinel rows, including substantial analysis notes, extra thumbnails and recipes. The actual before/after list and API handler code runs against a projected PostgREST-response simulation. API gzip is measured too; production compression and content sizes will differ.

Both sides perform two DB reads for the 331-row fixture, including the empty confirming batch. This proves lower result/serialization bytes, not lower physical disk I/O or measured PostgreSQL CPU. JSONB extraction can still require detoasting. No production EXPLAIN or capacity claim.

Tests verify that Alice/Bob private sentinels never appear in the cached catalog, while the fresh mixed route still returns only the caller's owned row. Full selected recipe access remains separate.

## Render cost and the navigation miss

The pre-change 2,000-card probe produced 1,272, 1,363 and 1,439 ms longest tasks. That established a real problem before choosing progressive rendering.

The final matched stress run:

| 2,000-item first visit | Before | After |
| --- | ---: | ---: |
| Usable content, median ms | 7494.6 | 3341.4 |
| Largest observed main-thread task per visit, median ms | 2515.0 | 128.0 |
| Initially mounted cards | 2000.0 | 48.0 |
| Worst observed task, ms | 2791 | 435 |

The largest-task statistic includes document boot, script work and layout/paint, not just React rendering. The after run still has long tasks, including a 435 ms worst startup observation. This is not a claim of zero long tasks or certified field INP.

Changes in src/components/source-picker.tsx:

- Filter/sort the full fetched catalog first, memoized by its actual inputs.
- Initially mount 48 cards. Append batches of 48 ahead of scroll using a 600 px observer margin.
- Append ahead of keyboard focus too. Preserve ordinary Tab order instead of introducing a different keyboard model.
- Offscreen mounted cards use content-visibility: auto. Card dimensions, grid gap, copy and controls remain.
- This is progressive mounting, not constant-memory virtualization. Browsing the whole window can eventually mount all 2,000 cards.

The independent browser check reaches all 2,000 unique cards, confirms focus at index 32 grows the batch to 96 without losing focus, and Tab continues to index 33. Filtering still sorts the full input; a high-view item at the far end appears first. Card geometry in the tested desktop viewport is 140 x 248.875 px.

For Library to Videos, diagnostic runs showed the handler and first relevant DOM mutation completed around 10-20 ms while the two-frame feedback marker could exceed 100 ms. That placed the remaining gap after acknowledgement, rather than in the allowance RPC.

src/components/navigation-feedback.tsx now sets content-visibility: hidden on the covered old page while the opaque destination skeleton is shown. It restores the original style and inert state on completion/cancellation. This avoids retaining the old grid's layout/paint work behind the new screen. The browser check confirms the destination becomes visible and non-inert.

That explanation is supported by the handler/DOM timings and the improvement after excluding the subtree; it is not a low-level GPU trace.

## Before/after timings

All values are milliseconds, medians of three repeats:

| Action | Feedback before | Feedback after | Usable before | Usable after |
| --- | ---: | ---: | ---: | ---: |
| Videos to library | 30.4 | 43.5 | 2761.3 | 1159.1 |
| Library first visit | 1159.7 | 1181.4 | 3601.4 | 3226.9 |
| Library repeat visit | 34.3 | 24.6 | 620.2 | 197.8 |
| Library to videos | 239.7 | 18.5 | 1065.0 | 939.2 |
| Open video | 28.3 | 25.8 | 1080.3 | 1094.3 |
| Use library hook | 49.7 | 26.5 | 1912.8 | 1388.5 |

Library to Videos final observations are 31.1, 17.9 and 18.5 ms. The old 103.1 ms result used 40 fixture records; this matched comparison uses 331 on both sides, so its baseline is different.

Protocol matches the brutal review's transport and CPU setup: dedicated muted headless Chrome, 1440 x 1000, CPU 2x, 250 ms network latency, 10/2 Mbps, normal API delay 250 ms and catalog delay 1,500 ms. Browser cache is disabled/cleared for each new source document; the same-document repeat deliberately preserves the module cache. Prefetch delay is 2,500 ms and can finish before a click.

The first-visit row measures a cold document, not a click on an already hydrated app. Feedback there is initial loading UI. Other rows measure actual existing app controls.

Usable means fixture controls/data followed by two frames. Feedback means a relevant DOM/status change followed by two frames. Script/style/comment mutations are ignored. These are conservative DOM/frame proxies, not video pixels or trusted Event Timing/production INP.

The baseline is main 7491331. Browser copies have a temporary passthrough proxy and intercepted APIs, with external requests blocked. This isolates client/cache/render behavior and does NOT measure live auth, database, R2 media or regional production latency. The real product proxy and browser SDK are unchanged.

Videos-page warming performs a common-data GET in the background. It does not eliminate that request; it coalesces it with the subsequent library visit. Repeat visits make no additional catalog GET while fresh. Open-video usable time is essentially flat, not an improvement worth claiming. The cold first visit still pays the deliberately injected network wait.

[Raw measurements and payload evidence](CODEX_LIBRARY_SPEED_2026-10-28.json) include every final sample, initial render evidence, diagnostic runs and functional checks. No runtime browser exceptions in the final runs.

## Commits and validation

| Commit | Change |
| --- | --- |
| 075b40d | Compact database projection and curated catalog response |
| 1fadade | Curated-only bounded cache, warm, fresh full references and invalidation |
| 26806e6 | Progressive card mounting after the measured large-window long tasks |
| ce5795a | Skip painting the covered page; portable historical payload fixtures and browser checks |

Validation on final functional source:

    Node 22.23.4
    21 scripts/*-checks.cjs             PASS
    9 scripts/verify-*.cjs              PASS
    npx tsc --noEmit                    PASS
    npx eslint src render               PASS
    npx next build                      PASS, 35 pages
    git diff --check                    PASS

The payload/cache verification is portable: immutable baseline source fixtures are committed under scripts/fixtures, so normal checks do not depend on a /tmp checkout or live services. Browser measurement scripts are manual and require the isolated fixture servers.

Production builds used physical temporary copies of tracked source without actual .env/.data files. The real proxy was used for the production build, then replaced only in temporary browser fixture source before its separate fixture build. The existing TikTok Sans automatic fallback-metrics warning remains; passing build does not mean warning-free build.

No real fal, Gemini, Stripe, email or R2 writes. No founder .env/.data changes. No paid/entitlement cache, authentication weakening, price/plan/font/preset changes, new helper copy or scraping. All commits use kamrunnahar00004-creator.

## Limits and handoff

- No live production latency, database load, media playback readiness or mobile/Safari/Firefox certification.
- A first cold load cannot reuse a module that does not exist yet. Its measured cost is explicit above.
- Catalog re-use is bounded; currently rendered screens are snapshots, not live curator subscriptions.
- Progressive rendering preserves all fetched entries but is not a globally sorted remote catalog beyond the existing loaded window.
- A fully browsed 2,000-card DOM can still be expensive. Initial large-window cost is reduced; universal sub-100 ms interaction is not promised.
- No server cache, new environment variable or migration needs rollout. Review the branch before merging. Nothing pushed, merged or deployed.
