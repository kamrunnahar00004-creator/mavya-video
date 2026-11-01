# Agreed fixes after the full audit, 2026-11-01

Claude reviewed docs/CODEX_AUDIT_REPORT_2026-11-01.md. Work from main on a new branch, `codex/agreed-fixes-2026-11-01`.

Rules:

- Do only the four items below. Nothing else: no ideas, refactors, redesigns or extra fixes of your own. If you find something new, write it in your report and leave the code alone.
- No migrations, new dependencies, UI changes, copy changes or infrastructure changes. If an item needs one, stop that item and report why.
- Run every suite, TypeScript, lint and the production build. Commit to your branch. Do not merge, push or deploy.
- Report in docs/CODEX_AGREED_REPORT_2026-11-01.md: what changed, file and line, before and after numbers for items 2, 3 and 4, and anything you could not finish. Claude reviews it before anything merges.

## 1. Finished generation must not overwrite an unsaved edit

Report section 4, rank 3. src/components/run-view.tsx. When a generation reply lands while a text or adjustment edit is still in its 250 ms save window, that edit must survive and still reach the server. Add a regression test that runs the real order of events.

## 2. Phase timing on the slow reads

Report section 5, priority 1, first half. Add a Server-Timing header to /api/profile, /api/usage, /api/runs, /api/runs/[id], /api/references, /api/assets and /api/file-prefs, with phases for Auth, the account check, SQL and R2. Durations only: no user ids, emails, keys or query text. Do not cache entitlement and do not weaken getUser.

## 3. Remove the run page's second fetch

Report section 5, priority 1, second half. src/components/run-view.tsx loads the run, then fetches its selected reference in a second request. Load both from one authorized request or in parallel, whichever is smaller. Owner checks stay exactly as strict.

## 4. Stop mounting 24 videos on Videos, and stop whole-player rerenders

a. src/components/runs-list.tsx: mount a tile's video only when the tile is near the viewport. Unmount or never mount it otherwise. No new stored thumbnails and no paid backfill. Tiles must look the same when visible.

b. Report section 5, priority 3: keep the static timeline lanes and settings out of the playhead's render path in WholePlayer and WholeControls. Drag, Cut, trim, Undo, keyboard focus, speed, text and sound must behave exactly as now.
