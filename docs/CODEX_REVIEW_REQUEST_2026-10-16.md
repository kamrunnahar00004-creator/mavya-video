# Codex review request: Mavya hook + demo studio (2026-10-16)

Second full review. Your first one (`docs/CODEX_REVIEW_REQUEST_2026-10-15.md`, report in `docs/CODEX_REPORT_2026-10-15.md`) still describes the product, the stack and how to run it; read both first. Since then Claude built a lot on top (list below). Your jobs, in order:

1. **Review everything**, not only the new work: bugs, logic errors, data that can get into a bad state, inconsistencies between the three editors, race conditions, performance, security of the API routes, dead code, anything confusing. Be blunt.
2. **Fix what is clearly a bug and safe to fix** (small, focused commits, one topic each, message says what and why). Do not redesign UI, do not change copy, do not change the interaction model. Anything that needs a product decision: list it, do not change it.
3. **Report** in `docs/CODEX_REPORT_2026-10-16.md` (format at the end). Claude will verify every fix and finding afterwards.

Checks that must stay clean: `npx tsc --noEmit`, `npx eslint src`, `node scripts/review-checks.cjs` (extend it with cases for anything you fix in `src/lib`). Local git only, branch `main`. Never commit `.data` or `.env*`. Never delete the founder's runs in `.data/db.json`; create your own test runs through the API and delete them after.

---

## What changed since your last review (newest last)

| Change | What it does | Main code |
| --- | --- | --- |
| Cut = pieces inside one clip | A clip (hook or demo) has `parts: {id,start,end}[]` in file seconds, played back to back. Cut splits the piece under the playhead; select a piece to trim (shrink only) or delete it; Undo. Absent `parts` = one piece from `start` to `end`; `storeParts()` keeps `start`/`end` = min/max | `src/lib/edit.ts` (`partsOf`, `storeParts`, `pieceSpans`, `fileAt`, `relAt`, `remapTexts`), `setParts` in `RunView`, `ClipEditor` / `ClipControls` in `src/components/run-view.tsx`, `TrimmedVideo`, `SyncedVideo` (`piece` prop) in `run-preview.tsx` |
| Texts follow pieces | `remapTexts` maps every text edge through the old piece and file frame to its new place; texts only on a deleted piece are removed; `keepAfter` (magnet off) keeps what follows in place | `src/lib/edit.ts` |
| Full editor ("Edit video" under the phone) | Full-screen dialog: video centered, settings for the selection beside it, one timeline with every clip piece (frame strips), text rows, sound rows. Select / Cut (S) / Delete / Copy-Paste (Ctrl+C / V) / + Clips / + Text / + Sound / zoom / Undo-Redo over the whole video (snapshots of hook, demo, texts, sounds) | `VideoEditor`, `WholePlayer` (`edit`, `toolbar`, `compact`), `WholeControls`, `useSounds` (step 5 and the editor share it), `dragTextBar`, `Filmstrip` / `frameAt` |
| Main track | Magnet on (default): trimming makes everything after slide along live; drag a clip to reorder (a piece of a Cut clip becomes its own clip); + Clips / Paste insert at the clip edge nearest the playhead and shift later texts. Magnet off: drag a clip anywhere between its neighbours, shortening / deleting leaves empty space (`DemoClip.gap`, black), turning it back on closes gaps | `moveClipTo`, `shiftClip`, `closeGaps`, `insertClips`, `deleteClip(hold)`, `setParts(hold)` in `RunView`; `timeline()` adds gaps to offsets; `videoLength`, `segAt` |
| Timeline scale | Editor bar spans `max(2x video, video + 10 s)`, dashed line at the end | `WholeControls` (`width`) |
| Shortcuts | Work after a click on a toolbar button or after Delete (focus falls to the page): `active` ref set by a window pointerdown listener | `WholePlayer` keyboard effect |
| My files = history | Drawer with everything ever used or made across all runs: Hooks (library / uploaded), Characters (and uploaded photos), Generated hooks (every version, `hook.versions` keeps old ones on Regenerate), Demos (each run's clips as cut), Music, Exports (`run.exports`, empty until Export exists). Use replaces that part of the open video; an old generated hook also brings its source hook and character | `src/components/history-panel.tsx`, `applyGenerated` and the `HistoryPanel` wiring in `RunView` |
| Smaller | Dashboard "New video" spinner reset (cacheComponents keeps page state), song picker copyright note, number inputs without spinners | `runs-list.tsx`, `SongBrowser`, `AdvancedSettings` |

Validation for new fields is in `src/lib/server/run-validation.ts` (`parts`, `gap`, `versions`); sounds are sanitised in `src/app/api/runs/[id]/route.ts`.

## Things Claude already suspects (verify, do not assume)

- `run-view.tsx` is now about 4,500 lines; `WholeControls` mixes step 5 and editor behaviour behind `edit?`. Any obvious split that is purely mechanical and safe is welcome; say so before doing anything large.
- Pulling one piece of a Cut clip out as its own clip (`moveClipTo`) leaves texts at their old times.
- Replacing the demo from My files keeps the current texts (they may now sit on the wrong clips).
- Undo in the full editor is snapshot based; slider drags in Advanced settings are not grouped (one gesture can be many steps or none).
- `frameAt` keeps one hidden `<video>` per file forever and caches data URLs for the session; check memory and what happens when a file 404s.
- Step 3 / 4 clip bars and the full editor both edit pieces; check they stay consistent (selection, undo stacks are separate per editor).
- Gaps (`DemoClip.gap`) and features written before gaps existed: `moveClip`, `insertClips`, `fillClip`, `cutOutTexts`, the phone preview, sound defaults that use `videoLen`.
- The `/api/runs` list returns full runs (the history panel uses them); check size and whether a projection is needed.
- Anything in your 2026-10-15 report that was left open.

## Do not change

- Look and interaction model (violet accent, ink-bordered primary buttons with hard shadow, cool greys, track colours, rectangular buttons, one main button + outlined options).
- Copy: short, no em-dashes or en-dashes anywhere (code comments included), no filler text.
- On-screen text is static: no text animations.
- AI runs only on an explicit click.
- No scraping, no third-party downloaders.

## Report format (`docs/CODEX_REPORT_2026-10-16.md`)

1. **Summary**: 5 lines max.
2. **Fixed**: one line per fix with the commit hash, the bug, how to reproduce it before the fix.
3. **Found, not fixed**: severity (high / medium / low), the problem, a concrete repro, your suggested fix, and why you did not do it (needs a decision, too big, risky).
4. **Performance**: anything measured, before and after.
5. **Checks**: output of the three checks at the end.
