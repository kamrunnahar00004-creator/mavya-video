# Codex verification request: everything merged on 2026-10-24

mavya.app is **live and public on Vercel Pro**, running `main` at `ed6bf0f` (or later). The render worker on Render
runs the same commit (protocol 2). Supabase has migrations **0001-0014 applied**. Your parts 1-3 were merged after
Claude's review, together with Claude's changes listed below. This is a **verification pass on production code**:
find bugs, broken logic, money or data risks and regressions introduced by the merge, and anything your earlier
fixes missed. Be as brutal as in the first review.

## Rules

- Work on a new branch `codex/verify-2026-10-24` from `main`. **Do not push or merge**: every push to main deploys
  the live site. Claude reviews, then merges.
- Commit identity stays `kamrunnahar00004-creator`. One commit per finding (or coupled group), message starting with
  its id (V1, V2, ...). New migrations as `0015_*.sql` and up; never edit 0001-0014.
- **No paid calls**: no fal.ai (Kling), Gemini, live Stripe, Resend. Stub them. No production database writes.
- Keep all 21 `scripts/*-checks.cjs` suites, `npx tsc --noEmit -p .`, `npx eslint src render` and
  `npx next build` passing (Node 22). Add focused checks for what you fix.
- Do not change prices, plan limits, Kling models or prompts (`src/lib/server/hookgen.ts` constants and prompt text),
  or UI styling. Copy: short, no em dashes, no helper/filler lines.
- Hosting: Vercel **Pro** now. Function budgets stay at 300 s; the recovery cron is every minute (`vercel.json`).

## What to verify (in priority order)

### A. Hook generation on Kling (Claude, `1b5d5e1` + your safety layers)
`src/lib/server/hookgen.ts`, `src/lib/server/generation-jobs.ts`, `src/app/api/runs/[id]/generate/route.ts`,
`src/app/api/internal/generations/route.ts`, migrations 0003/0005/0012.
- Flow: Gemini picks the outfit (`outfitFor`), Gemini 3.1 Flash Image swaps the character into the hook's first
  frame (`swapFirstFrame`), the frame and the original clip (no audio, held to >= 3 s by `motionReference`) are
  staged in R2 `tmp/gen/` with signed links, then `fal-ai/kling-video/v3/standard/motion-control` (fallback
  `v2.6/standard/motion-control`; described hooks use v3 image-to-video or text-to-video).
- Check: fal queue status/result mapping (`checkHook`), every path that could charge twice, refund wrongly, or lose a
  paid result; `HookStartUncertain` cases; task id format `"<model>|<request id>"` against 0005's validator; the
  app path `model.split("/").slice(0, 2)` for fal queue URLs (is it right for every model used?); `mp4Seconds`
  on fal's real MP4 layout (moov at the end?) and the fallback when it returns null; `seconds` stored on the hook
  vs timeline/text retiming (`generation-edit.ts`); described-hook length; short library clips (< 3 s) padded with
  a frozen last frame (does Kling then output a frozen tail the user sees?); temporary object ownership and
  expiry; GEMINI_API_KEY missing or Gemini image refusals (does it fall back or fail cleanly, and is the hook
  refunded?); budgets under 300 s per invocation including the Gemini image call (up to 180 s) plus staging.
- The recovery cron now runs every minute: throughput, double-advance of the same job from cron + user poll,
  and leases.

### B. Export (your durable export jobs + Claude's two changes)
`src/app/api/runs/[id]/export/route.ts`, `src/lib/server/export-jobs.ts` (or wherever dispatch lives),
`src/components/export-button.tsx`, `src/lib/text-png.ts`, `render/render.mjs`, `render/server.mjs`,
`render/limits.mjs`, migration 0009.
- Claude `7667152`: text images are now inputs with `-loop 1 -framerate <fps> -t <total>` and the overlay uses
  `shortest=1` (a text starting where the demo begins was dropped in a real test: the piece ran at 30.30 fps).
  Verify this is correct for every case (text at 0, at a piece boundary, ending at total, many texts), that the
  decode/memory budget in `server.mjs` (`countOverlayPixels`) still holds with looped inputs, and that output length
  and audio are unchanged.
- Claude `624518e`: export is now **720x1280** (`W/H` in the export route, `text-png.ts` W/H, `render/limits.mjs`
  validation). Verify every place that still assumes 1080x1920 (render math, zoom/pan/keyframes, overlay bounds,
  validation of x/y, text size scaling, any checks or fixtures), and that preview vs export text size and position
  still match (text size is a percent of frame height).
- Old browser tabs, an older worker, idempotent dispatch, recovery after worker restart, temp PNG cleanup.

### C. Sign-in goes to Plans (Claude `624518e`)
`src/app/auth/continue/route.ts`, `src/components/auth-modal.tsx`, `src/app/auth/callback/route.ts`,
`src/lib/auth-next.ts`.
- After password sign-in, sign-up with an immediate session, Google, or the email confirmation link, a user without a
  plan lands on `/settings/plans`; admins and paying users continue to `next`. Check: open-redirect safety of the
  new route (`safeNext` with origin), signed-out access, `past_due` users, allowance errors (it currently continues
  to `next`), maintenance mode, the email-confirmation link path (does it pass through `/auth/continue`?), and the
  proxy matcher (`/auth/:path*` passes through without session refresh: is the session readable there?).

### D. Default font TikTok Sans (Claude `624518e`)
`src/lib/studio-data.ts` (`DEFAULT_FONT`, `FONT_CHOICES`, `GOOGLE_FONTS`), `run-view.tsx`, `client.ts`,
`generation-edit.ts`, `text-png.ts` font embedding.
- New texts use "TikTok Sans" (Google Fonts family). Verify it loads in the preview (`loadFonts`), embeds in export
  (`text-png.ts` subset + weight 800: does TikTok Sans serve 800? what happens if the weight is missing?), and that
  older runs keep their saved font.

### E. Your parts 1-3 after the merge
Re-check every finding you marked fixed (C1, H1-H12, M1-M9, L1-L3) **against the merged code**, not the branch
snapshot, especially where Claude's commits touched the same files (export route, text-png, render, auth modal,
generation jobs). Confirm the production migrations 0001-0014 match what the code calls (function names, argument
lists, grants).

### F. Production readiness
- Vercel Pro: function budgets, cron auth with `CRON_SECRET` (the founder is re-entering it; a missing/short secret
  returns 401), Node 22 runtime, ffmpeg tracing for `/api/runs/*/generate`, `/api/sounds/*`,
  `/api/internal/generations` (and any other route that now runs ffmpeg).
- `RUNWAYML_API_SECRET` is being removed: confirm nothing still imports `@runwayml/sdk` at runtime.
- Stripe restricted key: list every API call and the permission it needs (the founder is adding Subscription
  Schedules write); flag anything else missing.
- Any route that can spend money (fal, Gemini) without a reservation, plan or rate limit.
- Anything that silently falls back to local `.data` behaviour in production.

### G. Improvements (separate section, do not implement unless trivial and safe)
Logic or UX improvements you would make, with expected impact, risk and effort, e.g. generation speed (Kling takes
~3.5 min plus setup), export speed, cost per hook (~$0.59 on Kling Standard), support tooling for `uncertain` jobs.

## Report

Write `docs/CODEX_VERIFY_REPORT_2026-10-24.md`:
1. Findings ranked Critical / High / Medium / Low, each with file:line, what breaks, a concrete reproduction, the
   smallest fix, and the commit if you fixed it.
2. A verified-OK list per area above, with what you actually ran.
3. Improvements (section G) as proposals.
4. New migrations, env vars or dashboard settings needed.
5. What you could not verify and why.
Commit the report on the branch and stop for Claude's review.
