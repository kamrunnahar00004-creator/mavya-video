# Codex review request: Mavya hook + demo studio (2026-10-15)

You are reviewing and improving a local prototype built by Claude over the last two days. Three jobs, in this order:

1. **Make it fast.** The founder says the app is laggy. Find the real causes, fix them, and measure before and after.
2. **Find and fix bugs, logic errors and inconsistencies.** List what you find, fix what is safe to fix, flag what needs a product decision.
3. **Report back** in `docs/CODEX_REPORT_2026-10-15.md` (format at the end).

Do not redesign anything. The founder approved the current look and interaction model (details in "Do not change").

---

## 1. The product in one paragraph

Mavya makes short-form "hook + demo" videos for Instagram Reels / TikTok. The user steals a hook from a library of real viral videos, picks an AI character, generates a new hook clip in that style (stand-in sample clip for now, Runway later), adds their own product demo clips, adds sound, and exports. The founder's whole wedge is simplicity: fewest visible fields, every step the same pattern.

## 2. Run it

- Repo: `/home/farhan/mavya-video` (WSL Ubuntu). Local git only, no remote. Branch `main`.
- Dev server: `npx next dev -p 3100` (the founder's helper runs it detached and does `rm -rf .next` first, because Tailwind changes sometimes do not hot reload).
- Next.js 16 App Router, React 19 (React Compiler lint rules are on), Tailwind v4, TypeScript.
- Checks: `npx tsc --noEmit` and `npx eslint src` must both stay clean.
- Data: local JSON store `.data/db.json` (about 616 KB), media files in `.data/media`, library source videos in `.data/sources/<shortcode>.mp4` (331 files, about 1.4 GB). `.data` and `.env*` are git-ignored; never commit them.
- Curator mode via `.env.local` (`NEXT_PUBLIC_CURATOR=1`, `CURATOR=1`).

Recent commits (newest first): `6516273` sticky magnet + unified choosers, `e87828c`, `789adce` redesign, `405f4a8` checkpoint of all feature work.

## 3. What was built (where to look)

| Area | What it does | Main code |
| --- | --- | --- |
| Shell | Sidebar: Videos, Viral library | `src/components/app-shell.tsx`, `nav-links.tsx` |
| Videos dashboard `/studio` | Grid and list views (remembered in localStorage), rename in place, delete, progress "Step n of 5" / "Ready" | `src/components/runs-list.tsx`, `runSteps()` in `src/lib/edit.ts` |
| Viral library `/library` | 9:16 hook cards, filters (All / Text + music / Voiceover), sort, preview modal with Instagram embed + stats + summary | `library-view.tsx`, `SourcePicker` / `HookCard` / `HookPreview` in `run-view.tsx` |
| Run page `/studio/[id]` | Five collapsible steps on the left, watch-only phone preview on the right, Export in the header (export is NOT implemented, it shows a toast) | `RunView` in `src/components/run-view.tsx` |
| Step 1 Steal a hook | Browse hooks (overlay picker), Upload a video, Describe your own | `RunView`, `SourcePicker`, `UploadDrop`, `NoteField` |
| Step 2 Character | 70 generated characters (`public/characters`), upload a photo, describe | `CharacterStep`, `CharacterBrowser`, `src/lib/characters.ts` |
| Step 3 Generate hook | Stand-in generation (10 s wait, then `public/samples/hook-sample.mp4`), Regenerate with an optional "What went wrong?" note | `GenerateStep` |
| Shared clip editor | Used by the hook AND every demo clip: player bar, trim with Cut / Undo, text bars with timing, zoom / position keyframes, Advanced settings (flip, volume, speed, brightness, contrast, saturation, warmth, zoom), text rows (font, colour, 50 styles, emoji), full screen | `ClipEditor`, `ClipControls`, `AdvancedSettings`, `TextRow`, `TrimmedVideo`; maths in `src/lib/adjust.ts` |
| Step 4 Demo | Upload one or many videos (become Clip 1..N, sorted by file name), or "Build it clip by clip" with an optional shot list ("How to film (optional)"); suggested on-screen text is placed on a clip when its video is uploaded | `DemoStep`, `ShotBrief`, `shotList()` / `demoClips()` / `timeline()` / `retimeTexts()` / `cutOutTexts()` in `src/lib/edit.ts` |
| Step 5 Sound | Whole-video player with three lines (clips, texts, sound). Sound rows like CapCut: every sound has its own row (like text rows) and rows overlap and play together; Split cuts the sound under the playhead into two pieces on the same row; + Sound adds a new row from the playhead to the end; select / trim / move pieces (never past same-row neighbours), delete, keyboard shortcuts (Space, Delete, S / Ctrl+B, Ctrl+Z / Ctrl+Shift+Z, arrows, Esc). Selected piece card: waveform with the playing part highlighted (drag to choose the part), volume, change. Sources: the hook video's own sound, real songs (Deezer public API: Trending = 6 merged editor/label playlists, Top songs, search; the 30 s preview is downloaded into `.data/media` on Use), or an upload | `SoundStep`, `WholePlayer`, `WholeControls`, `SoundPart`, `VolumeButton`, `SongBrowser`; `src/lib/sound.ts`; routes `src/app/api/songs/*`, `src/app/api/sounds/[code]` |
| Phone preview | Watch only: plays the whole timeline with texts, clip volumes and sound pieces; play bar with scrub | `RunPreview`, `SyncedVideo`, `SyncedAudio`, `soundAt()` in `src/components/run-preview.tsx` |
| Playback rules | Only one player with sound plays at a time (`claimPlayback` / `usePlaybackClaims`); sound starts after the page's first click (browser autoplay rule, `useSoundUnlocked`) | `run-preview.tsx` |
| Timeline magnet | Text and sound edges snap within 12 px and hold until pulled about 26 px away | `magnet()` in `run-view.tsx` |

Data model is in `src/lib/types.ts` (`Run`, `TextLayer`, `DemoClip`, `SoundPiece`, `Adjust` in `adjust.ts`). Texts live on the whole-video timeline in on-screen seconds; clips keep trim points in file seconds and a speed; keyframes are stored in file time so they survive Cut and Speed.

## 4. Performance: what Claude already sees (verify, then fix)

Measured on 2026-10-15 in dev mode:

- `GET /api/references` returns **442 KB** and is fetched by the run page and by the videos dashboard on every load, only to show a handful of covers and the hook picker.
- `.data/db.json` is **616 KB** and is read and fully rewritten on every PATCH (`src/lib/server/store.ts`).
- `src/components/run-view.tsx` is **3,612 lines**; `RunView` holds the whole run in one state object, so any change (a text drag frame, a slider tick) re-renders every open step, the phone preview and all their children.
- **Up to 9 `requestAnimationFrame` loops** call `setState` every frame: the phone preview clock, the step 5 player clock, and one per open `ClipEditor` (hook editor and each open demo clip editor), plus the progress animation. Editors default to `playing = true`, so several videos play and re-render at 60 fps at the same time when more than one step is open.
- `SyncedVideo` / `SyncedAudio` receive a new `at` every frame and run effects every frame.
- Several controls save on every input tick instead of on release or with a debounce: the sound volume (`VolumeButton` -> `put()` -> PATCH + db rewrite per tick), likely the "Song part" drag and others. Text edits and Advanced settings are debounced (250 ms); check the rest.
- `SoundPart` downloads and decodes the whole audio file (for a library sound that is the full source mp4, about 4 MB) every time it mounts, to draw 90 bars.
- `/api/sounds/[code]` streams the whole source mp4 (video + audio) just to play its audio.
- Everything is measured in `next dev`; also measure `next build && next start`, the founder may be judging dev-mode speed.

Ideas, your call: only one clock runs at a time (pause editors that are not focused or not visible), move the playhead with refs / CSS instead of React state at 60 fps, `memo` / split `run-view.tsx` into modules with stable props, a light `/api/references?fields=` or a paged / summary endpoint, debounce or save-on-release everywhere, cache waveform peaks (per sound, in memory or in `.data`), extract and cache audio as m4a once with the bundled `ffmpeg-static`, make writes to `db.json` cheaper (per-run files or a coalesced write queue). Keep behaviour identical.

## 5. Bugs and risks Claude suspects (confirm each before fixing)

1. Many steps can be open at once; each open `ClipEditor` autoplays its video (muted) forever, even off screen.
2. The clip editor's own video is always muted, so a clip's Volume setting can only be heard in step 5 and the phone preview.
3. A sound shorter than its stretch loops (`soundAt`), but nothing on the sound line shows where it repeats.
4. `retimeTexts` and other helpers round to 0.1 s; snapped edges are stored exactly (3 decimals). Check that a Cut or Speed change after snapping does not break "text ends exactly where the clip ends" (the full-length ring check uses a 0.05 s tolerance).
5. `Run.sound` (single, older) and `Run.sounds` (pieces, current) both exist; `soundPieces()` falls back to `sound`. `Run.partSounds` and `Run.partModes` are dead (an abandoned design) but still in types, API validation and `lib/sound.ts`. Remove dead paths carefully.
6. `src/components/editor.tsx` (1,358 lines, an older CapCut-style editor) and the `/studio/[id]/edit` route look unused. Confirm and remove, or say why not.
7. Undo / redo for Cut and for the sound line live in component state and reset on reload or when a step closes.
8. Step progress is computed in two places (`stepDone` in `RunView` and `runSteps()` in `lib/edit.ts`); make it one.
9. The demo placeholder: with no demo clip the timeline adds a 3 s "Your demo" segment. Check every place that maps texts on and off the placeholder (`fillClip`, `addVideos`, `deleteClip`, `resetDemo`) for drift.
10. Keyboard shortcuts in step 5 listen on `window`; check they never fire while typing in any input, contentEditable or dialog, and do not fight other editors.
11. `role="button"` divs with pointer handlers in the timelines and players: check keyboard access and focus styles.
12. API validation: `src/app/api/runs/[id]/route.ts` accepts `hook`, `demo` and `texts` objects mostly as-is. It is a local single-user prototype, so do not over-engineer, but reject obviously broken shapes and keep the `src` allowlist for sounds.
13. Test leftovers: the founder's dashboard contains many "Untitled video" runs created by Claude's headless tests (they use `/samples/hook-sample.mp4`). Do not delete user data yourself; list them in the report.

Anything else you find counts: inconsistent behaviour between the hook editor and demo clip editors, state that is not saved, race conditions between debounced saves (`commitTexts`, `liveAdjust`) and full saves (`save()` overwriting newer live state), stale closures in pointer handlers, memory leaks (event listeners, Audio objects, object URLs), layout breakage at narrower widths.

## 6. Do not change (founder decisions)

- Visual design and palette: violet `#7b4cfa` on cool violet-tinted greys; timeline tracks video ink, text blue, sound magenta; red only for errors and deleting. Primary buttons keep the 2 px ink border + hard offset shadow (brand signature).
- Interaction model: shared clip editor for hook and demo clips; step choosers = main button + outlined option buttons; CapCut-style sound rows (one row per sound, split / + sound / trim / move, sticky magnet); waveform part picker; watch-only phone preview; Export in the header.
- On-screen text is static: no text animation features.
- Copy: no em dashes or en dashes anywhere in UI text. Keep UI copy short; no explanatory helper lines (use `title` tooltips).
- AI runs only on an explicit click; nothing calls an AI on page load.
- No scraping and no third-party downloaders. Deezer public endpoints and the founder's own Meta-API downloads are the only external media sources.
- Keep it local-only: no auth, no hosting, no new paid services.

## 7. How to work

- Small, reviewable commits on `main`, local only (there is no remote; do not add one). Author as configured in the repo.
- Keep `npx tsc --noEmit` and `npx eslint src` clean after every commit.
- Verify in a real browser (headless Chrome is fine) for anything that touches playback, dragging or saving. Claude's throwaway test scripts drove Chrome over the DevTools protocol; write your own if useful.
- For performance, measure before and after (React Profiler, Chrome Performance panel, or simple timings: page load, time to interactive, frame rate while a clip plays with two steps open, PATCH count while dragging a slider).
- If a fix needs a product decision, do not guess: list it under "Needs founder decision".

## 8. Report format (`docs/CODEX_REPORT_2026-10-15.md`)

1. **Summary**: 5 lines max.
2. **Performance**: each cause found, the fix, the measured before / after numbers, commit hash.
3. **Bugs fixed**: one line each: what was wrong, how it showed up, the fix, commit hash.
4. **Found but not fixed**: why (risk, needs decision, out of scope).
5. **Needs founder decision**: questions in plain language, each with a recommendation.
6. **Verification**: what you ran (tsc, eslint, browser checks) and the results.
