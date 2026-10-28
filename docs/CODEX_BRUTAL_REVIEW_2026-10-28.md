# Codex brutal review + fix request, 2026-10-28

From Claude, for Codex. Be harsh. The founder says the app feels broken: **clicking does nothing
visible for a while, the old screen stays, then the new screen pops in.** That is worse than being
slow, because it feels like the click did not work. Find every cause, fix it, and prove it with
measurements. Start a new branch from main (`2ced350`). Do not push or merge; Claude reviews and
merges.

Write results to `docs/CODEX_BRUTAL_REVIEW_REPORT_2026-10-28.md`: every finding with severity, file:line,
a concrete scenario, the fix commit, and before/after numbers.

## 1. The click-feedback problem (top priority, blocker)

Rule: **every click must change the screen within 100 ms.** Show the destination's skeleton, a
pressed/pending state, or an optimistic result at once. Never leave the old screen frozen while the
server answers.

Known facts to start from:
- There is **no `loading.tsx`** anywhere under `src/app/(app)`. Next.js client navigation therefore
  keeps the old page on screen until the new route's server response arrives.
- Every app navigation goes through the proxy (`src/lib/supabase/session.ts`), which calls the
  `mavya_allowance` RPC (paid check) before the page can start. That wait has no visible feedback.
- Some `Link`s use `prefetch={false}` (3 in `src/components`), added in part 2 to avoid prefetching
  every editor. Those navigations now pay the full round trip on click.
- "New video" (`src/components/runs-list.tsx` `newRun`) POSTs `/api/runs`, then `router.push`es.
  Only the button shows a spinner.
- The founder is in Japan; the servers are in us-east-1 (Vercel `iad1`, Supabase `us-east-1`), about
  0.25 s per round trip. US customers are the target, but the app must feel responsive from anywhere.

Fix all of it, at minimum:
- Route-level `loading.tsx` (or Suspense boundaries) with skeletons matching each destination's
  layout for: `/studio`, `/studio/[id]`, `/studio/[id]/edit`, `/library`, `/library/[id]`,
  `/settings/*`. No layout jump when real content replaces the skeleton.
- Immediate pending state on every button that navigates or saves. Use `useTransition`/`useLinkStatus`
  or equivalent so the user sees the click land.
- Decide prefetch per link deliberately: prefetch the cheap route shell (and loading state) on
  hover/viewport, not the heavy editor bundle. Restore instant transitions without the part 2
  over-prefetch problem.
- "New video": navigate instantly to the new video's skeleton; do the create in parallel or
  optimistically. No duplicate runs on double click, no orphan runs on failure, and the paid gate
  must still hold (unpaid gets Pricing, as now).
- Consider caching the proxy's paid check per session for a short time (signed, httpOnly, short TTL,
  invalidated by billing changes) so page changes stop waiting on the RPC. Only if it can be made
  safe: a cancelled or past_due user must lose access within that TTL, and webhooks/checkout return
  must not be bypassed. If you do not do it, explain why with numbers.
- Measure: time from click to first visual change, and to usable content, for every main
  navigation, before and after. Use a throttled profile that simulates about 250 ms RTT.

## 2. Brutal review of Claude's changes today (logic, security, regressions)

Review each line. Fix what is wrong, and say plainly if a change should be reverted.

- **`c826afd`, library covers.** `src/lib/server/covers.ts`, `scripts/backfill-covers.mjs`, the
  `coverUrl` path in `src/lib/server/list-pages.ts`, `Thumb` in `src/components/source-picker.tsx`.
  The 331 existing rows were backfilled with `data.smallCover = true` (production write done).
  Check: signed-link exposure (R2 `covers/` keys signed for any listed reference), the
  read-modify-write of `library.data` racing curator edits, sharp on Vercel functions, `after()` fill
  bounds and failure handling, the onError fallback, user-owned references, and account deletion
  (do `covers/<id>.webp` objects get deleted with the account's media? They are not in the media
  ledger).
- **`364dd97`, auth.** `getClaimsUser()` in `src/lib/supabase/server.ts`, now used by `currentUser()`
  (`src/lib/server/who.ts`) and `adminUser()` (`src/lib/server/usage.ts`) instead of `getUser()`.
  Tokens are ES256 and verified locally via JWKS. Check: revocation and sign-out-everywhere windows,
  deleted users with live tokens, admin detection, every route that calls `currentUser`, cookie
  refresh in route handlers, and whether any write path should keep the Auth server check.
- **`60c8b44`, whole library at once.** `all=1` in `listPage` (2000 cap) and in the clients. Check
  the paging fixtures still hold, response size and cost, and that `scope`, ownership and the cursor
  beyond 2000 behave.
- **`2ced350`, client library cache and slim list.** `src/lib/library-cache.ts` (module cache, 60 s),
  prefetch from `runs-list.tsx`, `run-view.tsx` fetching the picked hook's full recipe when the list
  item is `partial`, and the slim `recipe` in `src/app/api/references/route.ts` for `all=1`.
  Check: stale cache after the user uploads their own reference, the cache leaking across accounts
  in one tab (sign out then sign in as someone else), every place that reads `recipe`
  (`src/lib/edit.ts` `shotList`, pick text, generation) getting the full recipe in time, and the
  race between the partial item and the full fetch.

## 3. Whole-app perceived speed

Go beyond navigation: anything that makes the app feel slow or unresponsive. Examples: the editor
opening, export start and progress, generation status, uploads, the library hover video, Settings
and Billing, the landing page to signup to Pricing flow. Find and fix with numbers. Keep Speed
Insights in mind (INP especially).

## Rules (unchanged)

- Prices fixed: $29 / $59 / $99, 20 / 60 / 150 hooks. Never change.
- Auth: no email confirmation ever; Google is one door; email login with an unknown address shows an
  error; unpaid accounts only see /pricing (Settings open); past_due goes to Billing; admins by
  `ADMIN_USER_IDS`, never by email.
- Hook generation stays Kling via fal. No real fal, Gemini, Stripe, email, render or R2 writes in
  tests. Stubs and fixtures only. Nothing that spends money.
- No ffmpeg post-processing of generated hooks. No Glass text styles. TikTok Sans default.
- UI copy: no em dashes, no filler or helper lines. Do not change the look beyond loading states.
- Never commit `.env*` or `.data`. Commit as `kamrunnahar00004-creator`.
- Run tsc, eslint, every `scripts/*-checks.cjs` and `scripts/verify-*.cjs`, and a production build
  before reporting.
