# Codex: full audit and speed pass (2026-11-01)

Mavya (mavya.app) is a hook + demo short-form video SaaS. Next.js 16 on Vercel Pro (iad1), Supabase us-east-1, media in Cloudflare R2, export worker on Render.com (`render/`), generation through fal (Kling) and Gemini. Marketing started this week, so real strangers are arriving now.

The founder's words: check everything, every bug, every logic error, and most importantly make the app as fast as it can possibly be. It feels laggy and slow at times, unlike the founder's old Etsy version of mavya.app (git history before this product, repo `kamrunnahar00004-creator/mavya-video` and the older `listinglens` project), which felt instant.

Work on a branch. Do not merge to main. Report back with the file named at the end.

## Part 1: speed (the priority)

Measure first, then fix. Every claim needs a before and after number from a real browser against production or a production build, not dev mode.

Measure at least:

- Cold load and repeat load of `/studio` (Your videos) and `/studio/<id>`: time to first paint, time to interactive, JS bytes per route.
- Click to next paint for: opening each of the 6 steps, New video, opening My files, each My files tab, Viral library, Choose your character, Edit video, Play in each player, seeking, dragging a timeline handle, typing in a text box.
- API round trips: every `/api/*` the studio calls on load, with server timing. A plain authenticated call was measured at about 490 ms from Japan to iad1.
- Re-render cost of `src/components/run-view.tsx` (over 2,000 lines, most state in one component, re-renders on every playhead frame?) and `src/components/editor-tools.tsx`. Find what re-renders per animation frame.
- Number of `<video>` elements alive at once, decoded memory, and how many frames the filmstrip decodes on a typical video.

Compare with the old Etsy app and say concretely why that felt faster.

Then find the biggest wins and implement the safe ones. Ideas to prove or reject, not a list to follow blindly:

- Move Vercel functions and Supabase closer to users, or edge caching for reads, since every action crosses to us-east-1.
- Stop saving and refetching whole runs: `GET /api/runs` returns full run JSON, used by My files and by the character browser prefetch. `listRuns`, `/api/assets` and `/api/references` are all loaded when My files opens.
- Store generated thumbnails at upload or generation instead of decoding video in the browser for tiles, My files and filmstrips. Each Still is a video element; each filmstrip frame is a seek.
- Split playhead state out of the page so 60 fps updates re-render only the player and bar. `requestAnimationFrame` calls `setT` in RunPreview, WholePlayer and ClipEditor.
- Code splitting, preloading next steps, optimistic UI everywhere a click currently waits on the network, prefetching routes, `content-visibility` for long lists, virtualising the library.
- Cached signed links, redirects and CORS (see the known trap below).
- Upload path: 3 at a time direct to R2. Multipart for large phone clips? Client-side transcode is a quality trade, flag it, do not do it.

The result must feel instant wherever the work is not truly remote. Where it is remote (generation, export, upload), the UI must respond within one frame.

## Part 2: every bug and logic error

Read all of `src/`, `render/`, `supabase/migrations/`, `scripts/`. Report with file, line, failing scenario. Fix what is clear. Focus on:

- Races between client saves and server writes. The browser sends the whole `hook` section; `src/app/api/runs/[id]/route.ts` now protects a generated clip from a stale save, but `demo`, `texts` and `sounds` are still last-write-wins. `runRef` is updated by an effect and by hand in `placeClip` and `insertClips`.
- Generation: `src/lib/server/generation-jobs.ts` reuse path (`cache|<job>` tasks), quota, refunds, recovery cron, lease expiry on a reused job, `FAILED_ATTEMPTS_PER_DAY`, account closing during copy.
- Payments and allowances: Stripe webhooks, plan limits in `src/lib/plans.ts`, whether a free user can reach any paid action, and the pricing page claims (M8: "Unlimited scripts" against a 60/day cap, "Priority generation" not built).
- Auth and media access: `mediaAccess`, `?link=1` on `/api/media/[id]`, `/api/file-prefs` read-modify-write races (one JSON per user in R2, two tabs can lose an edit), any way to read another user's data, RLS.
- `lastProduct` in `src/lib/server/store.ts`: the JSON-path `order` and the carried `product.at`.
- Timeline maths: `src/lib/edit.ts`, `retimeTexts`, `remapTexts`, `snapTexts`, millisecond rounding left anywhere (`round1`), gaps, speed changes, Cut then trim then undo.
- Export parity: does the worker produce what the preview shows? Text position, fonts, speed, keyframes, joins with no gap, audio mix. Run real exports.
- Upload: cancel (`stopUploads`), failures part way through a batch, order, `pending` tiles, blob URL leaks.
- Unmount and leak checks: every `addEventListener`, `requestAnimationFrame`, `setTimeout`, object URL and video element.
- Mobile and Safari: the app has never been tested there.
- Any AI call that does not come from an explicit click, which is a founder rule.

## Rules

- Prices are fixed at $29 / $59 / $99. Do not change auth rules.
- No AI on page load, tab switch or open. Only explicit clicks.
- At most one real fal generation in total. Do not spend money otherwise. Reuse works on an existing hook + built-in character for free.
- Secrets stay in `.env.local`. Never commit `.env*` or `.data`.
- Never change the founder's local `.data`. Use a copy.
- Migrations: the founder applies them by hand, so avoid them unless the gain is large, and say so clearly.
- Commits as `kamrunnahar00004-creator`.
- UI copy: no em dashes, no helper or filler text. Keep the look. No post-processing of generated hooks with ffmpeg. No text animation. No Glass text styles.
- Run every `scripts/*-checks.cjs` and `scripts/verify-*.cjs`, `tsc`, `eslint`, and `next build` before each commit. All 30 suites pass today.

## Known trap: read this first

Storage sends no `Vary: Origin`, and `signedGet` in `src/lib/server/r2.ts` caches links. A crossOrigin video on the same URL as a normal player reuses the browser's non-CORS copy and fails with "Format error". Anything reading pixels must use `pixelLink` (`src/lib/filmstrip.ts`), which gets a separately signed link from `/api/media/<id>?link=1`. This broke timeline filmstrips and uploaded-hook analysis until f8d0103. `MediaVideo` poster capture still reads pixels from the normal link and always fails quietly; decide what it should do.

Testing live needs a signed-in session. A temporary user with a media row added server-side works; free users cannot upload. Delete the user and object afterwards.

## Open, not bugs

- Contrast and Temp are measured from CapCut (`src/lib/adjust.ts`, repeated in `render/render.mjs`, change both). Negative contrast and in-between Temp are not measured. Brightness is not yet calibrated to CapCut's Exposure.
- 97 published library hooks have no recipe.

## Report back

Write `docs/CODEX_AUDIT_REPORT_2026-11-01.md`:

1. Speed table: each action, before, after, how measured.
2. What made the old Etsy app feel faster.
3. Bugs fixed, with file, line and scenario.
4. Bugs found but not fixed, ranked by what a paying customer would hit first.
5. Speed work left, ranked by gain against risk, including anything needing money or infrastructure (region moves, Vercel, Supabase, R2) or a migration.
6. Anything you were unsure about.

Be blunt. If something is unfinished or unverified, say so.
