# Codex: review the new regression tests and the extraction behind them (2026-11-07)

**Founder rule (2026-11-07):** every problem raised gets a unit or integration test in the repo. Commit, local and not pushed: `git show HEAD`.

## New offline checks (`npm test`)

Each was shown to fail on the old behaviour. Claude restored each old behaviour temporarily (mutation) and confirmed the matching check failed:
- **`scripts/caption-checks.cjs` (38 checks):**
  - the founder's real video timings (`scripts/fixtures/caption-leak-run.json`; media ids replaced, no personal data);
  - the 1.0166 s rounding case;
  - a gap caption;
  - regenerated-hook captions at 1.9, 1.95, 1.98 and 1.999 s (generation, clean and dirty reconcile, export);
  - `retimeTexts`;
  - the PATCH route enforcing it through the real handler with stubs.
  - It fails on commit `74490ed` (rounding) and `dc62726` (ownership), each at the check written for it.
- **`scripts/editor-checks.cjs` (24):**
  - toggling, and the stale-group rule (`activeGroup`);
  - `deleteSelection`: pieces, whole clips, texts on them, the hook kept, magnet on and off;
  - `groupPlacer` for your non-adjacent, before, between and no-clip cases;
  - `pastedRows`;
  - `shiftSounds`.
- **`scripts/speed-fix-checks.cjs` (21):**
  - `pending-runs` with a fake clock and fetch: create success, failure (keeps the hook), 402, a hung prefetch (still waiting at 3.9 s, null at 4 s), expiry 10 s from dispatch, `dropLoad`, `forgetLoad` identity, prefetch never replacing a create;
  - `POST /api/runs?view=editor`: the projection, a retry with the stored hook, 404, plain POST unchanged;
  - `previews.ts`: three simultaneous checks make one HEAD request, a 2 s recheck, and a found copy is remembered.
- **`scripts/sound-queue-checks.cjs` (102):** `fillSound` over 16 length and speed cases (sine and DC: exact length, no silent run, largest step at most 1.6 × the source's); an unchanged copy when the lengths match; `nextJob` order.
- `npm test` also runs `frame-schedule-checks.cjs` (602 cases).

## Extraction (behaviour unchanged)

- `partsChange` and `deleteMany` moved from `run-view.tsx` into `src/lib/edit-ops.ts` (`partsChange`, `deleteSelection`).
- The group logic moved from `editor-tools.tsx` into `src/lib/selection.ts`: `toggleInGroup`, `activeGroup`, `groupPlacer`, `pastedRows`.
- The worker's job choice moved from `render/server.mjs` into `render/queue.mjs` (`nextJob`).
- **Evidence it changed nothing:** Claude's Chrome scripts (`hk2.mjs`, `hk6.mjs` in `/mnt/c/Users/farha/AppData/Local/Temp/mavya-enc`) give identical results before and after. tsc, eslint, `next build` and `render-admission-checks` pass.

## Review

**Review only. Do not change code, commit or push.** Write `docs/CODEX_REVIEW_2026-11-07_TESTS.md` with a verdict ("ship" or blockers). Check brutally:
- Are the extractions faithful to the reviewed code (diff them against `f8b5ebc`)?
- Do the tests really guard each problem, or can a regression pass them? Mutate the fixes yourself.
- Weak or misleading assertions, and flakiness (fake timers, the `vm` realm).
- Problems from today that still have no test: list them, with what test each needs. The full list: seamless cuts, New video, hover prefetch, preview queue, fonts, caption leak, multi-select, CapCut keys, groups, sound rows, inserts moving sounds.
