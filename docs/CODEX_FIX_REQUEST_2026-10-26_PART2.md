# Codex fix request, 2026-10-26 part 2

From Claude, for Codex. Your verify branch (`fba0567`..`bf39b35`) was reviewed, re-run
(tsc, eslint, all 26 check scripts, production build: all pass) and merged to main at `bf39b35`.
Thank you. Start a new branch from main for this round.

Two jobs:
1. **Verify again.** A fresh pass over the whole app, looking for anything your first pass missed,
   including regressions from your own fixes (B1 to B7H3). Same scope as B7 in
   `docs/CODEX_VERIFY_REQUEST_2026-10-26.md`.
2. **Fix the remaining defects** from your report that do not need a founder decision (below).

Write results to `docs/CODEX_FIX_REPORT_2026-10-26_PART2.md`: one section per item, with verdict,
evidence, fix commit and the checks you ran.

## Fix these

- **M1 Pricing horizontal overflow** (`src/components/pricing-page.tsx:353`). Contain the decorative
  glow so `scrollWidth === clientWidth` at 320, 375 and 390 px. Card layout and copy unchanged.
- **M2 Editor vs worker bounds** (`src/lib/server/run-validation.ts`, `render/limits.mjs`). One shared
  source of limits. Check them at export admission, before reserving or rendering, and return a clear
  error the editor shows to the user. Never silently drop clips or keyframes. Decide whether the editor
  should also stop accepting more than the worker can render; prefer blocking at save over failing at
  export.
- **M4 Profile read outage shows an empty profile** (`src/app/api/profile/route.ts`). Return an
  unavailable error and keep the last good UI state; never present a failed read as saved empty data.
- **M5 Deletes that report success on error** (`src/lib/server/store.ts` and the cloud
  deleteReference/deleteAsset paths). Check the Supabase error field before acknowledging. Keep
  idempotent 204 for genuinely absent items.
- **M6 Lists truncated without paging** (library, runs, assets in `src/lib/server/store.ts`). Add
  cursor pagination or lightweight summaries so nothing owned silently disappears from a list. Keep
  response sizes bounded. Update the UI only as much as needed to load more.
- **Small items from your report, fix if cheap and safe:**
  - Indexes for the refund-count query (`refunded_at`) and the expiry/recovery queues you named.
    Write them as a new migration file only. Do not apply it; list it in the report so the founder
    can apply it.
  - Remove the unused `@runwayml/sdk` dependency if nothing imports it.
  - Make the 10-refunds-per-day cap hold under concurrency, if that is possible without changing the
    policy itself.

## Make the app as fast as possible (founder request)

Measure first, then fix, then measure again. Report before/after numbers for each change.
- **Landing and Pricing:** first load JS, LCP, CLS. Lazy-load below-the-fold videos, right-size and
  modern-format posters/images, preload only the hero media, avoid layout shift. Keep the other
  creators' videos and the hero as they are, only load them smarter.
- **Studio, editor and library:** time to usable. Stop fetching the full library and full run when a
  summary is enough (ties into M6). Split heavy client code by route (editor, text styles, fonts,
  music) with dynamic imports. Avoid re-render storms in the editor timeline; memoize hot components.
  Thumbnails as small images, not base64 in JSON.
- **API:** add `Cache-Control` where data is public or slow-changing (songs catalog, curated library,
  sounds). Parallelize independent server queries. No N+1 queries. Indexes as in the item above.
- **Media:** R2 signed URLs reused within their lifetime, range requests for video, posters for
  every video element, `preload="metadata"` unless the video is visible.
- **Export and generation:** cut waiting the user sees (polling interval and backoff, progress
  updates) without raising server or provider cost. The render worker stays on its current plan.
- **Fonts:** only the weights in use; `font-display: swap`; preload TikTok Sans 800 only where
  the editor needs it.
- Do not remove features, change the look, change copy or add paid services to gain speed. Vercel
  Speed Insights is already installed; mention which pages to watch there.

## Do not change (founder decisions pending; report only)

- **M3** privacy retention wording vs runtime retention.
- **M7** age policy for unusable provider results.
- **M8** pricing claims (Unlimited scripts vs the 60/day cap; Priority generation). Do not edit
  pricing copy, limits or plans.
- Supabase "secure password change" setting: dashboard-only, founder's call.

## Rules (unchanged)

- Prices fixed: $29 / $59 / $99, 20 / 60 / 150 hooks.
- Auth: no email confirmation ever; Google is one door; email login with an unknown address shows an
  error; unpaid accounts only see /pricing (Settings open); past_due goes to Billing; admins by
  `ADMIN_USER_IDS`, never by email.
- Hook generation stays Kling via fal. No real fal, Gemini, Stripe, email, render or R2 calls. Stubs
  and fixtures only. Nothing that spends money.
- No ffmpeg post-processing of generated hooks. No Glass text styles. TikTok Sans default.
- UI copy: no em dashes, no filler or helper lines.
- Never commit `.env*` or `.data`. Commit as `kamrunnahar00004-creator`. Do not push or merge; Claude
  reviews and merges.
- Run tsc, eslint, every `scripts/*-checks.cjs` and `scripts/verify-*.cjs`, and a production build
  before reporting.
