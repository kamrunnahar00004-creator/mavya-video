# Codex: brutally review the speed fixes before they ship (2026-11-06)

These follow `docs/CODEX_SPEED_REPORT_2026-11-06.md`. The founder approved fixes 1 to 4 on one condition: **nothing may break, and the core features must keep working.** US customers come first; the Vercel functions stay in iad1 next to Supabase us-east-1.

**Review only. Do not change code, commit or push.** Write `docs/CODEX_REVIEW_2026-11-06_SPEED_FIXES.md` with a verdict ("ship" or the blockers).

Commits, local and not pushed: `git log e2edca9..HEAD`.

1. **`9d44ec4` New video opens at once** (`src/lib/pending-runs.ts`, `runs-list.tsx`, `library-view.tsx`, `reference-view.tsx`, `run-view.tsx`, `src/app/api/runs/route.ts`):
   - New video, Library's Use this hook and the reference page's Use in a new run now generate the id, call `startCreate`, and navigate at once.
   - `POST /api/runs?view=editor` answers `{ run, source }`, the editor's own projection. For a retried id it returns the stored run's hook, and 404 if that hook is gone. Plain POST is unchanged.
   - `RunView` uses the in-flight create via `peekLoad`/`forgetLoad`:
     - on success, no GET;
     - on 402 (never sent today), it goes to `/pricing`;
     - on an error, it shows "Couldn't create the video." with Try again on the same id (the upsert is idempotent, `ignoreDuplicates`) and Back to videos.
   - The list, library and reference views reset their busy state in an effect cleanup, because Next keeps them in Activity and Back showed a stuck skeleton. Claude caught that in testing.
2. **`08d6e6b` Hover prefetch:** pointer-enter, focus or touch-start on a video card calls `prefetchRun`. `RunView` uses it once. An unused prefetch is dropped after 15 s, a failed one falls back to a fresh GET, and it never replaces a create in flight.
3. **`30bba80` Render worker:** upload copies run before queued exports, with an export after every 3 copies in a row, still one job at a time. `previews.ts` rechecks a missing copy after 2 s instead of 20 s.
4. **`8d88016`:** three offline checks (`verify-previews`, `verify-export-media`, `measure-export-quantization`) had been broken since `e2edca9`'s required frame count. They are fixed and pass.
5. **Fonts:** Geist Mono gets `preload: false`, so there are 5 root font preloads instead of 6. Claude found that Geist Sans is the landing font and Satoshi the app font, so both stay preloaded. Caption fonts (the editor layout) are untouched.

**Claude's testing.** A local credential-free dev copy (no `.env`, local JSON store), driven by headless Chrome over CDP. Script: `/tmp/claude-1000/-home-farhan-listinglens/77a52ec3-36ea-4781-bab1-ef9ec234d177/scratchpad/cdp.mjs`. Results:
- **New video:** the URL changes in 87 to 121 ms, the page shows, and the run exists in the store. Back shows the list in 27 to 42 ms.
- **Forced 503 on create:** the error shows, Try again works with the same URL, and exactly 1 run is created.
- **Rename after create, reopened by client navigation:** fresh data is fetched and the new title shows. With HEAD's code it also refetches; Claude's first version broke this, through the stuck skeleton, and that is fixed.
- **Hover:** 1 editor-data request before the click, 0 after it, page ready in 89 ms.
- **API:** `?view=editor` with `sourceRefId` returns the full source; a retry without the hook returns the stored hook; a bad hook returns 404.
- `tsc`, eslint, the production `next build`, `render-admission-checks`, `render-checks`, `verify-previews`, `verify-export-media` and `frame-schedule-checks` all pass.

## Check brutally

- **Security:** can `?view=editor` on POST leak another user's reference or run? Can a prefetch or create cache leak across accounts in one tab (sign out, then sign in as someone else)?
- **Every New video entry point and every redirect.** Signed out, plan missing, account closing, the list empty state, double-clicks, and slow or failed networks. Back and forward. Opening the new video in a second tab. Deleting a video right after creating it.
- Anything in `RunView` that assumed the run exists on the server before the page opened: autosave PATCH, generate, export, upload, step logic. In particular, a PATCH sent before the create finished.
- **The worker queue:** starvation, the `ahead` position reported to the app, `/health`, memory, and the 15-minute job limit.
- The 2 s recheck: the R2 HEAD request rate under polling.
- Re-measure New video and Open video in your offline harness against the `e2edca9` baseline.
