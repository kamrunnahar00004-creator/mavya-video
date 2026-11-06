# Speed report — 2026-11-06

**Verdict: the app is responsive once loaded, but it is not “no delays anywhere.”** Cold editor-page readiness is about 2.27 seconds in this fixture. Several navigations still take 0.85–1.17 seconds to become usable, despite immediate feedback. A six-second browser export takes about 9.64 seconds and creates main-thread tasks up to 151 ms. Full p480 playback reported two dropped frames in three runs. Preview preparation can wait behind exports, and missing-copy checks are cached for 20 seconds. Live Auth, database, storage, Render queue/cold start and field INP remain unverified.

Measured HEAD: `e2edca9066ba518b4a03b3d7177e454879c4098e` (seamless cuts), Next 16.4.5, Node 22.23.4. No product fixes, commits or pushes. Tracked files have no diff. All harness edits, builds, fake services and media live under `/tmp`; this report is the sole new deliverable.

## What the numbers mean

The browser profile matches the earlier harness's **1440×1000 viewport, 2× CPU throttle, 250 ms network latency, 10/2 Mbps, disabled cold browser cache and 250 ms API fixture delay**. The historical navigation/library harness additionally retains its 1,500 ms catalog delay and 2,500 ms prefetch delay. The expanded UI fixture uses 250 ms for every API, 24 history runs, 60 references and 100 uploads. Three rounds unless stated otherwise.

**Browser mismatch:** the available Linux Chrome for Testing is **142.0.7444.61**; the historical JSON labels its browser Chrome 156. These are cross-version comparisons, not an isolated proof that a commit caused a regression. All increases of 100 ms or more are flagged nevertheless. Historical profile strings inside reused scripts are descriptive boilerplate, not browser-version detection.

The physical build copy is `/tmp/mavya-speed-20261106`, copied from tracked HEAD without `.env*` or `.data`. Only there: passthrough proxy, dummy browser Auth SDK, hidden route-probe links, and Turbopack root `/` to resolve the shared dependency symlink. The fixture build passes compilation and TypeScript; the existing TikTok Sans fallback-metrics warning remains. The installed Next build/proxy/font guides were read before these harness changes.

The old run response stub needed the current `?view=editor` contract, `{run, source}`. Route probes must dispatch the same pending-navigation event as the app's `pending-link`; plain Next links omit that feedback. Corrected probe samples replace the preliminary ones. Initial failed fixtures, unactivated autoplay samples and the no-op Volume-slider probe are excluded from the findings below.

Feedback/input-to-paint is handler dispatch through two animation frames. Usable means the fixture's destination data/control predicate followed by two frames. These are conservative DOM/frame proxies, **not hardware display latency, trusted Event Timing, field INP or a promise of instant media decoding**. Most actions use programmatic clicks/input events; the continuous timeline drag uses CDP mouse input. Full playback uses CDP's user-gesture flag so audible autoplay is permitted.

Browser API interception never reaches a production server. Separate server measurements execute the actual built route handlers with local dummy Supabase Auth/PostgREST and dummy storage fetches: Auth response bodies wait 8 ms, SQL bodies 12 ms, file-preference storage 15 ms. No production credentials are used. Error/disabled-path probes below are explicitly distinguished from successful work.

## Navigation: every original brutal-harness scenario

Milliseconds; medians of three. “Old” is the **after** column in `docs/CODEX_BRUTAL_REVIEW_SPEED_2026-10-28.json`, not its pre-fix column. Positive deltas are slower. “REGRESSION” means at least +100 ms in either metric, subject to the browser caveat above.

| Scenario | Old feedback | Now feedback | Δ feedback | Old usable | Now usable | Δ usable | Flag |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Videos to library | 18.8 | 14.8 | -4.0 | 2,320.1 | 1,004.4 | -1,315.7 | — |
| Library to videos | 103.1 | 9.2 | -93.9 | 982.4 | 1,158.5 | 176.1 | REGRESSION |
| Videos to settings | 34.5 | 7.3 | -27.2 | 690.4 | 540.4 | -150.0 | — |
| Settings to plans | 45.9 | 10.2 | -35.7 | 1,007.4 | 1,159.7 | 152.3 | REGRESSION |
| Settings to billing | 44.7 | 10.7 | -34.0 | 935.6 | 1,143.9 | 208.3 | REGRESSION |
| Settings to usage | 48.0 | 8.1 | -39.9 | 359.7 | 290.7 | -69.0 | — |
| Settings to videos | 25.8 | 10.1 | -15.7 | 972.3 | 1,172.3 | 200.0 | REGRESSION |
| Open video | 46.6 | 8.7 | -37.9 | 1,135.9 | 867.9 | -268.0 | — |
| Video to videos | 38.2 | 9.9 | -28.3 | 976.5 | 851.8 | -124.7 | — |
| New video | 21.3 | 15.6 | -5.7 | 1,350.7 | 1,114.7 | -236.0 | — |
| Use library hook | 40.6 | 8.7 | -31.9 | 1,384.6 | 1,109.1 | -275.5 | — |
| Open editor | 60.5 | 19.7 | -40.8 | 569.7 | 502.1 | -67.6 | — |
| Reference detail (route probe) | 80.2 | 12.3 | -67.9 | 1,059.3 | 861.6 | -197.7 | — |
| Legacy edit redirect (route probe) | 44.4 | 17.4 | -27.0 | 1,760.8 | 1,417.0 | -343.8 | — |
| Landing to signup | 52.1 | 19.2 | -32.9 | 785.8 | 294.9 | -490.9 | — |
| Close signup | 83.9 | 26.6 | -57.3 | 84.1 | 26.6 | -57.5 | — |
| Signup to pricing (SDK and continuation stubs) | 40.8 | 29.9 | -10.9 | 1,060.0 | 901.0 | -159.0 | — |

All 51 original-scenario samples completed without missing controls, timeouts or browser exceptions. The four real navigation usable-time candidates are Library→Videos, Settings→Plans, Settings→Billing and Settings→Videos. They share destination data/chunk work under the cold-cache/prefetch stress. The fixture does not identify one responsible source change; trace the route request and destination render before changing caching.

Opening the editor deserves both numbers: in the old empty-run cold-chunk scenario, feedback and readiness differ substantially. In the expanded, already-warmed populated-run fixture, the editor paints in about 34 ms. The latter does not replace the former.

## Library: later October 28 comparison, 331 records

The later library report uses 331 records, so its baseline must remain separate from the 40-record brutal harness. This reruns all six scenarios from that report with the same catalog count and delays. First visit measures a whole cold document; repeat visit preserves the same-document catalog cache.

| Scenario | Old feedback | Now feedback | Old usable | Now usable | Δ usable | ≥100 ms slower? |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Videos to library | 43.5 | 9.7 | 1,159.1 | 971.8 | -187.3 | — |
| Library first visit | 1,181.4 | 932.7 | 3,226.9 | 2,800.8 | -426.1 | — |
| Library repeat visit | 24.6 | 17.0 | 197.8 | 283.3 | 85.5 | — |
| Library to videos | 18.5 | 16.7 | 939.2 | 1,166.3 | 227.1 | YES |
| Open video | 25.8 | 8.2 | 1,094.3 | 868.2 | -226.1 | — |
| Use library hook | 26.5 | 10.3 | 1,388.5 | 1,105.8 | -282.7 | — |

The first view still mounts 48 catalog cards. Repeat catalog requests remain zero while the module cache is fresh. The 60-second curated-only cache is present; no case here justifies introducing a cross-user cache for private data.

The historical 2,000-record cold-document stress was also rerun separately:

| Metric | October 28 after | Now | Delta / interpretation |
| --- | ---: | ---: | --- |
| Usable, median ms | 3,341.4 | 2,821.2 | −520.2 ms |
| Largest >50 ms task per visit, median ms | 128.0 | None observed | Not a zero-main-thread-work claim |
| Initially mounted cards | 48 | 48 | Progressive mounting retained |

All three current stress visits made one catalog request and mounted 48 cards; usable times were 2,842.0 / 2,821.2 / 2,804.6 ms. No runtime exceptions. This reruns initial load, not the old full-scroll/focus functional traversal or a many-thousand-item My files test. The Chrome mismatch still applies.

## Editor and My files

Expanded populated-run fixture, paused unless stated. All values below are milliseconds, medians of three; no missing controls or runtime exceptions in the final interaction runs.

| Interaction | Input-to-two-frames | Observed >50 ms tasks during measured action |
| --- | ---: | --- |
| Open editor, warmed chunk | 33.4 | 0 |
| Play feedback | 28.8 | 0 |
| Pause feedback | 65.7 | 0 |
| Scrub editor ruler | 30.3 | 0 |
| Select editable demo clip | 66.7 | 0 |
| Trim clip end | 31.2 | 0 |
| Cut | 33.2 | 0 |
| Add text | 30.4 | 0 |
| Edit text | 14.2 | 0 |
| Undo | 33.3 | 0 |
| Open My files panel | 33.4 | 0 |
| Show Uploaded tab | 67.4 | 0 |
| Enter multi-select | 25.1 | 0 |
| Select all 100 uploads | 30.2 | 0 |
| Change Exposure, verified 0→1 | 28.7 | 0 |
| Switch/open step 1 | 23.4 | 0 |
| Switch/open step 2 | 30.7 | 0 |
| Switch/open step 3 | 30.3 | 0 |
| Switch/open step 4 | 30.9 | 0 |
| Switch/open step 5 | 33.8 | 0 |
| Switch/open step 6 | 37.3 | 0 |

A separate Exposure 0→10 probe took 31.6 ms median; its page-wide task totals include 53 and 62 ms tasks, without attribution to that slider. The verified interaction run records one 60 ms page task outside the strict per-action windows. It is not a zero-long-task certification.

The selection check confirms **100 pressed upload tiles and “100 selected” in all three runs**. The earlier text-content regex accidentally concatenated a preceding digit; it is not evidence of 1,100 files. The panel-opening number is immediate shell feedback: the history/assets/references requests still need their fixture delay. The Uploaded-tab measurement occurs after data has loaded. It is not a measurement of uploading 100 files or of a 500/2,000-item library.

Timeline dragging: 60 CDP mouse moves over about two seconds. Final measured rates/gaps are listed below. This measures scheduling/visual responsiveness, not a display-camera frame count. The clip drag calls `onSeek`, which pauses playback; a separate attempted playing-drag run confirmed that behavior. Continuous playback during a drag is not implemented by this interaction and is not claimed here.

| Drag run | Animation frames/s | Largest rAF gap ms |
| --- | ---: | ---: |
| 1 | 60.17 | 33.3 |
| 2 | 60.13 | 33.3 |
| 3 | 60.10 | 33.4 |

## Full p480 playback

Actual served 480×854, 30 fps, six-second SDR moving test pattern; two three-second segments, fully loaded before play. The initial fixture was created after one server's public-file scan and returned 404; restarting the fixture server fixed that. A second discarded attempt lacked browser user activation and only showed seeks. The final runs below enable user activation and observe actual video-frame callbacks.

| Run | Reported total video frames across both players | Dropped frames | Presented-frame callbacks | Largest within-player presentation gap | Last-hook→first-demo callback gap |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 189 | 0 | 165 | 66.7 ms | 50.0 ms |
| 2 | 188 | 1 | 159 | 66.8 ms | 49.9 ms |
| 3 | 188 | 1 | 165 | 66.7 ms | 50.1 ms |

The players advance through both three-second segments and finish normally, but this is **not a zero-dropped-frame pass**: 2/565 reported frames dropped (~0.35%). Callback counts imply roughly 26–28 observed presentations/second while active; the UI's rAF rate during real playback is only about **36.6 fps**, versus ~60.1 during paused dragging. The 6.7-second whole-playback observation includes a paused tail; the separate 1.8-second steady-play intervals advanced media by 1.800 seconds, decoded 54 frames with zero drops each, and ran UI rAF at about 30 fps. Within-player gaps reach 66.8 ms, and the handoff is about 50 ms. Decoded-frame counters alone would conceal these presentation gaps. One full-playback run records a 51 ms task.

This is a synthetic SDR desktop case, not certification of 4K/HDR uploads, long timelines, slow R2 redirects, phones, Safari or an overloaded worker. First fix to investigate: profile the per-frame `WholeMedia`/`SegmentVideos`/`WholeControls` React work and isolate subscribers to values that change. Keep preview/export frame and color correctness. No measured gain is claimed before that experiment.

## Server/API: fresh processes, successful reads and rejected paths

There are **28 route files and 41 exported HTTP handlers**. Every handler was invoked in its own fresh `next start` process, then twice more in that same process. Thus the table covers every route, including internal callbacks and AI endpoints whose generation work is out of scope.

The median time from process spawn to announced local URL is about **124 ms**. “Cold request” begins after that announcement, includes first route loading/readiness, and does not include process spawn. “Warm” is the mean of two warm requests. OS filesystem cache remains warm; this is **not Vercel function provisioning or Render's remote cold start**. API calls have no browser first-load JS. “Trace” is the uncompressed sum of files in that route's `.nft.json`, including shared dependencies, assets and native binaries; it is neither browser JS nor a Vercel deployment ZIP size.

`Auth/DB` counts are actual dummy HTTP calls observed in the first invocation. DB includes the account-deletion guard and RPCs; a production RPC can execute additional SQL internally. `:id` represents the synthetic UUID. Empty/missing fixtures deliberately return some 4xx/5xx responses: those timings measure rejection/disabled paths only, never successful upload/export, billing or generation latency.

| Route / method | Cold request ms | Warm ms | Status | Auth / DB round trips | Trace MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| `DELETE /api/account` | 418.2 | 169.9 | 503 | 1 / 7 | 3.46 |
| `GET /api/assets` | 253.2 | 42.1 | 200 | 1 / 2 | 14.08 |
| `GET /api/billing` | 184.2 | 4.9 | 200 | 0 / 0 | 2.16 |
| `POST /api/billing` | 183.4 | 4.6 | 503 | 0 / 0 | 2.16 |
| `POST /api/contact` | 210.5 | 4.6 | 400 | 0 / 0 | 14.26 |
| `GET /api/file-prefs` | 265.2 | 45.4 | 200 | 1 / 1 | 14.08 |
| `PATCH /api/file-prefs` | 236.0 | 30.7 | 400 | 1 / 1 | 14.08 |
| `POST /api/media` | 247.8 | 29.8 | 400 | 1 / 1 | 14.03 |
| `GET /api/profile` | 213.6 | 28.6 | 200 | 1 / 1 | 1.94 |
| `PATCH /api/profile` | 236.3 | 52.6 | 200 | 2 / 2 | 1.94 |
| `GET /api/references` | 263.5 | 43.0 | 200 | 1 / 2 | 14.08 |
| `POST /api/references` | 240.1 | 28.6 | 400 | 1 / 1 | 14.08 |
| `GET /api/runs` | 250.8 | 43.2 | 200 | 1 / 2 | 14.08 |
| `POST /api/runs` | 282.2 | 72.3 | 201 | 1 / 4 | 14.08 |
| `GET /api/songs` | 175.5 | 5.4 | 200 | 0 / 0 | 1.63 |
| `POST /api/uploads` | 289.1 | 44.8 | 200 | 1 / 2 | 14.30 |
| `GET /api/usage` | 255.3 | 43.4 | 200 | 1 / 4 | 14.30 |
| `DELETE /api/assets/[id]` | 206.9 | 4.8 | 404 | 0 / 0 | 14.03 |
| `POST /api/internal/export-run` | 202.2 | 4.2 | 404 | 0 / 0 | 149.59 |
| `POST /api/internal/export-step` | 203.9 | 4.8 | 404 | 0 / 0 | 149.55 |
| `GET /api/internal/generations` | 212.2 | 4.6 | 401 | 0 / 0 | 151.44 |
| `GET /api/media/[id]` | 251.7 | 43.6 | 404 | 1 / 2 | 14.08 |
| `GET /api/references/[id]` | 254.6 | 43.9 | 200 | 1 / 2 | 14.04 |
| `PATCH /api/references/[id]` | 257.2 | 43.5 | 403 | 1 / 2 | 14.04 |
| `DELETE /api/references/[id]` | 257.5 | 42.2 | 403 | 1 / 2 | 14.04 |
| `GET /api/references/thumbnails` | 237.3 | 27.2 | 400 | 1 / 1 | 14.08 |
| `GET /api/runs/[id]` | 251.8 | 42.7 | 200 | 1 / 2 | 14.05 |
| `PATCH /api/runs/[id]` | 254.7 | 42.6 | 200 | 1 / 2 | 14.05 |
| `DELETE /api/runs/[id]` | 253.5 | 43.1 | 204 | 1 / 2 | 14.05 |
| `GET /api/songs/[id]` | 207.2 | 4.4 | 404 | 0 / 0 | 14.04 |
| `POST /api/songs/[id]` | 206.3 | 4.3 | 404 | 0 / 0 | 14.04 |
| `GET /api/sounds/[code]` | 251.4 | 27.8 | 302 | 1 / 1 | 90.21 |
| `POST /api/stripe/webhook` | 213.6 | 4.5 | 503 | 0 / 0 | 3.46 |
| `POST /api/runs/[id]/export` | 242.2 | 29.0 | 503 | 1 / 1 | 151.46 |
| `GET /api/runs/[id]/export` | 261.0 | 46.3 | 200 | 1 / 2 | 151.46 |
| `POST /api/runs/[id]/generate` | 238.0 | 29.3 | 400 | 1 / 1 | 146.15 |
| `GET /api/runs/[id]/generate` | 272.0 | 58.4 | 200 | 1 / 3 | 146.15 |
| `POST /api/runs/[id]/hook-text` | 255.7 | 42.8 | 400 | 1 / 2 | 14.26 |
| `POST /api/runs/[id]/product` | 254.0 | 45.1 | 400 | 1 / 2 | 14.26 |
| `DELETE /api/runs/[id]/product` | 257.5 | 43.6 | 200 | 1 / 2 | 14.26 |
| `POST /api/runs/[id]/script` | 260.5 | 43.3 | 400 | 1 / 2 | 14.27 |

Successful read projections were also tested three times in a shared production process, using the app's actual query parameters. These clarify costs hidden by the generic route probes:

| Successful read | Median ms | Observed request structure |
| --- | ---: | --- |
| `/api/profile` | 25.0 | 1 Auth, 1 DB calls |
| `/api/usage` | 38.3 | 1 Auth, 4 DB calls |
| `/api/runs?view=summary` | 50.8 | 1 Auth, 3 DB calls |
| `/api/references?view=catalog&scope=curated&all=1` | 50.5 | 1 Auth, 3 DB calls |
| `/api/file-prefs` | 41.0 | 1 Auth, 1 DB calls, plus storage body fetch |
| `/api/runs/:id?view=editor` | 51.1 | 1 Auth, 3 DB calls |

Important source/call-count findings:

- `currentUser()` serially verifies Auth, checks account deletion, then the route reads data. Those checks enforce authorization; do not remove them to win a fixture benchmark. The temporary proxy bypass excludes the real proxy's `getClaims()` and, on paid routes/pages, allowance RPC. `getClaims()` is not automatically another Auth network round trip: signing mode and cached JWKS matter. Its production cost remains unmeasured.
- Usage starts allowance, subscription and billing work with `Promise.all`, but subscription data is read twice. Coalesce that read within the request. At 12 ms fixture SQL delay this saves one query's work, not necessarily 12 ms wall time because branches overlap.
- `?view=editor` gets the run and then its selected reference. It saves a separate browser request but remains two dependent data reads. A joined projection/RPC can remove one serial DB round trip without guessing the reference before the run is known.
- Summary runs make an additional library read to enrich cards. The curated catalog fixture performs two library reads, including its confirming empty batch. The real `all=1` loop has 500-row batches, a 2,000-row window and eight-query ceiling. Catalog size affects serial round trips; the single-row fixture is not a production load test.
- My files already fetches history, assets and reference cards concurrently. File preferences add separate account/storage work. A 100-item UI test does not justify replacing that with one serial fetch.
- Private read responses use `private, no-store`; the curated client module cache is bounded to 60 seconds. There is no evidence here that private authorization should be cached across requests/users.
- The export trace is **151.46 MiB**: ffmpeg alone is **79,826,272 B**, and traced character files total **63,635,896 B**. Narrowing the export import/filesystem dependency graph could remove roughly 60.7 MiB of character assets; separating ffmpeg-dependent work could remove another 76.1 MiB where not required. These are traced-byte opportunities, not measured cold-start savings.

Billing with Stripe enabled, successful media ownership/redirects, populated songs, export reservation/finalization, internal worker callbacks and AI-related admission are **not happy-path latency-certified** by the error rows. The read fixture does not reproduce DB indexes, contention, query execution plans, RPC internals, storage transfer, region placement or a real production auth session.

## Page JS, first paint and blocking resources

Initial modern-browser script tags from the fixture's HTML, excluding `nomodule`; total bytes count each script once within a page. Gzip is computed locally, not asserted to equal CDN Brotli transfer. Deferred editor/encoder chunks fetched later are additional. The hidden fixture links can affect small shared-chunk packaging.

| Page | Raw initial JS KiB | Gzip KiB |
| --- | ---: | ---: |
| `/` | 766.1 | 218.4 |
| `/pricing` | 760.6 | 217.5 |
| `/studio` | 791.1 | 229.9 |
| `/studio/:id` | 906.9 | 265.7 |
| `/library` | 792.6 | 229.9 |
| `/library/:id` | 785.3 | 227.4 |
| `/settings` | 766.7 | 220.4 |
| `/settings/plans` | 776.6 | 223.8 |
| `/settings/billing` | 775.1 | 223.2 |
| `/settings/usage` | 768.1 | 221.2 |

Measured browser document loads, expanded 250 ms API fixture; medians of three:

| Document | FCP ms | Data/control ready ms | Encoded script bytes observed by readiness |
| --- | ---: | ---: | ---: |
| `/studio`, cold cache | 932.0 | 1,613.0 | 231,345.0 |
| `/studio`, warm cache | 304.0 | 681.8 | 231,345.0 |
| `/studio/:id`, cold cache | 868.0 | 2,272.4 | 268,434.0 |
| `/studio/:id`, warm cache | 320.0 | 917.1 | 292,458.0 |

All external browser requests were blocked, so this isolates first-party startup and does not include production Clarity/analytics overhead. The final expanded load run recorded no >50 ms startup tasks; the separate exposure/selection run recorded 53 and 62 ms page tasks. Small sample sizes cannot rule out other long tasks.

No external synchronous script tags were found in the HTML. Clarity uses `afterInteractive` and loads its tag asynchronously; Analytics and Speed Insights run after client startup. CSS still sits on the rendering path. Font files are self-hosted and use swap behavior, so text does not need to wait for a remote Google Fonts request at runtime. Six fonts are nevertheless preloaded on the root page: **152,320 B total** (Satoshi's four weights plus Geist/Mono). At 10 Mbps that is about 122 ms of ideal payload time before protocol overhead, sharing bandwidth with JS/CSS/images. Review which font preloads are needed on each surface before changing typography. The explicitly high-priority landing cover is only **22,672 B**; it is not a large-image blocker in this fixture. This is not an LCP attribution study.

## Upload, preview preparation and export, excluding AI

These measurements deliberately separate browser orchestration, route overhead and actual local rendering. Do not add the rows together as though they came from one real cloud upload.

| Stage | Measured time | Scope |
| --- | ---: | --- |
| Upload helper dispatches start request | 0.1 ms | Actual `uploadFile`, 1 KiB synthetic file, no input-picker/UI time |
| Upload helper reaches storage PUT | 250.9 ms | Start reply deliberately waits 250 ms; no real storage |
| Upload helper completes | 752.8 ms | Three serial fake transport stages, each 250 ms; excludes bytes/real route work |
| Successful upload-start route, warm | 44.8 ms | Actual handler, local Auth/SQL and real dummy URL signing; proxy bypassed |
| Server upload-start helper | 24.3 ms | Each mocked DB/R2/sign step deliberately costs 12 ms; structural probe only |
| Server upload-finish helper | 48.8 ms | Each mocked DB/R2/sign step deliberately costs 12 ms; structural probe only |
| Render worker: preview480 + master1080 ready | 1,866.8 ms | Actual worker and ffmpeg; 6 s SDR test pattern; local input/output, idle queue, 50 ms polling |
| Render worker: server export1080 ready | 1,436.4 ms | Actual worker and ffmpeg; 6 s SDR test pattern; local input/output, idle queue, 50 ms polling |
| Worker accepts preview / export request | 4.3 / 1.2 ms | Local worker HTTP only |
| Worker process starts and answers health | 77.8 ms | Local spawn, not Render wake-up |
| Browser Export button feedback | 25.7 ms | Actual ExportButton with API stubs, default export picture settings |
| Saved-run GET dispatch → export sources POST dispatch | 1,883 ms median; 444–1,890 ms range | Transport timestamps from the three browser export runs; excludes click→GET and sources-response delay |
| Export click → local download available | 9,640.8 ms | Actual browser renderer, 1080×1920, 180 frames, two 3 s clips, text drawn by app; stubbed spec/registration/upload |
| Finished MP4 blob → observed download link | 16.7 ms; 8.5–62.9 ms range | Actual local blob download, readiness polling adds up to ~50 ms uncertainty |
| Server export completion → browser discovers done | 0–2,500 ms plus request/render time; typical phase-average ~1,250 ms | From foreground polling cadence, not a measured production distribution |
| Hidden-tab export polling | 30,000 ms cadence | Can delay background discovery; visibility change wakes polling |

Browser export observations were **10,885.1 / 9,640.8 / 9,071.0 ms**, each producing **9,480,620 B**. After blob creation, Download becomes available before cloud reservation/upload completes: this is already the right order. At the profile's 2 Mbps uplink, uploading that payload alone has a theoretical ~37.9-second minimum; it does not block the local download. The fixture's PUT is acknowledged rather than actually transferring those bytes, so saving to My files is not timed end to end.

Export page task samples >50 ms: **3 / 3 / 13**, maxima **151 / 114 / 111 ms**. These page-wide windows include startup, lazy import and rendering; they are not all proven encoder tasks. The cold/warm difference and the 444–1,890 ms sources-start spread make prewarming export dependencies worth testing. Moving browser drawing/encoding to a worker is a responsiveness investigation, not evidence that wall-clock encode time will fall.

Upload finish performs serial **claim RPC → R2 HEAD → conditional COPY → finish RPC**. These checks protect size/type/ownership and immutable publication; they cannot simply be parallelized. Cleanup and preview submission already run through `after()`, off the upload response path. The parallel local metadata probe in `clipFromFile` is already present.

Preview readiness has two separate problems:

- The actual Render worker uses one shared busy loop and drains export jobs before preview jobs. A queued preview waits for existing rendering and can be starved by sustained export arrivals. The idle local 1.87-second number does not include that wait, 4K/HDR decoding, source download or storage PUTs.
- `previews.ts` caches a missing p480/master object for **20,000 ms**; duplicate preview requests are suppressed for **10 minutes**. A worker finishing early does not clear another process's negative cache. Subsequent preview/export checks can therefore observe absence until TTL expiry. An already-open original-video element is not automatically replaced merely because the copy became ready. Shortening the negative TTL alone does not implement that replacement.

Real upload start through the paid proxy, actual full-byte uploads, Render.com wake-up/queue/region latency, and server-render-finished→published-media download are **unmeasured**. Browser end-to-end export, actual local worker rendering and the production-route rejection timing are different experiments.

## Production and real-user data

The public [production landing page](https://mavya.app/) is reachable without credentials. A read-only request to [the Speed Insights collection script](https://mavya.app/_vercel/speed-insights/script.js) returned HTTP 200. The source mounts `<SpeedInsights />`. That establishes installation and reachability, **not access to measured visitor distributions**.

No unauthenticated Speed Insights dashboard/report was available from those public resources. Production p75 INP/LCP/CLS, route-level field data, traffic sample size and deployment-specific trends remain unknown. No authenticated production browsing, API harness traffic, writes, synthetic accounts or test exports were performed. Only the public page, headers and collection script were read.

## Ranked smallest fixes and expected gain

Priority considers user impact and confidence; gains below are estimates or upper bounds unless explicitly measured. Nothing was implemented.

| Rank | Slow thing / evidence | Smallest change to test | Expected gain and confidence |
| --- | --- | --- | --- |
| 1 | Preview waits behind exports; 20 s negative cache; open player can retain original | Give previews bounded priority in the existing single worker; shorten missing-object TTL and explicitly refresh/swap the preview URL once ready | Remove avoidable queue wait and up to ~18 s of subsequent-check staleness with a 2 s TTL. Queue gain depends on load; existing-player refresh requires a separate readiness signal. No extra concurrent encodes on a 512 MiB worker |
| 2 | Browser export 9.64 s for 6 s media; 151 ms task | Prewarm existing export/text dependencies on export readiness or intent; profile then move sustained draw/encode work off the main thread if confirmed | Sources-preparation spread is ~1.45 s; prewarming might recover some of it. Worker can remove confirmed main-thread stalls from interaction latency; encode-time gain unknown. Preserve codec settings, output quality and frame schedule |
| 3 | p480 playback is not drop-free; UI ~30 fps during the steady-play check; 66.8 ms presentation gaps | Profile and narrow per-frame subscriptions in WholeMedia/SegmentVideos/WholeControls; keep static controls out of clock renders | Target 30 presented video frames/s and 60 UI frames/s; observed 2/565 drops could be eliminated, but no numeric improvement established. Verify boundary correctness before adopting |
| 4 | Cold editor document ~2.27 s, navigation regressions ~150–210 ms | Trace destination RSC/chunk/data waterfall; keep shell feedback immediate, ensure useful existing prefetch completes, and reuse already-loaded same-user data where valid | Potentially one network round trip (~250 ms in this profile) on identified waterfalls; do not promise this from these measurements. Regression attribution needs matched-browser trace |
| 5 | Cold-route load/import overhead; export trace 151.46 MiB | Narrow character-file tracing/imports on export; separate ffmpeg-dependent modules from browser-spec paths where safe | ~60.7 MiB character files and possibly 76.1 MiB binary removable from paths that do not need them. Cold-start milliseconds unknown; retain every runtime dependency actually used |
| 6 | Foreground server export polling2.5 s | Return/notify completion earlier, or use a short bounded faster cadence near completion | At most ~2.5 s discovery wait avoided; phase-average~1.25 s, with extra request cost if polling faster. Browser local download already bypasses this |
| 7 | Editor run→reference serial DB reads, repeated Usage subscription query | Join the editor projection into one owned DB read/RPC; share one subscription promise within a request | One serial DB RTT for editor; one query's work for Usage. About 12 ms per RTT in the dummy service, real-region gain unknown. Keep all live authorization checks |
| 8 | Six root font preloads 152,320 B plus ~223–272 KiB gzip initial JS | Disable preload for font faces unused above the fold; defer unused route UI/chunks after bundle inspection | Up to part of 122 ms ideal font payload time at 10 Mbps; actual FCP/LCP gain unknown. Keep intended typefaces and font-swap behavior |
| 9 | Cold My files/card work; Uploaded feedback~67 ms at 100 items | Preserve existing parallel requests; progressively mount more upload tiles only if a larger-window trace demonstrates a problem | No urgent fix shown at 100 items: select-all~30 ms and verified correct. Larger-list improvement unmeasured |

A single “fast everywhere” verdict would require matched Chrome 156 reruns, successful cloud upload/export/media/billing paths with safe test credentials/services, realistic long/heavy timelines and mobile playback, plus field data. The measurements here establish responsive common edits and expose the remaining waits; they do not certify those missing paths.

## Evidence and reproduction

All adaptations and raw observations remain temporary, so cleanup of `/tmp` removes them. The report's tables preserve the key measured numbers. Relevant scripts/results:

- `/tmp/mavya-speed-baseline.cjs` and `mavya-speed-baseline.json`: 17 scenarios ×3; probe rows replaced with corrected `mavya-speed-probes.cjs` results.
- `/tmp/mavya-speed-library.cjs` and `mavya-speed-library.json`: 331-item follow-up comparison; `mavya-speed-library-2000.json`: three additional initial-load stress samples.
- `/tmp/mavya-speed-ui.cjs`, `mavya-speed-ui-final.json`: expanded load run. `/tmp/mavya-speed-ui-verified.cjs` / JSON adds user activation and isolated task collection to the interaction run. Its original generic Volume probe was a no-op and is excluded. The verified run changes Exposure and measures task windows for scrubbing, trimming and typing; the separate supplement verifies a larger Exposure change.
- `/tmp/mavya-speed-supplement.cjs`, `mavya-speed-supplement.json`: exact 100-item selection and actual Exposure change.
- `/tmp/mavya-speed-playback-trusted.cjs`, `mavya-speed-playback-trusted.json`: full playback with user activation; earlier playback JSON without `trusted` is invalid for playback certification.
- `/tmp/mavya-speed-reads.cjs`, `mavya-speed-reads.json`: real route reads and upstream call lists; `mavya-speed-cold.cjs` / JSON: all 41 handler fresh-process probes.
- `/tmp/mavya-speed-bundles.cjs`, `mavya-speed-bundles-final.json`: modern initial JS and per-API traced bytes.
- `/tmp/mavya-speed-export.cjs` / JSON: actual browser export and blob-to-download observations.
- `/tmp/mavya-speed-worker.mjs` / JSON: actual idle local worker with in-memory fixture transport; `mavya-speed-upload*.json`: helper sequencing probes.

Example reruns against the temporary production server only: `node /tmp/mavya-speed-ui.cjs 3452 /tmp/new-ui.json`; `NODE_PATH=/home/farhan/mavya-video/node_modules node /tmp/mavya-speed-cold.cjs /tmp/mavya-speed-20261106 /tmp/new-cold.json`. These require the dedicated muted Chrome CDP session on localhost9232. Never substitute a deployed origin or production credentials.

Validation: fixture production build passed; original scenario rows complete; final expanded UI, verified selection/exposure, full activated playback and browser-export runs have no Runtime exceptions/missing controls. Expected route rejection statuses are retained, not called passes for the corresponding happy paths. `git diff --exit-code` confirms tracked files unchanged. No commit or push.
