# Fixes, fresh verification and speed review, 2026-10-26 part 2

Branch: `codex/fix-2026-10-26-part2`, created from main `a47a04e`. Local commits only. Nothing pushed, merged or deployed. No founder .data or .env changes, no production writes, no paid service requests. All commits use `kamrunnahar00004-creator`.

The work covers the requested defects and speed section. Prices, hook allowances, plans, auth policy, prompts/models, generated-hook processing and the visible design/copy remain unchanged. New visible text is limited to unavailable/bounds/delete errors, Retry and Load more. The remaining policy items and verification limits are explicit below.

## M1. Pricing overflow

**Verdict: fixed. Commit `337e7f7`.**

`src/components/pricing-page.tsx` clips horizontal overflow at the pricing boundary, containing the decorative glow. Card dimensions, comparison-table scrolling and copy are preserved.

Final production-browser measurements: 320 px viewport: clientWidth=305, scrollWidth=305; 375 px viewport: clientWidth=360, scrollWidth=360; 390 px viewport: clientWidth=375, scrollWidth=375. Comparison-table scrollWidth stays 760 px inside its own 263/318/333 px containers. Before the fix, page overflow was 20 px at each width. The browser also confirmed identical rendered pricing text.

Checks: muted Chrome against the isolated production build, 320/375/390 px; TypeScript, lint and production build. Public CLS is recorded in the speed section.

## M2. Shared editor/export/worker limits

**Verdict: fixed structural admission mismatch, with the concurrent-save boundary below. Commits `ec4d905`, `7ec532a`, `a182a43`.**

`render/constraints.json` is the shared source for 720x1280, 30 fps, 40 segments, 200 total clip pieces, 200 keyframes per clip, 20 sounds, 200 text overlays and 180 seconds. The worker imports it directly; application validation imports it through `src/lib/render-limits.ts`. The render deployment directory contains the JSON.

- `src/lib/server/run-validation.ts` and the run PATCH handler reject over-limit edits. Combined clip/piece counts and duration are checked against the current saved run when hook/demo sections change. No clips or keyframes are silently removed.
- The export handler validates the saved snapshot before signing, reserving or dispatching a new export. The client validates before drawing/uploading text PNGs.
- `src/lib/client.ts` preserves the server's bounds message; SaveStatus shows it. Export errors use the existing toast. Text-PNG code loads only when export starts.
- The fixture proves 200 keyframes pass both validators, 201 fail, 41 clips and 201 pieces fail, and invalid export snapshots never reach reservation or dispatch.

**Boundary:** save validation reads the current run before its existing atomic section merge. Simultaneous cross-section edits from different tabs can pass individually and produce an over-limit combined save. Export revalidates the authoritative saved snapshot and refuses it before reservation. Save validation is not claimed to be a new transactional cross-tab constraint. Existing invalid durable export jobs are not rewritten or canceled by this change. Worker file/probe/decoded-pixel/queue guards remain separate resource protections.

Checks: `verify-part2.cjs`, review/export/render/admission/SQL suites, TypeScript, lint and production build.

## M4. Profile outage

**Verdict: fixed. Commits `33f60d0`, `ec4d905`.**

`src/app/api/profile/route.ts` checks read errors and returns 503 instead of successful empty saved data. `src/components/profile-view.tsx` preserves the last successful names/avatar, shows unavailable and Retry, and bounds the read. Initial failure does not enable saving an invented empty profile. A later lint finding in the initial effect was corrected.

Checks: actual handler and component fixtures in `verify-part2.cjs` prove 503 and retained last-good values after a failed reload; settings/auth suites, TypeScript and lint.

## M5. Truthful deletes

**Verdict: fixed. Commit `b590c3b`.**

Cloud deleteRun/deleteReference/deleteAsset in `src/lib/server/store.ts` check Supabase's error field. Reference lookup errors also propagate rather than becoming absent. The DELETE routes return unavailable on failure; genuinely absent items retain idempotent 204. RunsList, ReferenceView and RunView remove/navigate only after confirmed success and show the existing error surface otherwise.

Canonical-media retention is unchanged. Removing a My files listing is still distinct from reclaiming shared/referenced media.

Checks: `verify-part2.cjs` exercises cloud error fields and absence; media-retention, deletion, route gates, TypeScript and lint.

## M6. Pagination, summaries and thumbnails

**Verdict: fixed user-facing truncation. Commits `e5c8604`, `1778483`, `a24732c`, `63e63ab`, `3ff5b9b`.**

`src/lib/server/list-pages.ts` uses bounded 24-row pages ordered by created_at and a unique tie-breaker. Continuation includes both values; owner/curated filters remain on every query. Invalid cursors fail, and read outages return unavailable. Array response compatibility is retained with `X-Next-Cursor`.

RunsList, LibraryView, the studio source picker and My files have Load more. My files pages runs, assets and references independently. The selected studio reference is loaded directly if outside the first page. The script route also resolves the selected reference directly, so a source older than the bounded example sample is not mistaken for absent.

- Studio list requests run summaries, excluding script/project/version history from the response. Covers use one bounded batch, not a full-library download or per-run query.
- Library/studio reference summaries project needed JSON fields in the database; large AI/curation history is not selected.
- Base64 thumbnails are removed from list JSON. `/api/references/thumbnails` serves a private, session-varying image batch. SVG view fragments select individual small tiles from one shared response. One database query handles up to 24 cards, with the same owner-or-curated filter. Only validated PNG/JPEG/WebP data can be embedded; scripts, SVG input and external image attributes are refused.
- Muted Chrome decoded distinct red/green fixture tiles correctly and made one batch request/query for both. The endpoint and store fixtures assert one query for 24 IDs, private caching, ownership, bad input and signed-out rejection.

The pagination fixture traverses every one of 5,011 references, 1,011 runs and 2,011 assets, including identical timestamps, without duplicate or missing IDs. An exact full page can advertise one final empty page; this avoids an additional count query. Internal script-example sampling remains bounded; it is not a user history listing.

Checks: `verify-part2-lists.cjs`, `verify-route-gates.cjs`, local browser fixtures, TypeScript, lint and build. Measured payload and usability results follow.

## Small item. Refund admission concurrency

**Verdict: prepared atomic admission fix; production migration not applied. Commit `64143bf`.**

New `supabase/migrations/0015_atomic_refund_admission.sql` moves the authoritative rolling 24-hour refund count into mavya_reserve_generation under its user advisory lock. Refund transitions acquire that same lock. Replay and active-job recovery precede admission; admin exemption remains. The application shortcut is retained for compatibility, while SQL closes the admission race after this migration is applied.

A network-disabled disposable PostgreSQL test holds the tenth refund uncommitted, sends six competing admissions, then verifies all six wait and return attempts after commit. Existing request replay still works. Migration replay and service-only grants pass.

**Policy boundary:** jobs accepted before the tenth refund may still finish and refund, so the eventual refund count can exceed ten. Strictly limiting all future failed outcomes to ten would require reserving failure slots, reducing concurrency or denying owed refunds. Those would change policy and were not added. This fix prevents new admission past the serialized threshold; it does not revoke accepted work.

Checks: `generation-sql-checks.cjs`, generation/billing/deletion suites. Only disposable test SQL was applied, never the founder's database.

## Small item. Indexes

**Verdict: written only, unapplied. Commit `64143bf`.**

New `supabase/migrations/0016_list_and_recovery_indexes.sql` adds:

- user/refunded_at partial index;
- upload and temporary-object expiry indexes;
- export and account-deletion recovery indexes;
- composite runs/assets/library pagination indexes, including a curated-library partial index.

Existing migrations are unchanged. The index file was not applied, including to the test database. Definitions were checked against the existing schema/query predicates. No production EXPLAIN, index-build timing or measured database speedup is claimed. Review/apply 0015 then 0016 separately before relying on the new admission serialization/indexes.

## Small item. Runway dependency

**Verdict: retained because the removal condition is false.**

Eight existing experimental scripts import `@runwayml/sdk`: runway-veo, runway-frames, runway-test, runway-test2, runway-hybrid, runway-gemini, runway-replace and runway-hybrid2. The first filename is `scripts/runway-veo.mjs`. There is no source runtime import, but removing the package would break these scripts. None was executed. No package or lockfile change was made.

## Speed. Method and raw evidence

The baseline production artifact was checked against main's tracked application source before edits. Both sides use Node 22.23.4 for the app/build. Chrome is headless, muted and uses a separate profile. Windows Node drives CDP. Non-local browser requests are blocked. No authenticated production session or real provider/storage/database backend is used.

Public medians are three cold-cache runs at 375x900, 2x CPU slowdown, observed for 3.5 seconds. Private-page measurements use separate production-artifact copies with their proxy disabled only in those temporary copies and API replies stubbed at 120 ms. They measure client loading, not production authentication or database latency. Actual proxy/security checks run against source separately. Editor rendering and AWS signing use offline fixtures.

Reproduction scripts: `measure-speed.cjs`, `measure-app-speed.cjs`, `measure-editor-speed.cjs`, `measure-server-speed.cjs`; large-list measurements are in `verify-part2-lists.cjs`. Raw rows/setup: `docs/CODEX_FIX_SPEED_2026-10-26_PART2.json`.

## Speed. Landing and Pricing

**Verdict: lighter media/font loading, same content and layout. Commits `166601a`, `34a0bd5`, `5a2c81b`.**

| Page | JS bytes before / after | LCP ms before / after | CLS before / after |
| --- | --- | --- | --- |
| Landing | 236,793 / 235,404 | 408 / 416 | 0 / 0 |
| Pricing | 236,793 / 218,766 | 484 / 416 | 0 / 0 |

Landing image transfer: 199,799 to 146,396 bytes. Initial font transfer on both public pages: 257,132 to 154,120 bytes, 12 to 6 font requests. Landing video requests: 4 to 3; observed video transfer stays almost identical (1,967,265 to 1,966,965 bytes), as expected with the three original hero loops retained.

Landing LCP is effectively flat in this local sample, including an 8 ms regression; Pricing improves by 68 ms. Earlier valid samples varied substantially, so the report does not claim a universal latency gain. Header/footer home links avoid prefetching an off-route hero preload on Pricing.

Below-fold HowItWorks video sources are attached only while that section is live. Existing visibility/reduced-motion behavior remains. The original hero and creators' MP4 bytes are unchanged. Only the central hero poster is explicitly preloaded; below-fold videos remain lazy. Posters/matrix stills use WebP. Across 36 static stills, bytes fall from 742,255 to 548,012; dimensions are preserved except oversized phone posters bounded to 720 px, with full-width strips retained. Originals are retained for compatibility.

Caption fonts move out of the marketing root into the project/editor route. Font display is swap; original UI font weights remain. TikTok Sans 800 is preloaded there, with the same family/weight used by the existing export. On-demand other fonts remain available. Studio run links no longer prefetch every editor's code/fonts.

The public numbers are local lab observations, not production Core Web Vitals or a promised percentage improvement. Speed Insights should be watched for /, /pricing, /studio, /library and project/editor routes, especially mobile p75 LCP/CLS/INP after deployment.

## Speed. Studio, Library and editor

**Verdict: smaller startup data/code; measured timings, including tradeoffs, below. Commits `e5c8604`, `1778483`, `0ec1c1d`, `9079f1c`.**

| Fixture page | Usable ms before / after | Initial JS bytes before / after | Font bytes before / after |
| --- | --- | --- | --- |
| Studio list | 1355.0 / 745.9 | 298,104 / 238,462 | 257,132 / 154,120 |
| Library | 744.8 / 599.0 | 291,704 / 238,462 | 257,132 / 154,120 |
| Project / editor route | 810.5 / 832.5 | 298,104 / 274,301 | 257,132 / 279,248 |

Cold full-editor dialog opening after click: 38.8 to 94.3 ms. Deferring that code trades approximately 56 ms on this first cold open for a smaller startup bundle. Project first usable is approximately 22 ms slower in this sample; Studio and Library improve. Existing generated projects can load editing tools earlier when their inline clip controls are needed. No cold-open speedup is claimed.

The editor font increase is intentional TikTok Sans 800 preloading. Baseline external runtime font requests are blocked by the fixture, so the font-byte row is not a comparison of total eventual font cost on a real connection. Zero browser runtime exceptions were recorded.

Time to usable means the fixture's project title/cards are present, not that video has decoded. Full-editor opening measures dialog controls after clicking Edit video, not real media readiness. Three samples are noisy; no production latency claim is made.

Library no longer statically imports the entire RunView/editor. Editing tools, text-style controls and font picker, song browser, My files and export text drawing load on demand. Style definitions needed to display saved preview text remain available to that preview. The visible controls and behavior remain.

For the large-list fixture, first-screen response sizes are 141,125,001 to 123,907 bytes for library pages and 25,829,001 to 8,329 for studio summaries. Baseline sizes use the old 5,000/1,000 caps; traversal separately proves older items remain reachable. These are synthetic raw JSON sizes, not compressed production measurements or equivalent full-history payloads. Pagination defers older rows deliberately. Median JSON parse observations: library 92.95 to 0.062 ms; studio 12.66 to 0.035 ms.

Actual installed production React was measured with 200 unchanged overlays, 40 filmstrips and 60 parent updates after mount, at 2x CPU. Overlay render bodies: 12,200 to 200; filmstrip bodies: 2,440 to 40. Median update-loop time: 260.9 to 19.9 ms. TextOverlay uses normal memo comparison; Filmstrip additionally compares time values so equal rebuilt arrays do not defeat memoization. Local component state and changed text/timing/callbacks still render.

## Speed. API, signing, media, polling

**Verdict: bounded reads/cache reuse and lower background work. Commits `345b3d5`, `a24732c`, `63e63ab`, `1778483`, `dee1344`.**

| Change | Before | After / verification |
| --- | --- | --- |
| Songs response caching | No response cache header; upstream catalog already cached | Public max-age/s-maxage 300 seconds, stale-while-revalidate 900; failures are not cached |
| Curated-only library caching | No response cache header | Private 60 seconds, Vary Cookie; owned/mixed mutable lists remain no-store |
| Shared sound redirect | Private 1,800 seconds already | Retained, with reused signing underneath |
| Thumbnail database reads | Inline full-object list thumbnails; initial replacement risked per-card reads | One batched image query for up to 24 cards, private 300-second browser cache; no list-handler N+1 |
| 1,000 identical concurrent signed GETs | 1,000 signing operations; median 136.7 ms | One signing operation; median 1.9 ms, actual AWS middleware with HTTP forbidden |
| Foreground export/generation polling | 2.5 / 4 seconds | Unchanged healthy cadence, no higher provider polling rate |
| Hidden-tab polling | Same foreground cadence | 30 seconds, wakes on visibility |
| Sustained error polling | Same foreground cadence | Exponential backoff capped at 30 seconds |
| Export polling effect | Could restart its wait when callback identity changed | Callback ref prevents parent renders from restarting the loop; monotonic reported progress |

Commit `2d9032d` additionally preserves fresh full-lifetime worker/provider signatures; `ce1bf2e` prevents off-route hero preloading and refines the unapplied deletion index.

Signed-read cache entries include bucket/key/lifetime/download disposition, coalesce concurrent work, evict failed signing and stay bounded to 1,000 entries. Only standard one-hour playback/read grants are reused, for up to 29 minutes, retaining a one-minute safety margin beyond the 30-minute browser redirect cache. Custom-duration worker/provider grants receive fresh signatures so durable job specs retain their full requested lifetime. Short grants and PUT upload grants are not reused. Ownership is still checked before issuing each API redirect.

Cloud playback continues to redirect to R2, which handles byte ranges; local playback retains tested Range/206 behavior. `MediaVideo` defaults to metadata and reuses a small frame from already decoded video as a poster without a second fetch or server processing. Explicit existing posters are retained. Until a first decoded/canvas-readable frame exists, the poster is transparent and the normal video frame displays; cross-origin canvas denial does not break playback. This does not invent a first-load generated thumbnail or change hook processing.

Independent catalog/ownership reads remain parallel. Run covers are batched, and thumbnail reads are batched rather than moved into an N+1 loop. No worker plan, model, provider cadence, paid service or generation-quality setting changed. Real provider/worker completion time was intentionally not measured. Faster polling was not purchased with extra backend work.

## Fresh whole-app verification, including B1 to B7H3

**Verdict: no additional confirmed high-severity regression found in the reviewed paths. Local verification is not production certification.**

| Area / prior fix | Fresh evidence and result |
| --- | --- |
| B1 Checkout return, ownership, deletion parity | Checkout-return handler fixtures and PostgreSQL billing ordering/replay/CAS pass; paid/no-payment-required, foreign sessions, deletion reconciliation and newer-event precedence retained |
| B2/B3 Webhook configuration/signature/unowned outcome | Config, billing, checkout and route fixtures pass; diagnostic markers retained; transient failures retry, definitively unowned events acknowledge without attaching/canceling unknown subscriptions |
| B4 Password recovery/auth | Auth-next/auth-flow fixtures pass; token_hash recovery routing, transport recovery, safeNext, unknown email error, one Google door, unpaid/past_due gates and UUID admin rules unchanged |
| B5 Contact | Offline network/contact persistence/rate fixtures pass; sender/reply address and pending-outbox behavior retained; no email sent |
| B7H1 Paid writes | Actual API route inventory covers 35 methods across five personas; paid content writes remain blocked unpaid, reads/deletes retain ownership |
| B7H2 Missing generation source | Provider-safety/generation tests pass; an unavailable selected clip cannot switch into unrelated paid text/image generation |
| B7H3 Media/deletion ownership | Media-retention/upload/deletion suites pass; ownership registration remains before direct PUT, ambiguous writes retain the ledger, account deletion grant grace retained |
| Editor/save/history | Bounds, sound/piece/gap math, coalesced saves, atomic section merge/export append, AI/source CAS and complete pagination fixtures pass |
| Text/music/library | Text preset/font/PNG fixtures pass, no Glass restored, TikTok default preserved; music remains bounded previews; library owner filters and new thumbnail response validation reviewed |
| Export/worker | Export recovery, durable output identity, worker HTTP admission and offline ffmpeg timing/audio/overlay fixtures pass; hosted worker capacity/latency not tested |
| Settings/account/cron | Profile failure now explicit; deletion/billing tombstones, leases, bounded cleanup, secret auth, scheduling and unavailable-config fixtures pass |
| API/security/secret hygiene | Owner filters and session gates retained; service RPC grants/RLS fixtures pass; no service-role import added to client modules; public caching restricted to catalog data, private caches vary by session |

**Additional low finding R1, not fixed:** `src/components/runs-list.tsx`, rename, updates the displayed title optimistically and ignores the PATCH response status. A rejected or unavailable save can therefore leave an unsaved title visible until reload. This follows the source path; it was not exercised against a live account. The smallest follow-up is checking success and restoring the prior title with an error on failure. This is outside the enumerated defect fixes and is not being claimed fixed.

**Remaining observations:** M3 retention disclosure/runtime mismatch, M7 indefinite unusable provider outputs and M8 unlimited/priority claims remain open exactly as requested. Supabase secure-password-change remains a founder dashboard decision. Same-section multi-tab saves remain last-writer-wins; the combined-save bounds race is described under M2. Contact outbox monitoring, unresolved provider/billing/deletion recovery, curation deployment flags, music rights, real worker memory capacity, real geographic latency and Safari/mobile pixel/thumbnail parity remain unverified operating/product concerns. No privacy, pricing, auth-setting or age/refund policy was silently changed.

## Final checks and handoff

```text
Node 22.23.4
21 scripts/*-checks.cjs       PASS
7 scripts/verify-*.cjs        PASS
npx tsc --noEmit             PASS
npx eslint src render        PASS, no lint warnings
npx next build               PASS, 35 pages generated
git diff --check             PASS
```

The build exits successfully but emits Next's missing automatic fallback-metrics warning for TikTok Sans. The real weight-800 font asset is generated/preloaded; swap and the normal CSS fallback remain. This is not reported as a warning-free build. The new static thumbnail route's prerender failure found during verification was fixed with an explicit connection boundary, then the build and all suites were rerun.

The production build uses a separate physical tracked-source copy without actual .env/.data and preserves the founder's running .next. PostgreSQL fixtures use disposable network-disabled containers. Expected Invalid provider task rejection messages are test cases, not ignored failures. Browser sessions are muted; no music played. No real fal, Gemini, Stripe, email, hosted render or R2 request was made.

Review the local branch and both new migrations. Apply 0015 for atomic refund admission and 0016 for indexes only after founder review; neither was applied to a real database. No environment variable, pricing change or worker-plan upgrade is required. Ship the shared constraints JSON with both app and worker. Validate live auth/storage configuration and observe Speed Insights after the normal review/deploy process.
