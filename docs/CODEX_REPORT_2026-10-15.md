# Codex review report, 2026-10-15

## 1. Summary

- Reduced concurrent editor playback, save traffic, reference payloads, and repeat audio decoding.
- Production playback scenario: 720 to 239 animation callbacks in four seconds; three playing videos to one.
- A 21-tick sound-volume gesture now saves once instead of 21 times, retaining the final value.
- Fixed storage recovery, sound migration, text timing, API shape validation, keyboard isolation, and narrow layouts.
- Local commits only; original runs/media retained; remaining product choices are below.

## 2. Performance

### Measurement conditions

Actual starting HEAD was `8b2ffcd`, newer than the commits mentioned in the request.
The baseline production build uses that exact revision. The revised production
build includes `bca2e6c`. Both used the existing dependencies, Node 20.20.0, Next
16.4.0, and separate temporary directories with separate database snapshots.
No dependency installation, external media downloads, or AI calls were needed.

Browser: Windows Chrome headless, driven through the DevTools protocol. The
test run was a copy of an existing sample run, with a generated hook, one
uploaded demo, and two sound rows. Opened hook, demo, and sound steps, including
the demo clip editor. Four-second animation callback counts measure scheduled
application work, **not dropped frames, React commits, or an FPS benchmark**.
The original development server on port 3100 stayed running. Temporary
production servers used ports 3101 and 3102/3103.

| Confirmed cause | Change | Before | After | Commit |
| --- | --- | --- | --- | --- |
| Open clip editors autoplayed and ran separate frame loops alongside the phone | Start editors paused; starting one claims playback; pause off-screen editors and hidden-page players; pause media when the loop is disposed | Production: 720 animation callbacks / 4 s; 3 videos playing | 239 callbacks / 4 s; 1 video playing. Repeat: 717 vs 239. Desktop check: 240 after | `b2e20a0`, `7d8380b` |
| Volume input sent one complete save per input tick | Merge pending section patches for 250 ms, serialize requests per run; live React state still updates immediately | 21 PATCHes for 21 values at ~16 ms intervals | 1 PATCH; final values 60 in dev and 85 in production verified from the API | `b2e20a0` |
| Dashboard downloaded all reference curation records for covers | Explicit covers projection, preserving uploaded-reference thumbnail fallback | 442,399 response bytes | 36,742 bytes, 91.7% smaller | `af0334a` |
| Run page downloaded internal curation/model history | Studio projection keeps the fields used by its picker, previews, and recipes | 442,399 response bytes | 282,768 bytes, 36.1% smaller | `af0334a` |
| Every storage read loaded and parsed the complete JSON file | Cache a validated snapshot against file mtime, ctime, and size; invalidate after writes and external edits | 200 sequential `getRun` reads: 590.3 ms | 7.3 ms, on the same host with equivalent snapshots | `af0334a` |
| Sound playback/waveform fetches transferred the source video | Extract AAC audio once with installed ffmpeg-static, atomic cache publication, concurrent-request deduplication; retain video fallback if extraction fails | Tested source: 3,963,640 bytes, video/mp4 | 424,624 bytes, audio/mp4, 89.3% smaller | `af0334a` |
| Switching sound selections repeatedly fetched and decoded the same audio | Cache promises/peaks by source, at most 24 entries; always close AudioContext, including decode failure | Switching between two rows and back twice: 2 repeat GETs for the library source | 0 repeat GETs for the already loaded library source | `b2e20a0` |

Additional timing observations:

- Ten warm production reference requests: baseline full response median 8.05 ms;
  revised studio response 5.88 ms; revised covers response 1.69 ms.
- Revised studio response in development: warm median 8.85 ms. Development
  React Strict Mode also performed the initial effect fetch twice; production
  performed it once. Strict Mode remains enabled.
- First observed production navigation: DOMContentLoaded 52.2 to 48.9 ms,
  load event 94.0 to 90.1 ms. Warm observations were 9.7/20.1 ms before and
  9.0/17.7 ms after. These small, cache-sensitive samples do not establish a
  meaningful page-load or time-to-interactive improvement.
- First tested audio extraction took 452 ms, including the request. A later
  cached response took 16.29 ms versus 13.62 ms for the old full video on local
  loopback. The verified improvement is transfer size and avoiding repeat
  extraction/decoding, not lower local first-request latency.
- JSON is still atomically rewritten for each **coalesced** save. No storage
  migration or per-run file format was introduced.

## 3. Bugs fixed

- A failed database write poisoned the promise chain, blocking later saves; keep the chain recoverable while propagating the individual failure. `af0334a`.
- Read/parse failures became an empty database and could erase data on the next save; only ENOENT initializes an empty store, and malformed files fail without replacement. Cached snapshots are cloned before mutation. `af0334a`.
- Byte suffix ranges were interpreted as prefixes, and malformed ranges fell through; shared media streaming now handles suffix/open ranges and returns 416 for invalid requests. `af0334a`.
- Clip editor volume was inaudible because the video was always muted; explicit playback now uses its volume and claims the shared playback channel. `b2e20a0`.
- Full-screen clip playback could overlap other audio, ignored adjusted volume, and displayed all texts regardless of timing; claim playback, apply volume, and filter texts by its actual playhead. `b2e20a0`.
- Deleting all current sound pieces could revive a legacy `sound`; an explicit empty `sounds` array now stays empty, including progress calculation. `b2e20a0`.
- Legacy single-sound bars ignored saved `at`/`end`; preserve those bounds when reading legacy runs. `b2e20a0`.
- Trim/speed/delete operations rounded text boundaries to tenths and could lose an exact snap; use millisecond timing and explicitly retain clip-edge alignment. `b2e20a0`.
- Replacing an existing demo clip shifted its own text as though a new clip had been inserted; use the same retiming helper used for trim/speed changes. `b2e20a0`.
- Step completion was duplicated; the run page now calls `runSteps`, as the dashboard does. `b2e20a0`.
- Sound shortcuts listened across all editors and could intercept other controls/dialogs; scope them to the sound player, respect handled events and native controls, and mark overlays as dialogs. `b2e20a0`.
- Phone play/scrub, sound selection/movement, keyframe jumping/movement, clip trim handles, and waveform part selection had incomplete keyboard support; add focusable controls and key handling without changing their pointer model. `b2e20a0`, `7d8380b`.
- Debounced text/adjustment timers could lose changes on navigation; flush dirty sections and queued requests on unmount/pagehide, using keepalive for saves. Hook text mirrors its live text layer. `b2e20a0`, `7d8380b`.
- Detached audio/video metadata probes retained their source and could wait indefinitely; clear handlers/source and impose a 15-second timeout. `7d8380b`.
- Malformed nested hook/demo/text sections could be persisted and crash the studio; reject invalid shapes, nonfinite/range-invalid values, invalid adjustment/keyframe arrays, and external generated-video sources. Preserve the sound source allowlist. `02fced7`.
- Text arrays were silently truncated to 30 on save; validate a bounded array of up to 200 and preserve accepted texts. `02fced7`.
- Dead `partSounds`/`partModes` API/type paths remained; remove them without rewriting old JSON. Retain the live legacy `sound` fallback. `02fced7`.
- The disconnected older editor had no incoming app navigation but remained accessible by URL; remove its 1,358-line implementation/loader and redirect old bookmarks into the current studio. Use a Suspense boundary for Next cache-component prerendering. `02fced7`, `76ad42b`.
- Fixed columns squeezed the sound timeline to 3 px at a 758 px viewport; stack existing panels when space is insufficient. After: 403 px track, page width 758 px, no horizontal page overflow. At 1440 px: 670 px track and no page overflow. `bca2e6c`.

## 4. Found but not fixed

- **My files demo selection:** it still writes the older `demo.clip` field;
  existing `demo.clips` takes precedence, so a picked asset can appear to do
  nothing. Image assets also cannot become a playable demo through the current
  video timeline. Append versus replace needs the choice in section 5.
- **Export and real generation:** Export still shows its existing toast, and
  generation remains the explicit-click sample implementation. Completing either
  is feature work outside this review.
- **Undo history:** Cut and sound undo/redo remain component-session state and
  reset when their step closes or the page reloads. Volume ticks still consume
  individual undo snapshots even though network saves are coalesced. Grouping
  one gesture into one undo action is a sensible follow-up.
- **Repeat visualization:** the selected sound card already has a `Loops` label.
  The track still has no markers at each repetition. Audio looping itself was
  retained, rather than silently changing it to silence or stretching.
- **Large component/active clocks:** `run-view.tsx` remains large; input updates
  still rerender open sections, and the one active player still updates its
  clock in React at animation-frame frequency. No broad component rewrite or
  ref/CSS clock migration was justified by the measured gains in this pass.
- **Storage scope:** recovery and caching do not make JSON safe for multiple
  independent server processes writing the same file, or solve simultaneous
  browser-tab edits to the same whole section. Keep one local server as intended.
- **Save failures:** existing UI still has no durable retry/error state for a
  failed background save. Keepalive cannot guarantee delivery after a browser
  crash or OS termination.
- **Pointer/accessibility audit limits:** key controls above were repaired, but
  not every text/sound edge has a keyboard equivalent. The many window-level
  drag listeners still generally depend on pointerup rather than a common
  pointer-cancel/unmount controller. A broader accessibility/lifecycle pass
  remains; this is not a claim of complete keyboard accessibility.
- **Placeholder review:** first-demo insertion, last-demo deletion, and reset
  use the shared retiming path; replacing a filled clip had the concrete defect
  fixed above. Real multi-file uploads, every placeholder transition, every
  category of overlapping text, and extreme minimum-duration trims were not
  exhaustively exercised in Chrome.

### Existing likely test leftovers, preserved

These 14 runs have an Untitled run/video name and the generated sample hook.
That combination is a cleanup candidate, not proof the founder does not want
the run. None was deleted:

```text
bd0c49b2-1a84-4406-b2b0-79e180e020f2
d0666700-0dbf-4bd8-8186-20a05e773086
3ceddc08-c42e-412b-9b04-2bd958942670
d696450b-2b2d-44ee-84b6-8a6f9dcbf995
9fd0f871-1cf4-42fd-bac0-553a1647719d
8ccd2813-c3d2-44b2-b948-30a82f7b4c41
ac3e92a5-da56-4311-9e3a-2a98062296de
8cf29ba7-0cf5-4a5c-ab66-392e55dfc976
3a65da52-1101-452e-82fc-c1379c51f6d2
4a07e96c-4ea3-4f5b-8a38-5d8c99a9d4bf
5641de6c-a2a0-4974-94c0-b18e480061fc
3032f11d-4005-4375-a252-565dd322eff8
20fc7fca-2818-44d2-a221-899c14ae0023
681b154b-e759-4af3-a8f0-ba843bb5cb1c
```

The separate `CODEX TEMP PERFORMANCE CHECK` run created by this review was
removed after verifying its exact ID and title. The dashboard returned to its
original count of 26 runs. A pre-existing run changed during the review through
concurrent app use; those edits were not reverted or replaced.

## 5. Needs founder decision

1. **When you choose a video in My files, should it replace the entire demo or
   add a clip?** Recommendation: add a demo clip, and allow only video assets
   for this action. Replacing all existing clips should be a separate explicit
   choice. The current legacy field write should then be replaced accordingly.
2. **Should undo survive closing a step or reloading?** Recommendation: keep it
   session-only for this prototype, but group slider gestures into one undo
   action before adding durable history.
3. **Do loops need visible repeat marks?** Recommendation: retain current
   playback and the existing Loops label; add small repeat marks only if the
   founder finds the sound line misleading in real editing.
4. **Which sample runs should be removed?** Recommendation: review the list
   above and select explicit IDs; do not bulk-delete by title or sample URL.

## 6. Verification

- `npx tsc --noEmit`: PASS on final source.
- `npx eslint src`: PASS on final source.
- `node scripts/review-checks.cjs`: PASS. Isolated temporary data tests cover
  legacy/current sound migration, millisecond retiming, malformed sections,
  concurrent writes, corrupt-file preservation and subsequent recovery, byte
  ranges, and merged ordered saves. They never open the founder's database.
- `npm run build`: PASS for untouched baseline `8b2ffcd` and final revised
  source, in isolated directories. An intermediate redirect build exposed
  Next's Suspense requirement; corrected in `76ad42b`. Final build has no
  dynamic-filesystem tracing warnings.
- `next start`: baseline and revised production servers started successfully;
  reference, sound, and run endpoints exercised against both.
- Chrome checks: open multiple steps/editors; count playing media and animation
  callbacks; 21 slider inputs and final persisted volume; repeated waveform
  selections; explicit clip playback with audible volume and one playing video;
  full-screen playback with one playing video; input typing isolation; sound
  drag/trim persistence; viewport checks at 758 and 1440 px.
- Sound trim expanded to the exact 8.4-second boundary with one PATCH and the
  API returned `end: 8.4`. A separate trim to 4.2 seconds also persisted.
- Changed hook text, navigated to Videos after 30 ms (before its 250 ms debounce),
  then read the API: both `texts[hook].text` and `hook.text` retained the edit.
- Production malformed hook/demo/text PATCHes: 400. Library audio ranges:
  `bytes=0-99` and `bytes=-100` returned 206 with exactly 100 bytes and correct
  Content-Range; invalid/past-end ranges returned 416.
- All existing run hook/demo/text/sound sections passed the new shape validator
  at the time checked. Dead part fields are retained on disk, not migrated away.
- `git diff --check`: PASS. No remote added and no push performed.
- `git ls-files '.data/*' '.env*'`: empty. No local media or environment files
  committed. Existing installed ffmpeg-static is reused.

Routing: checked supplied listing-workspace source docs and target AGENTS.md,
read the installed Next route-handler guide, searched Ruflo namespace `mavya`
(no matching video-studio decisions), and selected review/testing/API safety/
memory categories. No installed specialist skill matched this maintenance work;
Sites, image generation, auth, payments, and external skill installation were
unnecessary. The explicit video review request scoped this work to this repo;
no listing-coach product changes were made.
