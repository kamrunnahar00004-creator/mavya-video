# Codex review report, 2026-10-16

## 1. Summary

- Reviewed from clean `a21d514`, including the previous review's open findings.
- Fixed piece/text timing, gapped deletion, cross-editor undo, preview ownership, validation, shared-file deletion, and larger saves.
- Bounded filmstrip resources and removed two unused modules; preserved the design, copy, and interaction model.
- TypeScript, ESLint, extended regressions, production build, production API checks, and Chrome checks pass.
- History provenance, demo-text replacement, track limits, and some timeline policies still need decisions or a broader fix.

## 2. Fixed

Each item includes the reproduction on the starting revision. Commits are local on `main`.

- `56ccf01`: extracting a piece left its text behind; cut a demo, put text only on its second piece, drag that piece after another clip. The piece's text now travels with it and other clip-local texts follow their new offsets. The extracted piece no longer duplicates its original clip's preceding gap.
- `56ccf01`: deleting a gapped demo shifted later text by the clip length but also removed the preceding gap; put a 1 s gap before a 2 s demo and delete it with ripple on. Remove the full 3 s window from text timing. Deleting the last demo now removes its orphan text too.
- `56ccf01`: collapsing/deleting frames could invent a 0.3 s subtitle on the next piece; map a text entirely on deleted frames through `remapTexts`. Collapsed texts are removed, and genuinely short retained texts keep their exact end.
- `56ccf01`: storing one remaining piece discarded its ID; cut, delete one piece, then use the remaining selection in another editor. Preserve non-default singleton IDs rather than replacing them with `p0`.
- `56ccf01`: replacing a demo with an uploaded video could retain `src`, which takes precedence over the new upload; replace a clip originally pasted from a generated hook. Clear the superseded source. Inserted clips' own gaps are also included in later-text shifts.
- `6088284`: frame players, frame data URLs, source queues, and event listeners accumulated; open many files or repeatedly change strip times. Retain at most 256 frame promises and eight idle/file players, allow four active decoders, clear listeners/timers, and bound each mounted strip's retained URLs.
- `6088284`: a missing video stalled later frames for 8 s each; request two different frames of the same 404 source. Clean up after failure and temporarily cache the source failure so queued frames fail promptly. Seeking an already available frame no longer waits for a `seeked` event that may never arrive.
- `50c695f`: duplicate piece/clip/text IDs and a demo named `hook` could target the wrong item; PATCH colliding IDs. Reject them, out-of-file trim points, malformed secondary text colours, and invalid generated notes before persistence.
- `50c695f`: the API accepted legacy AI face index 69 although only six tone pairs exist; save it and open the preview/history. Validate against the actual available legacy faces.
- `50c695f`: malformed reference analysis could break the studio/library; PATCH `analysis: {segments: {}}`, then load references. Validate the analysis envelope and segment/cut shapes, bounds, and thumbnail encoding first.
- `5fc4459`: valid uploaded-video `src` paths failed validation because the old character class excluded the letters in `.mp4`; PATCH a generated/local source `/api/media/<uuid>.mp4`. Accept local MP4/MOV/WebM paths while retaining the local-source restriction.
- `6572447`: full-editor Advanced settings and text-field/preview moves did not reliably record undo; change brightness or drag an overlay, then Undo. Record a snapshot before the edit and group continuous pointer input into one history entry.
- `6572447`: pasted text inherited current neighbouring styling and nudged its position; Copy a subtitle and Paste over it, or change the original after Copy. Paste the captured text style and position.
- `6572447`: insertion from a gap defaulted to demo index zero; put the playhead in a later gap and Paste a clip. Insert at the corresponding gap boundary. Opening a saved gapped video also correctly starts with the magnet off instead of displaying an on state over existing gaps.
- `8bdec83`: Regenerate discarded earlier stand-in generations because every version uses the same URL; generate twice with different timestamps. Retain versions by URL and timestamp.
- `8bdec83`: reusing a described generated hook retained the destination's unrelated library reference; pick a generated hook whose source reference is null. Preserve that null. When the reused hook has a different speed, retime texts using its resulting speed.
- `8bdec83`: history music/export previews could overlap other players; start the phone, then two history sounds. History previews now claim the shared playback channel. History demo durations also account for saved playback speed.
- `35be4a6`: deleting an asset/reference could unlink a media file still used by a run; save an uploaded file into a generated hook or demo, then remove its asset entry. Retain files referenced elsewhere in the JSON store. An isolated regression also confirms unused files can still be removed.
- `35be4a6`: an invalid upload envelope threw a server error; POST JSON to `/api/media`. Return the existing 400 response rather than failing during multipart parsing.
- `b1a55f9`: a reused run component could expose the previous run's controls while a new ID loaded; navigate between runs and edit before the fetch finishes. Require loaded run ID equality, scope not-found state by ID, and discard completed clip-upload insertion into a different open run.
- `c89c777`: large edits silently failed at the browser transport before reaching the API; save a valid JSON edit above 64 KiB. Use ordinary fetch for larger bodies instead of exceeding Chrome's keepalive quota.
- `f9af10d`: the song picker bypassed playback ownership; play a preview while the phone plays. It now claims playback and cleans up its replaced Audio objects. The full-screen piece player also stops its frame loop and pauses media when no longer playing.
- `f9af10d`: phone and step-5 clip bars omitted saved gaps, and the phone rounded total duration to tenths; scrub a gap in a fractional-length video. Position segments by their real offsets and use the same precise duration across players.
- `38063cc`: the old asset drawer and legacy timeline engine had no remaining importers after the earlier editor removal/history replacement. Removed `library-panel.tsx` and `lib/timeline.ts`, 292 dead lines. Compatibility types and persisted JSON were retained.
- `4ff71d3`: a step editor's stale Cut undo could overwrite changes from the full editor or restore trim points from a replaced file; Cut in step 3, delete/trim that piece in Edit video, return and use the old step Undo. Invalidate local history on external piece/file changes, preserve it for local actions, bound it to 50 entries, and refresh the paused frame.

## 3. Found, not fixed

### Medium: history cannot know a generation's original inputs

Repro: generate with character A and source A, later change that run to character
B/source B, then reuse an earlier generated item from My files. The history
entry carries the current run, so the restored character/source can be B even
though the image/video was made with A. `versions` stores URL/time/note, not an
immutable input context. Generation retention is fixed, but provenance is not.

Suggested fix: record source reference, character, prompt/text, and relevant
settings with each generation when its explicit request starts. Use that
snapshot on reuse, and mark older entries as lacking context. This needs a
versioned data-contract change; existing provenance cannot be reconstructed
honestly from the saved records.

### Medium: replacing a demo keeps the destination's old texts

Repro: put a subtitle on the current second demo clip; use a shorter demo from
My files. The clips are replaced and gaps removed, but the subtitle retains its
old absolute time and can now be on a different clip or outside the video.

Suggested fix: decide whether Use should import the source demo's text layers,
remove the old demo-local texts, or remap them. Recommendation: replace the
demo-local text with its source text when reusing the complete demo. The history
callback currently only carries clips, and choosing one of those behaviours
would change the product contract. No silent guess was made.

### Medium: track/collection limits can silently lose edits

Repro: PATCH 21 valid sound pieces; the route returns success with only 20.
Chrome can create/split more pieces than the persistence limit. Row indices
above 20 are also clamped, potentially combining rows. Texts, clips, parts,
keyframes, and generation history have other bounds that their UI does not
uniformly enforce.

Suggested fix: choose supported limits, enforce them in the UI, reject an
oversized complete edit instead of truncating it, and surface save errors.
Requires an agreed visible limit/error behaviour; changing only the API would
replace silent truncation with a silent failed save because of the next issue.

### Medium: background save errors remain invisible

Repro: disconnect the server, edit text, then reload. Local optimistic state
updates, but `patchRun` resolves null and the caller does not display or retain
the failure. The transport quota defect is fixed; durable recovery is not.

Suggested fix: a visible unsaved/error state plus retry of the latest edit,
without replacing newer edits when retrying. This needs approved copy and a
small persistence-state workflow. The request forbids changing copy or the
interaction model. Large saves also cannot be guaranteed during tab/browser
termination; normal in-page large saves now work.

### Medium: sounds can lie outside a shortened video

Repro: put a sound at 7 s in a 9 s video, then shorten/remove the demo so the
video ends at 2 s. `pieceEnd` clamps the end to 2 while the start stays at 7,
producing a negative visible span; the saved sound still counts toward progress
although it cannot play in the current video.

Suggested fix: preserve the record but explicitly represent out-of-video pieces
as inactive, or agree to trim/move them with main-track edits. Decide whether
progress requires an audible overlap. Dropping or moving them automatically
would change track semantics and could destroy an intentional arrangement.

### Medium: speed changes do not honour magnet-off placement

Repro: turn the magnet off, place a later clip after a gap, then change the
preceding clip's speed in Advanced settings. `liveAdjust` remaps duration/text
with ripple behaviour; it does not compensate the following gap as piece trims
do, so the later clip moves.

Suggested fix: share a pure duration-change operation between speed and piece
trimming, and agree how speed expansion consumes a gap before it reaches a
neighbour. This spans the three editors and needs that collision policy, rather
than another special-case offset patch.

### Medium: asynchronous media operations can commit stale sections

Repro: begin adding/changing a sound, make another sound edit while its metadata
or upload is still pending, then let it finish. `useSounds.pick` closes over the
earlier pieces/selection. The late complete section can replace the intervening
edit. Similarly, start an upload from the full editor, close it, edit elsewhere,
and let the upload finish: the snapshot captured at upload start no longer
describes only the upload's undo operation.

Suggested fix: capture an explicit operation target and merge against current
run state on completion, with cancellation/version checks and action-level
history. Cross-run upload corruption is guarded now; general async command
rebasing is a larger change that needs dedicated delayed-response browser tests.

### Medium: one local server does not mean one writer everywhere

Repro: start two independent Next processes against the same `.data/db.json` and
edit through both. Their in-memory queues are independent; the shared `.tmp`
name/read-modify-write operation has no cross-process lock. Two browser tabs can
also overwrite each other's complete run sections.

Suggested fix: keep one server per data directory for this prototype. Add file
locking and optimistic revisions before supporting multiple writers. The
isolated same-process mixed POST/PATCH concurrency test passed; it does not prove
cross-process safety. A storage protocol migration is outside this bounded fix.

### Medium: the local API is unauthenticated and the running server binds all interfaces

Repro: inspect `ss -ltnp`: the founder's server listens on `*:3100`. Any client
that can reach that port can use the unauthenticated run/media routes; environment
curator mode is a machine flag, not client authentication.

Suggested fix: run local development with `next dev --hostname 127.0.0.1 -p 3100`
and use equivalent loopback binding for `next start`. Network reachability depends
on WSL/Windows firewall/forwarding, which was not assumed. I did not restart or
reconfigure the founder's server, and did not add the expressly deferred auth
system. Origin checks alone would not secure direct network clients.

### Low: some boundary and accessibility policies remain inconsistent

Repros: move a text spanning several clips while reordering only one clip; close
a gap containing a text; trim a sub-0.3 s piece; start a timeline drag then close
its dialog before pointerup; navigate the new trim handles by keyboard.

Cross-clip text stays at absolute time on reorder, gap closure can collapse then
expand a text to the 0.3 s minimum, several handles still lack keyboard editing,
and many window drag listeners lack pointer-cancel/unmount cleanup. The focused
piece fixes do not settle all those cases. Suggested fix: define ownership of
cross-clip/gap text, then centralize cancellable drag handling and keyboard
equivalents. Broad drag/UI work is riskier than the focused fixes in this pass.

### Low: undo histories are still editor sessions

Repro: Cut in a step and close the step; reopen it. Its local undo is gone. Full
editor history also resets when closed. Stale cross-editor undo is fixed, but no
durable unified history is introduced. Step-5 volume ticks still create separate
local undo snapshots, although saves are coalesced; full-editor gestures now group.

Recommendation: keep session history for this prototype, document that contract,
and group step-5 gestures before considering durable history. A single shared
command history would be a larger model change.

### Low: external downloads and analysis still need cancellation hardening

Repro: stall Deezer's track/preview response, or load a malformed video that
never emits the event awaited by `analyzeVideo`. Those paths do not consistently
bound wait time, download bytes, or clean up on every failure. Song download URLs
come from Deezer, not an arbitrary request URL, so this is not an unrestricted
user-supplied fetch endpoint.

Suggested fix: a bounded reader/deadline for preview downloads and timeout/finally
cleanup for analysis. These require controlled network/media failure tests; no
external media calls or new sources were added for this review.

### Low: remaining dormant code and product stubs

The `LATER_STEPS` false branch and its old helper components remain embedded in
`run-view.tsx`, as do unused compatibility helpers such as `buildProject`.
Removing those together with old types is a separate mechanical cleanup; this
pass removed only two standalone modules with no importers. The main component
is still large and expensive sections are not virtualized. Frame resource caps
do not cancel every queued off-screen frame request.

Export remains an explicit toast and generation remains a sample on explicit
click. No AI-on-load, external downloader, scraping, hosting, auth, or paid service
was added. The selected sound's existing Loops label remains; repeat markers
still need a product decision. The previous My files legacy-field bug is replaced
by the newer complete-demo operation; its text contract is the separate finding
above. No old demo placeholder remains in the timeline.

## 4. Performance

### Frame resources and failed files

Compared frame code from `a21d514` with the new module using the same deterministic
mock media events, 280 frame times, 16 additional files, and two frame requests
for one missing file. These are resource/lifecycle measurements, not a real-media
decode or FPS benchmark:

| Metric at completion | Before | After |
| --- | ---: | ---: |
| Cached frame promises | 298 | 255, capped at 256 |
| Retained video players | 18 | 8 |
| Retained source queue entries | 18 | 0 |
| Time for two missing-file frame requests | 8,000 ms | under 1 ms after the error |

The old mock also emitted an excessive-error-listener warning; the new regression
asserts all frame listeners are removed after completion. Decoding concurrency is
limited to four. A real Chrome full-editor check rendered 16 frame-strip images
without an application error. The deterministic comparison script was local at
`/tmp/mavya-review16-perf.cjs`; the maintained regressions are in
`scripts/review-checks.cjs`.

### Larger saves

In production Chrome, a valid 100,506-byte edit sent with the original
`keepalive: true` failed with `TypeError: Failed to fetch`. The same edit through
the revised UI used `keepalive: false`, returned 200, and retained all ten text
layers after reading the API. This measures correctness at the transport limit,
not a claim of a latency improvement. Unit coverage also checks UTF-8 byte size.

### Existing payloads

At review start the founder's database had **one run**, and `/api/runs` returned
**1,328 bytes**. There was no measured need for a new runs projection; history
needs the complete sections, and a summary endpoint at this size would add work
without a demonstrated benefit. With eight temporary concurrency runs plus the
review fixture in the isolated snapshot, full runs were 5,804 bytes with a warm
median of 1.39 ms over ten measured requests. Studio references remained 282,768
bytes, warm production median 3.64 ms. These sizes vary with saved content; no
large-library scalability claim is made.

The existing coalesced save path was retained. During the Chrome brightness
gesture test, 21 values yielded an undoable final value of 20; one Undo restored
0 and Redo restored 20. No broad React component rewrite or new 60 fps performance
claim was made in this review.

## 5. Checks

Final required commands, run from `/home/farhan/mavya-video` with Node 20.20.0:

```text
$ npx tsc --noEmit
[no output, exit 0]

$ npx eslint src
[no output, exit 0]

$ node scripts/review-checks.cjs
PASS: sound migration, piece/gap timing, malformed sections, storage recovery/concurrency, byte ranges, coalesced saves, bounded filmstrip cleanup
[exit 0]
```

Extended regressions cover piece extraction and attached texts, ripple and held
gapped deletion, short retained texts, deleted-frame text removal, singleton
piece identity, invalid/colliding IDs, local uploaded-video paths, legacy face
bounds, analysis validation, shared-media retention, UTF-8 save quotas, bounded
frame resources, same-frame seeks, failed-file queues, and listener cleanup.
Storage/media tests use temporary directories, not the founder's database.

Additional verification:

- `npm run build`: PASS on final source in an isolated temporary source/data
  snapshot. `next start -p 3104`: PASS. The live dev server's `.next` was not
  deleted or overwritten.
- Production API: eight concurrent new runs plus a PATCH to a different run
  returned eight 201s and a 200; all created IDs and pre-existing snapshot IDs
  remained. All eight temporary concurrency records were removed afterwards.
- Production malformed run PATCHes: 400; malformed upload envelope: 400. All
  founder/review-fixture sections checked passed the stricter run validator.
- Chrome: frame strips; brightness undo/redo; history audio ownership; exact gap
  scrubbing/black video; magnet-off piece deletion and undo; extracting/reordering
  a piece with its text; cross-editor local-history invalidation; production
  large-edit persistence.
- Concrete piece movement: after closing gaps and extracting the second piece
  to the end, `b-text` saved at 5..6 and the next clip's text at 3..5. With magnet
  off, deleting the first piece retained the next clip's offset by increasing
  its gap from 2 to 3; Undo restored both the deleted text and two pieces.
- Concrete cross-editor check: step-3 Cut created local undo; deleting that piece
  in the full editor left the saved hook at file seconds 1..2, and the obsolete
  step undo was no longer offered on return.
- The initial history playback check started real audio. At the founder's study
  request, that test browser was immediately closed. Subsequent Chrome sessions
  used `--mute-audio`; further audio verification inspected playback state only.
- No founder run was deleted. Only this review's explicitly tracked API-created
  run and isolated concurrency runs were cleanup targets. The original dashboard
  had one run; yesterday's list of 14 possible leftovers is no longer current.
  Cleanup returned the live dashboard to that one run. Its content fields match
  the starting snapshot; only `updatedAt` advanced during the review. That
  metadata change was not reverted.
- `git diff --check`: PASS. No new source/comment lines contain an em or en dash.
  `.data` and `.env*` remain untracked/ignored; no remote added and no push made.

Routing used the supplied project context, target AGENTS.md, both prior review
documents, installed Next route-handler guidance, and Ruflo namespace `mavya`.
Selected review, testing, API safety, and memory categories. No applicable
installed specialist skill or external skill installation was needed. No agents
were delegated. Ruflo holds the handoff to this report.
