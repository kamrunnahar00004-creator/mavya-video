# Codex review request: Mavya launch readiness (2026-10-23)

You are reviewing the Mavya repo (`/home/farhan/mavya-video`, Next.js 16 App Router, React 19, Tailwind v4,
Supabase, Cloudflare R2, Stripe, Runway, Gemini, a Render.com ffmpeg server). mavya.app is now **live and public**
(maintenance mode was turned off today). Real people can sign up and pay real money.

Be brutal. Find bugs, broken logic, security holes, money leaks and anything that will break for a real customer.
Do not restyle UI or rewrite working code for taste. Do not run anything that spends money or calls Runway
(video generation costs credits): read the code for `src/lib/server/runway.ts` and the generate route instead.

## What the product does

A "hook + demo" short-form video maker for app and SaaS founders:

1. Your product: paste a URL, Gemini reads the site and writes a brief, then a shot-by-shot script modelled on
   proven hooks (`src/app/api/runs/[id]/product`, `.../script`, `src/lib/server/gemini.ts`).
2. Pick a hook from a curated library of 331 viral hooks (cut into hook + demo clips, stored in R2 under `library/`).
3. Pick a character (built-in photos in `public/characters`, an uploaded photo, or a description).
4. Generate the hook (Runway): Gemini plans motion/camera/outfit from the original clip, gemini_image3.1_flash swaps
   the person into the first frame, Veo 3.1 Fast animates 6 s; if refused, an automatic fallback (Veo from the
   character photo). Plan limits count each Generate; the fallback is not counted again; a total failure refunds it.
5. Add the demo (user uploads clips, shot list from the script).
6. Add sound, edit in a CapCut-style editor (trims, cuts, speed, look, zoom keyframes, texts in 50 styles).
7. Export: the browser draws each text as a PNG with the preview's CSS, `POST /api/runs/[id]/export` builds a render
   spec with signed R2 links, the Render server (`render/server.mjs`, `render/render.mjs`) renders each piece, joins
   them, overlays texts, mixes sound and uploads the MP4 to a signed R2 PUT link; `GET ?job=` records it.

Plans (`src/lib/plans.ts`): Starter $29 (20 AI hooks/month), Pro $59 (60), Studio $99 (150). Edits and exports are
unlimited. No plan = 0 AI hooks. `ADMIN_EMAILS` = unlimited (founder).

## Areas to verify, in priority order

### 1. Money and limits (highest priority)
- `src/lib/server/usage.ts`, `src/app/api/runs/[id]/generate/route.ts`: can a user get more AI hooks than their plan
  (parallel POSTs racing the count, the fallback path, refunds that can be triggered for a generation that
  succeeded, a `gen=` id from another user, re-polling a finished task)? Can a user with no plan generate at all?
- Can someone trigger Runway or Gemini spend without a plan (product/script routes are AI calls: are they limited or
  rate limited? should they be?).
- Stripe: `src/lib/server/stripe.ts`, `src/app/api/stripe/webhook/route.ts`, `src/app/api/billing/route.ts`.
  Signature check, event dedupe (`billing_events`), ordering (`last_event_created`), user lookup (metadata user_id,
  client_reference_id, stored customer id). Can a user end up with a plan they did not pay for, or pay and not get
  it? Cancel / resume / change plan (proration) / past_due / deleted subscription / `cancel_at` from the portal.
  Is `subscriptionOf` (active/trialing only) consistent with `/api/billing` `live()` (includes past_due)?
  The route writes the row right after a change using the stored `last_event_created`: can that overwrite a newer
  webhook state or block a later webhook?
- Stripe key is a restricted key (`rk_live_`, write on Checkout Sessions, Customers, Subscriptions, Customer portal,
  billing documents; read on Products, Payment Methods). Does any call need a permission it lacks?

### 2. Security and data isolation
- Every route under `src/app/api`: does it check `currentUser()` and only touch that user's rows/files?
  `src/lib/server/store.ts` (`cloud()` mode: Supabase service role + R2), `mediaAccess`, `src/app/api/media/[id]`,
  `src/app/api/uploads` (signed PUT then finish: can a user register someone else's object, a huge file, a wrong
  mime, or an id they did not get from `start`?), `src/app/api/assets`, `src/app/api/references` (curated edits only
  with `CURATOR=1`), `src/app/api/account` (delete account: does it remove their R2 files?), `src/app/api/profile`.
- `src/proxy.ts` and `src/lib/supabase/session.ts`: public API list (`/api/contact`, `/api/stripe/webhook`),
  maintenance mode, redirects, `safeNext` in `src/app/auth/callback/route.ts` (open redirect?).
- Export: `src/app/api/runs/[id]/export/route.ts`. Can a user make the render server download arbitrary URLs (SSRF
  via `inputLink`), read another user's media, or register another user's media through a forged/polled job? Is the
  job/meta check sound? PNG validation and size caps. `render/server.mjs`: auth (`RENDER_SECRET`, timing safe),
  input size caps, temp cleanup, behaviour on restart (jobs are in memory).
- Signed URL lifetimes (`LINK_SECONDS` 6 h, media links 1 h) and the `?download=` content-disposition header
  (header injection via the file name?).
- Secrets never reach the client (check every `NEXT_PUBLIC_` use and client components).
- RLS: all tables have RLS on with no policies; only the service role writes. Confirm no client code queries
  Supabase tables directly.

### 3. Correctness of the core flow
- Generate polling and fallback in `src/components/run-view.tsx` (`GenerateStep`) and the route: stuck states,
  double clicks, page reloads mid-generation (is the task lost? is the hook charged with nothing saved?).
- Run saving (`src/lib/client.ts` `patchRun`, `flushRun`, `sentPatches`, `updateRun` locking in `store.ts`): lost
  edits, races between the editor's saves and server writes (`exports` written by the export route, `product` and
  `script` written by the AI routes, generated hooks).
- Editor timing (`src/lib/edit.ts`, `src/lib/sound.ts`) vs export (`render/render.mjs`): does the exported video
  match the preview for cuts, gaps, speed, keyframes (file-time based), sound pieces (`pieceEnd`, looping in
  `soundAt`), clip volume? Check `plan()` / `stepArgs()` / `finalArgs()` against `timeline()` and `pieceSpans()`.
- `src/lib/text-png.ts`: text drawn via SVG foreignObject; fonts embedded from Google Fonts `text=` subsets;
  built-in fonts mapped to Google names; Safari likely taints the canvas (we show "Export in Chrome, Edge or
  Firefox"). Any style in `src/lib/text-styles.ts` that will not render this way?
- Auth modal (`src/components/auth-modal.tsx`): just fixed a bug where sign-up bounced back to the popup in
  production (prefetched redirect); now a full page load. Email confirmation on/off both handled?
- Settings (`src/components/settings-shell.tsx`, `billing-view.tsx`, `plans-view.tsx`, `usage-view.tsx`,
  `account-chip.tsx`): correct states for no plan, active, cancelling, past_due, after Checkout (`?paid=1` polling).

### 4. Production / ops
- Vercel: `next.config.ts` ships the ffmpeg binary only with `/api/runs/*/generate` and `/api/sounds/*`. Any other
  server code that spawns ffmpeg or reads `.data/` (gitignored, absent on Vercel) in cloud mode?
- Function timeouts (Vercel), long Gemini calls, the export POST waking a sleeping Render instance (55 s timeout).
- The contact form writes to `.data/inquiries.jsonl` unless Resend is configured: on Vercel that path is read-only.
- Render server: 512 MB; measured peak ~190 MB per ffmpeg step. Anything that can still blow memory (very long
  videos, many texts, huge uploads, node buffering)?
- Anything still in local-only mode (`!cloud()`) that production could hit.

### 5. Business/plan logic sanity
- Studio is 150 AI hooks for $99 while one 6 s Veo 3.1 Fast hook costs about $0.70 of Runway credit: flag the
  margin risk with numbers and options (do not change prices; prices are fixed by the founder).
- Is there any path where a paying user is blocked (no plan shown after paying, limits not resetting monthly, yearly
  plans counting per month correctly via `allowance()`)?

## Rules
- Do not change prices or plan limits, do not add features, do not touch UI styling.
- No ffmpeg post-processing of generated hooks (founder decision). Do not call Runway.
- No em dashes in any user-facing copy.
- Commit identity must be `kamrunnahar00004-creator` (Vercel blocks other authors); every push to main deploys
  mavya.app, which is live: do not push. Commit fixes locally on a branch or leave them unstaged.

## Output
A report at `docs/CODEX_REVIEW_2026-10-23.md`:
1. Findings ranked by severity (Critical / High / Medium / Low). For each: file:line, what breaks, a concrete
   reproduction (inputs or request sequence), and the smallest fix.
2. A short "verified OK" list of the areas above you checked and found sound, so we know what was covered.
3. Anything you could not verify and why.
If you fix things, keep each fix minimal, one commit per finding, and list the commits in the report.
