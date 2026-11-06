# Codex: is the app fast, with no delays? (2026-11-06)

The founder asks: check that the app has no delay or latency anywhere and feels super fast. AI generation time (fal.ai Kling, Gemini) is out of scope; everything else is in scope.

**Measure and report. Do not change code, commit or push.** Write `docs/CODEX_SPEED_REPORT_2026-11-06.md` with a verdict, a ranked list of the slowest things, and the smallest fix for each.

## Baseline

On 2026-10-28 you built an offline, credential-free production-build harness (`scripts/measure-brutal-speed.cjs`; results in `docs/CODEX_BRUTAL_REVIEW_SPEED_2026-10-28.json`, `docs/CODEX_LIBRARY_SPEED_REPORT_2026-10-28.md` and related files). It ran with Chrome 156 at 1440x1000, 2x CPU throttle, 250 ms latency, 10/2 Mbps, and 250 ms API fixture delays. Since then a lot has changed: Next 16.4.5, the browser export, multi-select in My files, seamless cuts (`e2edca9`), new characters, and more.

## Do

1. **Rerun the harness on current HEAD** with the same profile, and compare every scenario with the 2026-10-28 numbers. Flag any regression of 100 ms or more.
2. **Add the interactions the founder feels most**, especially in the editor (`src/components/editor-tools.tsx`, `run-view.tsx`, `run-preview.tsx`):
   - opening the editor;
   - play and pause;
   - scrubbing the playhead;
   - dragging and trimming a clip;
   - Cut;
   - adding and editing a text;
   - changing a look slider;
   - undo;
   - switching steps;
   - opening My files and selecting many uploads.
   Measure input-to-paint latency and long tasks (over 50 ms). For the timeline drag, measure frames per second, and check that preview playback keeps up with no dropped frames, using the p480 previews.
3. **Server and API paths:** time every API route the app calls during normal use (`src/app/api/**`) in the offline build:
   - the cost on the server side (database round trips per request, serial awaits that could run in parallel, missing caching);
   - cold start;
   - bundle size per route (first-load JS);
   - anything blocking first paint (fonts, large images, sync scripts).
4. **Upload and export paths, excluding AI:** upload start latency, time until the preview copy is ready (Render worker), export start latency, and the time from export finished to download available.
5. Check the production page for real-user data if you can reach it without credentials: Vercel Speed Insights (`@vercel/speed-insights` is installed). If not, say so.

## Rules

- Never point the harness at production with credentials. Do not write to production.
- Chrome is installed on Windows. Last session, Windows node.exe failed with a WSL vsock error, and a Linux Chrome for Testing worked headless via CDP.
- Report in plain English: a verdict ("fast" or a list of what isn't), then a table per area with numbers, then a ranked fix list with the expected gain.
