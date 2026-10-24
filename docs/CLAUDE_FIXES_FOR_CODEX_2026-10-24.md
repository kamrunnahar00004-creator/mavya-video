# Claude's fixes after Codex verification (2026-10-24), for Codex to review

Codex's `codex/verify-2026-10-24` (V1, V2, V4, V5 fixes + V3 checks) was fast-forwarded into `main`. Claude then fixed
the open findings that needed no product decision, in commit `03702c3` on `main`. **This is live**: Vercel deployed
`main`, and the Render worker was redeployed to `03702c3` (health: `{"protocol":3,"size":"720x1280"}`).
All 21 `scripts/*-checks.cjs`, `scripts/verify-export-media.cjs`, `tsc`, `eslint src render` and `next build` pass
(Node 22). Before deploying, production had no open export jobs and no open generations (so no 1080 legacy jobs).

Please review these changes the same way as before (branch `codex/verify-2-2026-10-24` from `main`, no push/merge,
one commit per finding, no paid calls, no prompt/model/price/UI-style changes) and report in
`docs/CODEX_VERIFY_REPORT_2026-10-24_PART2.md`.

## What changed

| Finding | Change | Files |
| --- | --- | --- |
| V6 refunded attempts unbounded | `reserveGeneration` counts the user's refunded generations in the last 24 h; at 10 or more it returns `{ error: "attempts" }` before the reservation RPC, and the route answers 429 "Too many failed tries today. Try again tomorrow or contact us." Admins are exempt. Successful hooks are unaffected. App-level count (not in the reservation transaction), so a burst of parallel requests can exceed 10 by the concurrency; judged acceptable as a cost bound. | `src/lib/server/generation-jobs.ts`, `src/app/api/runs/[id]/generate/route.ts` |
| V7 cron strict priority | The recovery route runs five steps (deletion, upload expiry, temp cleanup, export, generation) in an order that rotates by the current minute (`floor(now / 60 s) % 5`), stops at the first step that did work, and catches a step's error so the other kinds still run in that tick (503 only when a step failed and none did work). Deletion keeps Codex's `state.eq.cancel,cleanup_after.lte` filter. | `src/app/api/internal/generations/route.ts`; `scripts/generation-checks.cjs` (the deletion-filter assertion now reads the route source, because the rotation makes the query order time-dependent) |
| V8 preview vs export font face | `loadFonts` (fonts in use, no `previewText`) loads one stylesheet per family with `family=<F>:wght@800`, falling back to the default face on a 400 (family without 800), which is the order `text-png.ts` uses for export. The picker's `previewText` batch request is unchanged. | `src/lib/studio-data.ts` |
| V12 failed font load cached | `link.onerror` removes the link and deletes the cache key (after the 800 to default fallback), so the next `loadFonts` call retries. | `src/lib/studio-data.ts` |
| V9 protocol shared by 1080/720 workers | Worker `/health` reports `protocol: 3, size: "720x1280"`; the app requires `protocol === 3`. | `render/server.mjs`, `src/lib/server/export-jobs.ts`, `scripts/export-checks.cjs`, `scripts/render-admission-checks.cjs` |
| V10 unknown duration became 5 s | `checkHook`: `mp4Seconds(video) ?? probeSeconds(video) ?? DESCRIBED_SECONDS`, where `probeSeconds` writes the buffer to a temp dir, parses ffmpeg's `Duration:` from stderr (20 s timeout) and logs when still unknown. ffmpeg is already traced for `/api/runs/*/generate` and `/api/internal/generations`. | `src/lib/server/hookgen.ts` |
| (new) 400/422 with non-JSON body | After V4, `await result.json()` threw for an explicit 400/422 whose body is not JSON, so the job retried forever instead of using the single fallback/refund. Now non-OK bodies are parsed with `.catch(() => null)`; OK bodies still throw when unreadable (V4 behaviour). | `src/lib/server/hookgen.ts` |

## Earlier the same day (already live, also worth a look)

- `7667152` text images looped (`-loop 1 -framerate fps -t total`, overlay `shortest=1`): a text starting at a piece
  boundary was dropped on real clips. Codex's `verify-export-media.cjs` now covers it.
- `624518e` 720x1280 export, `/auth/continue` (no plan: `/settings/plans`), TikTok Sans default font.
- `ed6bf0f` recovery cron every minute (Vercel Pro).

## Still open (product decisions, not fixed)

- V11 Glass/Dark glass cannot blur the video behind exported text.
- Ambiguous provider acceptance (`uncertain` jobs) is manual; no operator tool.
- V6 cap is per day and app-level; a durable per-attempt budget in the reservation transaction would be stricter.
- Successful-but-incomplete fal results (V4) retry without an age limit; consider a terminal policy after N hours.

## Questions for the review

1. Is the V7 rotation correct and fair under the 300 s budget, and is returning 503 only when nothing succeeded right
   for Vercel cron?
2. Any path where the V6 count query failing blocks generation incorrectly (it throws; the route answers 503)?
3. Does the per-family font loading change preview rendering for the built-in next/font families or system fonts
   (they are skipped as before)?
4. `probeSeconds` inside a 300 s poll: acceptable cost and timeout?
