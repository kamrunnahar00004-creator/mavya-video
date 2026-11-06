# Seamless cuts review — 2026-11-06

**Verdict: not seamless under the requested acceptance criteria. Do not ship this fix as written.** It removes the measured held frames in this export by displaying frames the user trimmed out. It also admits trimmed-out audio. The supplied fixed file is continuous and has no measured black or held frames, but that does not make its edits correct. The HELD FRAME check is useful for its fixtures, not a sound universal assertion.

Review only. No implementation changes, commits, pushes, production writes, or deployment. Production access was a Supabase REST GET for the specified export job and an R2 GetObject for its MP4. Credentials were not changed. The fixed Chrome file was inspected from the supplied Windows temporary directory; I did not independently rerender it in Chrome.

## Findings

| Priority | Finding and location | Measured evidence | Smallest correction |
| --- | --- | --- | --- |
| Blocker | Video crosses the user's trim boundary. `render/render.mjs:172–175,207`; `src/lib/browser-export.ts:441–445`. | Using the actual local source packet timestamps and the new schedule, output frames 141, 228, 393, 394 select source times 4.500, 7.600, 4.966667, 5.000 seconds, respectively. Saved ends are 4.497, 7.582, 4.962, 4.962. These are 3, 18, 4.667, 38 ms beyond the cuts. | Restore the original exclusive video end as a hard constraint; fix frame sampling within that interval rather than supplying removed frames. See correction proposal below. |
| Blocker | Audio crosses the same trim boundary. `render/render.mjs:227`; `src/lib/browser-export.ts:319–322`. | A source silent before end=0.251 s, DC amplitude 0.125 only afterward, speed=1.15, volume=1, produces audible-region samples in both implementations. Planned output is 11,200 samples. First sample above 0.001 occurs at 200.875 ms server / 227 ms browser; last 5 ms RMS is 0.124937 / 0.118280. Every nonzero sample came from removed content. | Keep audio input bounded by the original end too. Retiming must target the planned sample count using retained content. Reading ahead for a time-stretch algorithm is not permission to mix that content into the output. |
| Medium | HELD FRAME assumption has false failures and coverage holes. `scripts/frame-schedule-checks.cjs:75–78`. | A regular 30000/1001 source, speed=1, 25-second output repeats its source frame at output 500, naturally. The predicate labels this a failure if exercised with sufficient remaining source. A VFR timeline with a 0.366667→0.600000 timestamp gap repeats at outputs 12–17 despite later 60 fps frames. An average/nominal rate cannot forbid those repeats. The current suite uses short cuts and does not encounter either. | Separate end-padding holds from normal frame-rate conversion; use actual PTS and bounded expected selections. Add trim-boundary, long 29.97, sparse VFR, cumulative multi-piece, EOF, black/no-frame, and audio cases. |
| Medium | Audio joins are hard cuts; browser speed processing inserts a short zero prefix. `tempo`, `mixSound`; server piece concat. | Actual browser `tempo` on constant nonzero input starts with 21 zero samples (0.4375 ms at 48 kHz), due to the Hann normalization threshold. Preceding constant sample 0.125→next piece's first sample 0 is a 0.125 step. Sine tests also show a 0.4375 ms browser prefix. No join fade or phase matching exists. | Avoid introducing the WSOLA zero prefix; preserve continuity across adjacent pieces when possible. For unrelated sounds, an optional very short boundary ramp can suppress clicks but changes the waveform and needs its own acceptance criteria. Do not claim click-free sound from a silence test alone. |
| Limitation | Reading extra frames does not guarantee no hold at real EOF. `frameSchedule.stop`, server `tpad`. | 30 fps source PTS 0…4.966667, piece 2.375–5.000, speed=1.15: plan=68 frames, final two selections both 4.966667. There are sufficient distinct retained source frames; the double-fps/truncated end still creates a hold. | Correct sampling/end accounting inside the retained interval; extra reads cannot fix real EOF. |

Frame numbers throughout are zero-based. A cut at 142 means frame 141 is the outgoing clip's last frame. 456 is the end of the file, not another clip-to-clip join.

## Reproduced before/after measurements

Production job `70ae9862-b1d9-4932-829a-2b9fdaf684b6` is done, lane `browser`, encoder metadata `hw-qp20`. Downloaded `media/cfcd45ca-dfdc-4834-8b0c-56c3f67c6fa2.mp4`: 42,484,628 bytes. The persisted spec and the local fixed-job spec have the seven cuts described in the request.

I decoded both files with the repository's `ffmpeg-static`. Full-resolution `signalstats` supplies mean Y; `tblend=all_mode=difference,signalstats` supplies mean absolute adjacent-frame Y difference. These measurements are on decoded pictures, not compressed packet equality.

| Measurement | Production before | Supplied `gaps_fixed.mp4` |
| --- | --- | --- |
| Decoded frames | 456 | 456 |
| Minimum full-frame mean Y | 91.0409 | 96.9362 |
| Minimum adjacent-frame mean absolute Y difference | 0.0244131 | 0.857092 |
| Adjacent differences below 0.5 | 141: 0.118753; 228: 0.113172; 393: 0.105817; 394: 0.0244131 | None |
| Silence lasting ≥5 ms, threshold abs(sample) ≤0.001, decoded mono at 48 kHz | Start only: 9.333 ms | Start only: 9.333 ms |
| Hook/demo key frame | 1.833333333 s (frame 55) | Same |

Packet inspection found contiguous 1/30-second presentation intervals in both files; the maximum absolute difference between a packet end and its successor start was 1.66e-15 seconds (floating-point error). This reproduces the claimed four held output frames before the change and their absence afterward. No full black frame was found. A separate 270×480 luma analysis showed a single large transition at each of the six internal cuts:

| Cut | Before: previous difference / cut / following difference | Fixed: previous / cut / following |
| --- | --- | --- |
| 55 | 4.642 / 61.850 / 25.386 | 5.027 / 59.591 / 26.371 |
| 142 | 0.059 / 74.367 / 5.392 | 4.761 / 69.579 / 5.560 |
| 229 | 0.053 / 65.805 / 3.663 | 3.160 / 65.293 / 4.033 |
| 275 | 2.934 / 73.778 / 2.322 | 3.184 / 72.850 / 2.344 |
| 327 | 10.599 / 76.690 / 1.903 | 10.698 / 75.515 / 1.926 |
| 395 | 0.012 / 90.070 / 9.811 | 3.530 / 88.268 / 10.057 |

The silence measurement excludes neither sub-5-ms dips nor clicks. I did not independently reproduce the claimed 17 ms at the beginning of the original music file; the export starts that music at source time 0.6 s, so the file's initial silence alone would not establish the cause of the export's initial 9.333 ms.

`node scripts/frame-schedule-checks.cjs`: **396/396 match**, exit 0. Running a temporary copy of that same check against `git show HEAD:render/render.mjs`, falling back to `step.end` for the old plan, reproduces **79/396 HELD FRAME failures**, exit 1. Browser/server equality passes in both versions; equality alone does not prove correct trim semantics.

`npx tsc --noEmit -p .`: **passes**, exit 0, no diagnostics. I did not change or use lint to gate this review.

## Direct proof that the removed video is rendered

This is not only a theoretical packet-selection issue. I generated a lossless 30 fps gray ramp (`nullsrc=s=32x32:r=30:d=5,geq=lum='16+N':cb=128:cr=128`), then ran the current `stepArgs` on start=0, end=0.251, speed=1.15. Plan allocates seven frames. The rendered source lumas are:

```text
17, 18, 19, 20, 21, 22, 24
```

Luma 24 is source frame 8, timestamp 0.266667 s, outside the retained interval. Frame 0 is also skipped by the existing integer-tick speed conversion. Both facts are consistent with `frameSchedule` and the parity suite. No black gap is needed for an export to be wrong.

For the production spec, I used `mediaOrigin`, `frameTimes`, and `frameSchedule` with actual mediabunny packet metadata from the local source copies listed in `jobs.json`. The four offending selections are the ones in the findings table. These are schedule measurements backed by the real server ramp render; they are not pixel-fingerprint identification of individual compressed frames in the supplied Chrome file.

Preview/export comparison: `edit.ts` computes `(end-start)/speed` with a 0.05-second minimum per editable piece. `fileAt` clamps file time to `p.end`; `run-preview.tsx` advances to the next piece at that end. Export rounds cumulative boundaries to 30 fps, which is appropriate for a fixed-frame timeline. That rounding does not authorize showing later source content. Increasing readEnd is especially wrong at a Cut followed by a removed section or another independently adjusted piece: removed content can reappear, or following content can play before the cut and again after it.

## Sound with speed and volume enabled

I rendered a five-second 1 kHz sine source at 48 kHz with volume=1 through real server `stepArgs`, and evaluated the repository's actual `tempo` function, extracted and transpiled without changing it, on equivalent browser float arrays. This tests the browser mixer input/retiming path, not a new Chrome AAC export.

| Piece / speed | Planned samples | Server samples / trailing silence | Browser samples used / trailing silence |
| --- | --- | --- | --- |
| 0.213–1.377 / 1.15 | 48,000 | 48,000 / 0 ms | 48,000 / 0 ms |
| 0–1 / 1.15 | 41,600 | 41,600 / 0 ms | 41,600 / 0 ms |
| 4–5, real source EOF / 1.15 | 41,600 | 41,600 / 0 ms | 41,600 / 0 ms |
| 0–0.05 / 2 | 1,600 | 1,600 / 0 ms | 1,600 / 0 ms |

Threshold is 0.001; last-5-ms RMS is approximately 0.0883 in both lanes. The extra audio fills these tested planned lengths. It is not universally a safe fill, as the silence-before-cut/DC-after-cut sentinel proves. Server and browser use different stretch algorithms and need not have identical waveforms.

There is no scheduled overlap between neighboring pieces: browser adds each into its cumulative frame-derived sample span; server concatenates PCM intermediate pieces. Global music intentionally overlaps clip sound. No boundary smoothing exists for unrelated audio. Therefore absence of a measured silent tail does not prove absence of clicks, and the existing code creates a measurable discontinuity even for constant browser audio split into sped-up pieces.

## Requested edge-case audit

| Case | Result |
| --- | --- |
| `seg.gap` | Explicit black/silent material, not an accidental encoder gap. `edit.ts:248` preserves space on delete with hold; `run-view.tsx:519,730` can preserve/create space on trim/move. Magnet-on closes gaps (`run-view.tsx:746`; editor-tools toggle). `plan` deliberately renders any positive frame-quantized gap in both lanes. A universal no-black promise requires gap=0 and suitable source content. |
| Sub-frame pieces / `count <= 0` | Cumulative rounding avoids inserting a blank frame. A piece may disappear. Four 0.05-second pieces at speed=4 allocate 0,1,0,1 frames, with only pieces 1 and 3 in the plan. This is quantization, not a time hole; the 0.05-second minimum can itself extend genuinely shorter saved pieces. The suite does not test this cumulative case. |
| Cut pieces of the same clip | Same plan and readahead problem as separate clips. No automatic blank transition, but readahead may expose a deleted interval or duplicate content across an adjacent split. Audio stretching restarts per piece. |
| `schedule.source === -1` | All-black browser piece when no retained frame exists. Direct call with PTS [0,0.1], start=0.11, end=0.12, frames=1 returns [-1]. Readahead may hide this by selecting a removed later frame instead. Server's tpad cannot clone a nonexistent frame; fail/validate empty retained intervals explicitly rather than promising seamless output. |
| First decodable frame later than start | Both lanes reset picture time to the first kept frame, avoiding a black lead when one exists, but advancing source content relative to the requested start/audio. The existing offset-picture fixture tests parity, not preservation of the intended source interval. Empty intervals remain the case above. |
| VFR iPhone | Synthetic VFR parity passes. No independent new iPhone-device export was performed. Real PTS gaps can require repeated frames; nominal rate and the passing synthetic fixture do not prove all iPhone files seamless. |
| 60 fps | Existing fixtures pass for all tested speeds. The intermediate 30 fps conversion discards source frames before acceleration, so it does not preserve all useful 60 fps motion information. Trim leakage is still possible. |
| Speed below 1 | Suite passes, but repetition is expected when slowing 30 fps material into 30 fps output. The no-repeat predicate intentionally skips this; it cannot justify “no frozen frame” literally at all speeds. |
| End at file EOF | Extra reads cannot supply unavailable frames. The 68-frame counterexample above still holds its final frame. Test predicate exempts EOF with its end+0.2 guard. Audio sine EOF examples pass, not a proof for every short/irregular source. |
| Hook→demo | Actual files have a normal hard cut at frame 55, not a black/held intermediary. `demoAt` uses the cumulative planned boundary, so fractional hook duration does not independently open a gap. |
| `demoAt` / demo copy-out | Both actual MP4s have a key packet exactly at 55/30. `cutDemo` requests/verifies that boundary and rebases copied packet times; server forces the key frame in its final reencode. This does not insert frames in the main export. An explicit gap after the hook is intentionally part of the demo start. A skipped sub-frame hook can make `demoAt` return null, a missing-demo artifact issue rather than an inserted gap. I inspected key packets, not a fresh server deployment or independent saved demo download. |

## Proposed correction and acceptance checks

The smallest immediate containment is to restore hard exclusive `end` limits for both picture and sound in both lanes. That restores the original hold defect, so it is a containment, not the completed seamless-cuts fix.

The narrow substantive correction is to replace the integer-30-fps-tick speed/end selection with a shared bounded resampling rule that maps each piece's planned output count to source frames strictly inside `[start,end)`. Do not solve a timing shortage by extending the edit. With K retained CFR frames and N output frames, choosing retained index `floor(n*K/N)` for n=0…N−1 is one concrete bounded rule that produces N distinct frames when K≥N; any adopted rule must also preserve the intended VFR timing and be implemented equivalently on the server. A high-resolution timebase before speed conversion avoids the present integer tick truncation, but by itself needs rounding/EOF verification. No claim that this is a tested drop-in patch.

For audio, keep original trim bounds and make the stretch output match the planned sample count from retained content; avoid artificial zero prefixes. If output count rounding requires tiny duration adjustment, handle it explicitly within that content rather than using later sound. At true source scarcity, slow motion, or a source with a timestamp gap, repetition/interpolation is a separate product choice; literal no-repeat guarantees are impossible for all sources without generating new pictures.

Required regression assertions: no selected source timestamp at/after end, sentinel audio after end never appears, no extra timeline hole, exact cumulative frame/sample counts, no avoidable end padding when retained distinct frames suffice, and server/browser parity. Include the production cuts, the seven-frame ramp counterexample, the silence/DC sentinel, the 68-frame EOF example, long 29.97, sparse VFR, and adjacent split pieces. Verify clip sound with volume>0, not just background music.

At 30 fps one picture lasts 33.333 ms; at 48 kHz one sound sample lasts 20.833 µs. The measurable contract should be contiguous presentation intervals and correct retained content, not a claim about an arbitrary 0.00001-second visual event. The current artifact satisfies the first condition for the inspected video and violates the second.

## Reproduction notes

Temporary audit scripts/results are under `/tmp/seamless-*`; source files and supplied harness artifacts were not edited. Key commands:

```sh
node scripts/frame-schedule-checks.cjs
npx tsc --noEmit -p .
node /tmp/seamless-before-check.cjs
node /tmp/seamless-full.cjs
node /tmp/seamless-metrics.cjs
node /tmp/seamless-actual.cjs
node /tmp/seamless-extra2.cjs
node /tmp/seamless-leak-audio.cjs
node /tmp/seamless-keys.cjs
```

The before-check script imports a temporary copy of HEAD's renderer while keeping the current comparison and HELD FRAME assertion. Synthetic server fixtures use 32×32 lossless gray ramps, PCM audio, and the exact current `stepArgs`. Full-resolution measurements use `signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`, with `tblend=all_mode=difference` prepended for adjacent-frame differences. The production download and job JSON remain local temporary files; signed URLs and credentials are intentionally omitted from this report.

## Round 2 — bounded frame spreading and revised audio

**Verdict: the founder's supplied export passes the measured picture checks, and the Round 1 read-ahead blockers are resolved. The general seamless-cuts fix still fails acceptance: do not ship it as a universal seamless export fix yet.** I reproduced a browser/server VFR mismatch, silent server audio tails on valid short clips, and new discontinuities at the browser's audio fallback boundaries. These are separate from the inevitable repetitions in genuine low-frame-rate/slow-motion material.

This round reviews the new working-tree diff only. No source implementation changes, commits, pushes, production requests, or deployment. All additional fixtures and diagnostic scripts were written under `/tmp`; the Round 1 report above is preserved.

### Findings and smallest fixes

| Priority | Finding / location | Evidence from this round | Smallest corrective action |
| --- | --- | --- | --- |
| Blocker | Browser slot duration inference is not equivalent to `countArgs` for general VFR EOF. `render/frames.mjs:25–30`. | A 30 fps, two-second ramp retaining frames 0–28 and 59, with B-frames, cut 0.5–2 s, produces **45 server slots versus 75 browser slots**. Of 45 exported frames, **28 select different source pictures**. At output 27, server luma=44 while browser selects luma=75. | Carry actual packet/frame durations and the effective stream/filter EOF into browser first-pass scheduling; do not infer the final frame duration from the previous PTS gap. Match ffmpeg's EOF rounding as well as its interior frame selection. Add this fixture to the parity suite. |
| Blocker | The 25 ms server margin does not ensure full audio, even inside supported speed limits. `render/render.mjs:205–213,254`. | A 997 Hz sine, cut **0–0.050 s**, volume=1, speed=0.5, plans 4,800 samples / 100 ms. Real `stepArgs` returns that length but its final **15.8958 ms are silence** added by `apad`. A 0–0.060 cut at 0.5× ends with **11.1667 ms** of silence. | Add short-input handling and verify actual stretched sample coverage before padding. A fixed extra duration is not an exact fill algorithm. For sub-50-ms pieces, also use the actual retained duration rather than `max(0.05, end-start)` to calculate input speed. |
| High | Browser's edge fallback removes zero padding by abruptly switching sample positions. `src/lib/browser-export.ts:224`. | On a smooth amplitude-0.125, 997 Hz sine at 48 kHz, 0.5×, the 96,000-sample output jumps **0.0963478** at sample 95,104: −0.0162671→0.0800807. Normalization changes from 0.961351 to zero at this point, and the fallback switches to a different tail position. Another fallback jump is **0.0350453** at sample 95,616. The input's largest possible adjacent-sample change is only about 0.0163. | Preserve a continuous synthesis phase/window at the edge or blend into a matched retained tail; do not abruptly splice raw end samples onto an unrelated WSOLA phase. Add a boundary-discontinuity test, not only a silence test. These measurements establish click-producing steps, not a subjective listening assessment. |
| Medium | Count failure handling is not fail-fast. `countFrames`, `stepArgs:245`, both new callers. | A piece wholly after the source EOF counts **0**; neither caller rejects it, and `Math.max(1, slots ?? step.frames)` silently substitutes a denominator. The parser also counts `"garbage\n"` as one frame. Browser returns all `source=-1` for an empty retained interval and draws black. Server may instead fail later when an intermediate has no video. | Require a positive integer count for every emitted piece, validate framecrc records, and reject empty/malformed counts before encoding. Remove the silent default for piece callers that require a count. Reject empty browser schedules rather than inventing a black piece. |
| Medium | HELD FRAME remains an invalid general source-frame assertion. `scripts/frame-schedule-checks.cjs`, `enough`/`held`. | A 25-second 30000/1001 source at speed=1 repeats at output 500, with the new `enough` condition true. The first 30 fps pass itself duplicates a source picture. Likewise, a sparse VFR source can have S≥N while distinct source frames are fewer than N. | Separate repeated *slots* caused by resampling from repeated *source pictures* caused by the first fps pass. Base avoidable-hold checks on actual distinct retained frames and timing. S≥N is insufficient for the stronger source-frame assertion. |

The VFR counterexample is a deliberately sparse but valid file, not a claim that the founder's actual clips have this problem. It exposes an existing duration approximation now used to spread the entire piece. It also affects look timing, because the browser and server disagree about which slot is shown.

### Reproduced successful checks

- The expanded suite reports **547/547**, including its two server sentinel tests and seven total sound cases. It covers its synthetic 29.97, VFR, B-frame, offset-picture, and AAC fixtures; it does not cover the new counterexamples above.
- `npx tsc --noEmit -p .`: **passes**. ESLint on `render/frames.mjs`, `render/render.mjs`, `render/server.mjs`, `src/lib/browser-export.ts`, and `src/lib/server/fast-export.ts`: **passes**. The CommonJS test script was not included in that lint invocation.
- Reran Claude's `past.mjs`: **zero past-end frames and zero repeated source selections in all seven actual source pieces**. Server count versus independently exposed browser slot count is **56/56, 100/100, 95/95, 46/46, 53/53, 77/77, 62/62**. This directly checks the count rather than relying only on output parity.
- Recreated an SDR working copy from the local 4K HLG original using the repository's HDR master command. Three trims, including one beyond file EOF, give server/browser slot counts **8/8, 35/35, 33/33**. Tone mapping and crop/scale do not themselves change slot timing in these tested copies. This is not an exhaustive HDR/iPhone qualification.
- The browser DC test at speed=1.15 now starts and ends at 0.125, with **no artificial 21-zero-sample prefix**. That part of the fallback fixes the Round 1 defect. Silence input remains silent because the browser only processes the retained subarray.

Environment detail: the literal suite invocation initially threw `spawnSync ... EPERM` even though synchronous child processes returned exit status 0 and valid output (also reproducible with `ffmpeg -version`). A temporary `/tmp/round2-node-spawn.cjs` compatibility wrapper accepts only this specific EPERM-with-status-0 result; nonzero/null statuses remain failures. With that wrapper, the unchanged suite completes all 547 cases. Independent ffmpeg invocations through Python succeed normally. This is an execution-environment caveat, not a claim that the unmodified command completed successfully here.

### The supplied Chrome artifact

Inspected `/mnt/c/Users/farha/AppData/Local/Temp/mavya-enc/spread_fixed.mp4`; no new Chrome export was run. Full-resolution decoding gives:

| Measurement | Round 2 result |
| --- | --- |
| Frames | **456** |
| Minimum mean Y | **96.9371** |
| Minimum adjacent-frame mean absolute Y change | **0.857092** |
| Adjacent changes below 0.5 | **None** |
| Silent runs ≥5 ms, abs(sample) ≤0.001, decoded mono 48 kHz | **Only initial 9.333 ms** |
| Hook/demo boundary | **Key packet at 55/30 = 1.833333333 s** |
| Maximum discrepancy between adjacent packet end/start | **1.66e-15 s**, floating-point noise |

All six joins show one large adjacent-picture transition. At 270×480, the cut differences are 57.990, 68.864, 65.360, 72.850, 75.726, and 88.745. There is no measured inserted black frame, frozen output frame, or video presentation gap in this artifact. As in Round 1, background music masks most clip-sound issues: the export's silence result cannot qualify sped-up/slowed clip audio generally.

The first and last source timestamps now selected in the seven pieces are 0–1.800, 1.166667–4.433333, 4.433333–7.533333, 0–1.500, 0–1.700, 2.400–4.900, and 0–2.000 seconds. These stay inside the saved trims. The previous four past-end selections are gone.

### Counting cost, budgets, and safety

The new count is a real extra decode pass, with full-resolution raw-frame checksums. It does not scale before checksum generation, and cannot seek directly to a late trim: it decodes from the beginning through the needed end. Repeated Cut pieces repeat this work. The count and render processes are sequential, so their peak resident memories should not be added as if both processes were running together.

On this local machine, the seven production count passes took **0.296, 1.137, 2.110, 0.433, 0.565, 1.109, 0.646 seconds**: **6.30 seconds total**, excluding rendering. Peak ffmpeg RSS was **37–62 MB**. Separate early-trim counts on original 4K H.264 and 4K 10-bit HLG sources peaked at **152 MB and 325 MB**, respectively. A late trim 17–18 s in the local 18-second 4K H.264 source took **12.85 seconds**, peak **216 MB**, just to count a one-second piece.

These measured count processes are below 512 MB, but that is not a production 512 MB worker qualification: the Node process, runtime, and other allocations also occupy memory, and deployment CPU speed differs. I found no newly concurrent count/render process on Render. The new per-count 120-second kill limit and existing 15-minute job limit still apply. A source may be up to an hour long, so late trims can spend substantial time decoding discarded input.

Vercel keeps its **170-second piece-phase deadline**, with up to twelve piece functions, and its overall 285-second coordinator allowance. Counting consumes that same piece budget. `renderStep` does not recheck `left() <= 0` immediately after counting; it can launch rendering with the minimum 1-second timeout even after expiry. The post-render deadline guard prevents uploading that expired result, so this is wasted work/timeout handling rather than evidence of a corrupted published file. Add a deadline check between passes. Existing Render fallback remains useful but does not make the fast-lane cost disappear.

Smallest cost reduction to evaluate: count timing at a tiny pixel size, or count discarded encoded packets/progress rather than calculate full-resolution CRCs; neither should change the trim/fps timing sequence. Verify this against the new VFR and HDR fixtures before adopting it. Reusing counts per identical source/trim/fps would also avoid redundant decodes. No benchmark here establishes that all accepted source sizes/piece counts fit deployed budgets.

### Slot mapping, look timing, slow motion, and EOF

The bounded spreading rule itself is sound **when both lanes agree on the first-pass slot stream**. `ceil(j*N/S)` followed by fps selection gives slot `floor(n*S/N)`, and no kept source frame outside the trim needs to be admitted. Source frames after `end` may still be decoded as lookahead/metadata, but are not selected by this revised rule. That distinction is important for B-frame decoding.

`look()` and `zoompan` run before the server remapping, so their time is still the first-pass slot time. Browser `files[k] = start + schedule.slot[k]/fps` matches that design. I tested an animated zoom/pan on a spatial test pattern with S=30 and N=26: **all 26 mapped output luma pictures match the corresponding lossless reference slot exactly**. For matching slot counts, this change does not accidentally evaluate looks using output n instead of source slot j. It retains the existing approximation of anchoring at saved start rather than at the first decodable source PTS. The VFR count mismatch must be fixed before extending this conclusion to all sources.

Slow motion necessarily reuses frames when N>S; the new rule distributes them rather than appending all missing pictures at the end. It can still repeat the final frame. For example S=30, N=60 gives slots 29,29 at the end. That is expected 0.5× frame duplication, not evidence that the old accelerated-tail bug remains. At genuine EOF the retained content is spread across the planned length; malformed trims extending substantially beyond EOF can therefore stretch scant material across an arbitrarily long piece. Validating trim bounds/empty counts is preferable to pretending the file contains more content.

The Round 1 concerns about intentional `seg.gap`, skipped sub-frame pieces, no decodable source picture, and arbitrary source black/static content remain. Neither spreading nor counting can guarantee no black/static frame for every source. The hook/demo keyframe logic is unchanged and the actual boundary remains correct.

### The 25 ms margin and a better exact contract

The fixed margin is a heuristic, not an exact method or an accepted universal 25 ms error bound. Even nominal speed=1 pieces now undergo time stretching. For D=1 s and planned L=1 s, the requested tempo is about 0.97561 instead of 1: the algorithm is asked to produce 1.025 seconds, then content at its tail is discarded. At other speeds, the corresponding source-time discrepancy can exceed 25 ms. The short-sine failures above independently disprove full coverage.

`fillSpeed` also substitutes 50 ms for genuinely shorter retained sound. The current job validator accepts 10 ms pieces. For 0–0.010 s at speed=1, the plan allocates 3,200 samples and the real server output is **entirely silent**, despite non-silent retained sine samples. Browser uses the actual 480 input samples to target those 3,200 output samples, so this is another lane divergence. Correcting the duration numerator alone is necessary but not sufficient: very short inputs can be shorter than the stretch algorithm's analysis windows.

A correct contract needs an exact target sample count, a bounded retained input, short-input handling, and continuity at synthesis boundaries. Either use a duration-targeted offline stretch implementation with explicit start/end treatment in both lanes, or validate the generated samples and apply a deliberate, continuous retained-content extension when the stretch algorithm underproduces. `apad` achieves a count, not sound coverage; increasing the global constant merely trades more drift for a still-unproved bound. Preserve the speed=1 path when actual input and target counts already agree.

I also tried the installed ffmpeg `rubberband` filter at the exact input/target ratio as a possible alternative. It returned exact counts for tested 1-second-class inputs, but only **3,459/4,800** and **4,032/6,400** samples on the 50/60 ms examples. It is not a verified drop-in solution to the short-input issue either. Do not replace one unproved padding heuristic with another.

### Reproduction and remaining gate

New local diagnostics are `/tmp/round2-vfr.cjs`, `/tmp/round2-audio.cjs`, `/tmp/round2-edge.cjs`, `/tmp/round2-count-equality.cjs`, `/tmp/round2-look.cjs`, `/tmp/round2-bench.py`, `/tmp/round2-large.py`, `/tmp/round2-late.py`, and the corresponding logs. JavaScript ffmpeg tests use the environment compatibility wrapper described above. Measurements of browser `tempo` use the actual extracted/transpiled function; the edge diagnostic additionally records its normalization values without changing repository code.

The VFR fixture is generated with a 30 fps, two-second lossless gray ramp followed by `select='lt(n,29)+eq(n,59)'`, `-fps_mode vfr`, and H.264 B-frames. The short-audio fixture is a five-second 997 Hz sine at 48 kHz, PCM audio, and a 32×32 video, passed through the real current `stepArgs`. The edge diagnostic uses `0.125*sin(2*pi*997*i/48000)` for 48,000 retained input samples at 0.5×.

Before calling this complete: make those counterexamples pass, add explicit count/EOF failure checks, preserve the successful production trim/schedule tests, and rerun with clip sound enabled. The good founder artifact is evidence for this job; the remaining counterexamples prevent a general seamless verdict.

## Round 3 — shared sound synthesis and packet durations

**Verdict: the measured Round 2 counterexamples are fixed, and all five supplied founder exports pass the picture/join checks. Do not yet ship across the full accepted input range on the 512 MB worker.** There are two remaining concrete defects: the new server sound implementation exceeds that memory budget on an accepted long piece, and its zero-frame fallback drops valid audio that the browser retains. Neither defect appears in the supplied founder exports.

Reviewed the complete current diff and all four new untracked sound implementation/type files. Only this report was edited in the repository. No commit, push, production access, or deployment; supplied exports were read locally. I did not regenerate the five full founder exports.

### Remaining findings

| Priority | Finding / location | Reproduction and measurement | Smallest correction |
| --- | --- | --- | --- |
| Blocker for the stated 512 MB worker | Full-buffer sound synthesis exceeds the worker's memory budget. `render/sound-file.mjs:8–15`, `render/sound.mjs:46–49,75–77`. | `fillSoundFile` on 360 seconds of stereo 48 kHz f32le, targeting 180 seconds, peaks at **559,380 KiB RSS**, repeated at **559,456 KiB**: approximately **546.3 MiB**, above a 512 MiB limit even in a minimal Node process. `validJob` accepts start=0, end=360, speed=2, total=180; `validProbe(32,32,360)` also passes. | Bound the Node audio working set. Avoid simultaneous full input buffer, deinterleaved channels, mono analysis, overlap-add outputs, normalization, returned channels, and reinterleaved output. A file-backed/sliding-window server adapter plus streamed output can retain the same synthesis rule. Until then, an explicit preflight limit can prevent OOM, but would restrict currently accepted jobs rather than complete support for them. |
| High | A zero-picture count unconditionally substitutes **silent** black, discarding valid retained clip audio and breaking lane parity. `render/render.mjs:238`. | On the existing 30 fps/997 Hz sine fixture, start=0.010, end=0.020, speed=1, volume=1: count=0, plan=2 frames/3,200 sound samples. `pieceSoundArgs` plus `fillSoundFile` produces sound with peak **0.0883478**, but real server `stepArgs` outputs peak **0**, all 3,200 samples silent. Browser `mixSound` does not suppress sound when `frameSchedule` is all −1, so it keeps that audio. | Preserve the independently prepared audio when rendering a zero-picture piece: use a black video source with the normal sound path, rather than recursing into the black-and-silent gap branch. Add this case to the suite. Decide separately how unrepresentable picture intervals should be handled. |

The memory test uses a nonzero constant raw stereo signal as the decoded input. It tests the real unmodified `fillSoundFile`, including file IO and synthesis, not an estimated sum of allocations. Input size is 138,240,000 bytes; the requested output has 8,640,000 samples per channel. A small compressed video/audio source can produce that decoded input, so the existing compressed-file-size limit does not prevent it. This is a demonstrated function-level peak on an accepted duration, not an observed production OOM. Production's existing Node process has additional baseline allocations.

The lower `process.memoryUsage().rss` printed after completion (about 469 MB) does **not** refute the peak: `/usr/bin/time` records the earlier maximum resident set. The two isolated runs took approximately 1.39 and 1.42 seconds locally. This particular problem is memory, not a measured time-budget failure.

### Round 2 counterexamples rerun

| Previous failure/check | Round 3 result |
| --- | --- |
| Sparse VFR cut 0.5–2 s | **Fixed.** Original `/tmp/round2-vfr.cjs` now reports server slots=45, browser maximum selected slot=44, and `diff: []`. The independently exposed browser total is 45, matching server count. |
| 40 short/ordinary server sine cases | **Fixed for the tested matrix.** Reran the same 10 lengths × 4 speeds, adapting only the harness to the new mandatory count and sound-file arguments. All 40 render successfully; no trailing-silence measurement exceeds 1 ms. Includes the former 50 ms/0.5×, 60 ms/0.5×, and 10 ms/1× failures. |
| Browser 0.5× tail splice at output 95,104 | **Fixed.** Same 48,000-sample, amplitude-0.125, 997 Hz input now has maximum output step **0.01630265**, versus the previous 0.09634785 discontinuity. At the two old splice positions, steps are **0.01417547** and **−0.00799152**. Longest ≤0.001 run is one sample, not a padded tail. |
| Browser DC zero prefix | **Fixed.** DC test starts and ends at 0.125, with zero sample steps and no silent run. |
| Actual source count equality | **Pass.** Seven counts remain 56, 100, 95, 46, 53, 77, 62 in both lanes. |
| HDR working-copy count equality | **Pass.** The three prior trims remain 8/8, 35/35, 33/33, including the EOF case. |
| Animated look/zoompan remapping | **Pass.** Reran the prior spatial-pattern test; all 26 output luma pictures match their mapped lossless reference slots exactly. |
| Missing/malformed count | **Improved.** Suite confirms missing count and `garbage` throw. Piece encoding no longer silently assumes a count. Empty valid count files intentionally take the zero-frame fallback. |

The old browser `tempo` export no longer exists, so the edge diagnostic was adapted to import actual `fillSound` and specify its output count; no old synthesis implementation was substituted. The old server audio harness was adapted to run `countArgs`, `pieceSoundArgs`, `fillSoundFile`, then current `stepArgs`. Re-running an obsolete caller without its newly required sound file would only test API misuse.

An additional **160 direct fillSound cases** (16 lengths × 5 speeds × sine/DC) pass exact length, finite-sample, no ≥5 ms artificial-silence-run, and bit-identical-copy checks when input and output lengths agree. This includes the 2,047/2,048-sample branch boundary. These checks do not assert pitch preservation for the explicitly resampling short-input path.

### Suite, TypeScript, lint, and implementation assessment

- Expanded suite: **601/601 pass**. The same environment-specific synchronous-child EPERM-with-success-status issue persists; the Round 2 compatibility wrapper was used again. It accepts only that error with status 0. Nonzero/null exits remain failures. The initial literal invocation failed on the environment issue; I am not reporting it as an unmodified-command success.
- `npx tsc --noEmit -p .`: **passes**, no diagnostics.
- ESLint on touched runtime app/render files, including `sound.mjs` and `sound-file.mjs`: **passes**. The CommonJS check script was not included.

The VFR fix preserves the association between sorted PTS and packet durations. For the terminal packet it now uses the packet's positive duration; without one, the old previous-gap fallback remains an approximation. When a successor PTS exists, the scheduler still uses that next gap, matching the tested trim/fps cases. The new sparse fixture exercises the actual terminal-duration bug rather than merely asserting a formula in isolation.

The shared sound code removes the atempo length heuristic and its 25 ms drift entirely. Input windows and search positions are bounded inside the retained channels. Every synthesized interior output sample now has window coverage, and the first-window low-weight fallback reads the matching source-start sample rather than splicing an unrelated tail. The direct counterexamples support those changes. Empty retained audio and intrinsically silent source content still produce silence by design; “never adds silence” cannot mean manufacturing sound where none exists.

`len === n` is a bit-preserving copy, which I checked. Nominal editor speed=1 does not always imply `len === n`, because cumulative frame rounding can change the target count; such pieces correctly still need a small adjustment. Inputs below 2,048 samples use resampling and therefore change pitch. That is an explicit short-input tradeoff, not a pitch-preserving algorithm for those inputs. I would document it accurately rather than claiming the pitch change is necessarily inaudible.

The sine-step checks establish that the old internal splices are gone in the exercised cases. They do not prove click-free joins between arbitrary unrelated sounds: two legitimate source boundary samples can have different amplitudes/phases. That hard-cut behavior is distinct from the synthesis discontinuity fixed here.

### Supplied browser and server exports

Measured decoded pictures at full resolution using `signalstats` and adjacent-frame luma differences, plus audio at 48 kHz mono with threshold abs(sample)≤0.001 and minimum silent-run duration 5 ms:

| Artifact | Frames | Minimum mean Y | Minimum adjacent Y change | Silent runs ≥5 ms |
| --- | --- | --- | --- | --- |
| Browser `r3.mp4` | 456 | 96.9371 | 0.857092 | Initial 9.333 ms only |
| Browser `r3_sound.mp4` | 456 | 96.9371 | 0.857092 | Initial 9.333 ms only |
| Browser `r3_cliponly.mp4` | 456 | 96.9371 | 0.857092 | Hook, 0–1.833333 s only |
| Server `r3_server.mp4` | 456 | 96.9506 | 1.026900 | None |
| Server `r3_cliponly_server.mp4` | 456 | 96.9506 | 1.026900 | Hook, 0–1.833333 s only |

All five have **no adjacent change below 0.5, no measured full black frame, and a single large transition at each internal cut**. Packet inspection gives contiguous 1/30-second video intervals in all five, maximum floating-point discrepancy 1.66e−15 seconds. Each has the hook/demo keyframe at **55/30 s**. No inserted picture/timing gap was found. The clip-only files substantiate the sound-on case without music masking it. The hook's lack of sound is source absence, not a sound-fill defect.

The seven real-source schedules remain inside their trim ends, with no repeated source selections. Thus the founder-job fix passes these measurements in both supplied lanes. This does not identify every selected compressed picture by fingerprint or prove waveform identity between Web Audio and ffmpeg decoders; the shared synthesis function receives audio from different decoding paths.

### Empty pieces, intentional gaps, and shipping scope

I agree that preserving timeline duration is better than silently shortening an export. I do **not** agree that silently substituting black always qualifies as a seamless success. For genuinely missing/unavailable picture content, black is a reasonable explicitly defined fallback. It should be distinguished from a normal valid seamless cut, and it should preserve any valid audio independently.

A zero count is not limited to a piece wholly beyond EOF. The measured 10–20 ms interval lies between the 30 fps source's frame timestamps, despite the file containing valid picture before and after it and valid audio throughout. It is accepted by the existing trim rules. The 0.05-second minimum then expands it into **two black frames / 66.667 ms** rather than dropping it as a zero-output piece. This is a separate case from the cumulative-rounding skips that Claude explicitly left in scope. For the strict founder requirement, define representable trim boundaries/covering-frame behavior, or reject/flag such intervals; do not pretend that generated black is a gapless cut. Returning to past-end read-ahead is not a solution.

Intentional `seg.gap` black with magnet off is an editor feature, **not a shipping blocker** when represented as intentional space. Zero-output sub-frame pieces caused by cumulative quantization are also **not a timeline-gap blocker**: a fixed 30 fps output cannot retain every arbitrarily short piece. The editor/export should share that representability contract. Natural source black/static content and necessary slow-motion duplication are likewise not newly introduced join defects.

The extra count decode is a performance cost, **not by itself a reason to block this fix**. Rerunning the seven actual count passes with 2×2 checksums took **6.14 seconds total**, peak ffmpeg RSS approximately **25–35 MB** per pass, down from 37–62 MB with full-resolution CRC output. The late-trim decode work remains; scaling after fps does not eliminate decoding discarded early frames. Existing worker/fast-lane deadlines still limit it, and the new between-pass check avoids launching an expired render. Server sound decoding adds another pass when clip sound is enabled. These costs need monitoring on deployment, but the newly measured Node memory overrun is the specific resource blocker, rather than a hypothetical slow-export concern.

### Reproduction and gate

New scripts/logs are `/tmp/round3-audio.cjs`, `/tmp/round3-edge.mjs`, `/tmp/round3-empty-audio.cjs`, `/tmp/round3-memory-prepare.py`, `/tmp/round3-memory.mjs`, `/tmp/round3-full.cjs`, `/tmp/round3-metrics.cjs`, `/tmp/round3-keys.cjs`, and `/tmp/round3-*.log`. Existing Round 2 VFR, count-equality, look, and count-benchmark harnesses were rerun against current imports. The memory command was:

```sh
python3 /tmp/round3-memory-prepare.py
/usr/bin/time -f 'RSS_KB=%M elapsed=%e' node /tmp/round3-memory.mjs
```

`round3-memory-prepare.py` writes 360 seconds of stereo Float32 samples at 0.125; `round3-memory.mjs` calls the current `fillSoundFile(input, output, 180*48000)`. Both runs exceeded 524,288 KiB, the 512 MiB threshold. The zero-frame audio script uses the existing 997 Hz fixture and the real current count/sound/step pipeline.

**Remaining gate:** keep the successful Round 2 regression results, bound server sound memory for accepted durations, and preserve sound through the zero-picture fallback. The actual founder exports are seamless under the measured join checks; the full working-tree implementation still has those two demonstrable defects.

## Round 4 — memory reduction and zero-frame audio

**Verdict: ship.** Both Round 3 defects are fixed in the tested working tree. I found no remaining blocker for this seamless-cut fix within the defined behavior: intentional gaps and missing-picture fallback may be black, and slow motion/insufficient source pictures may require repeated frames. This is not a promise that every arbitrary source contains continuous nonblack picture or sound.

Reviewed the current diff and untracked sound modules/type declarations. Only this report was edited in the repository. No commit, push, deployment, or production access. The two new Chrome artifacts were inspected locally, not independently regenerated.

### Required reproductions

| Round 3 defect | Round 4 measurement | Result |
| --- | --- | --- |
| 360-second stereo sound → 180-second output exceeds 512 MiB | Exact `/tmp/round3-memory.mjs`, under `/usr/bin/time`: **RSS_KB=294516**, approximately **287.6 MiB**, **1.69 s** elapsed. Previous peak was 559,380 KiB. | **Fixed for the reproduced worst-duration case.** |
| Zero-frame piece loses valid sound | Exact `/tmp/round3-empty-audio.cjs`: count=0, two video frames, **3,200 audio samples**; fitted peak **0.08834779**, server peak **0.08834839**. | **Fixed.** The small difference is consistent with the intermediate PCM quantization; audio is retained rather than replaced by silence. |

The sound-file adapter now uses bounded IO buffers instead of whole interleaved input/output buffers. Synthesis still holds deinterleaved source channels and its output/normalization arrays, but eliminates the full mono analysis array and the second set of normalized output arrays. These changes explain the measured reduction; this is not merely a lower RSS reading taken after the peak.

The memory reproduction is an isolated Node-process test, not a deployed-worker aggregate-memory benchmark. It removes the demonstrated >512 MiB function-level failure and leaves substantial headroom compared with Round 3. The job-duration/speed bounds keep normal maximum source consumption per piece around the tested 360-second case; the pre-existing validator tolerances mean those numbers should not be described as mathematically exact strict bounds. I found no need to block this fix on that small tolerance.

Added an independent chunk-boundary test: 150,001 stereo source samples (1,200,008 bytes), with distinct signals in the two channels, passed through `fillSoundFile` at unchanged and stretched lengths. The 300,003-sample output spans multiple write chunks. **Zero mismatches** against direct `fillSound` for both outputs; unchanged-length output is **byte-identical** to its input. This checks ordering, channel separation, the final partial chunk, and the in-place normalization result.

### Regression results

- **602/602 suite cases pass**, including BETWEEN FRAMES. Used the previously documented environment compatibility wrapper for synchronous-child EPERM-with-status-0; the test implementation itself was unchanged.
- The original sparse-VFR counterexample still reports **45 slots, `diff: []`**.
- The adapted Round 2 server-audio matrix still completes **40/40 cases**, with no measured trailing silence over 1 ms.
- The prior 0.5× edge diagnostic still gives maximum sine step **0.01630265** and a maximum threshold-silent run of **one sample**. DC stays at 0.125 without a zero prefix or sample steps.
- **TypeScript passes**, and **ESLint passes** on touched app/render runtime files, including both sound modules. `git diff --check` passes. CommonJS script lint remains outside that invocation.

The zero-frame branch now validates the needed sound file, uses black video with that sound when present, and only uses the black-and-silent gap branch when the piece has no enabled sound. Volume override handling follows the ordinary piece path. This resolves the actual browser/server discrepancy, rather than just changing a test expectation.

### Round 4 Chrome artifacts

Full-resolution decoded measurements:

| Measurement | `r4.mp4` | `r4_cliponly.mp4` |
| --- | --- | --- |
| Frames | **456** | **456** |
| Minimum mean Y | **96.9371** | **96.9371** |
| Minimum adjacent mean absolute Y change | **0.857092** | **0.857092** |
| Adjacent changes below 0.5 | **None** | **None** |
| Silent runs ≥5 ms, abs(sample)≤0.001 | Initial **9.333 ms** only | Hook, **0–1.833333 s**, only |

Both have one large picture transition at each of the six internal cuts, no measured inserted black or held frame, and contiguous 1/30-second packet intervals (maximum floating-point discrepancy **1.66e−15 s**). Both retain the demo-start keyframe at **55/30 s**. The hook's missing audio is unchanged source behavior. The clip-only measurement verifies the joins without music masking the clip sound.

I did not rerender the full server export in this round: the changed server sound path was exercised by the required reproductions, chunk-boundary checks, and expanded server-piece suite. Round 3's full server artifact measurements remain separate evidence.

### Representability and fallback decision

**No additional blocker here, given the explicitly defined fallback.** Preserving timeline duration and any available sound when there is no retained picture is coherent. Intentional `seg.gap` space, zero-output sub-frame quantization, and necessary slow-motion repeats remain outside the claim that the fix avoids accidental join padding.

One factual correction to the stated rationale: `Math.max(0.05, end-start)` and `Math.max(0.1, end-start)` clamp the calculated duration; they do **not** themselves enforce a minimum saved source interval. The API validator still accepts 10 ms pieces, and the low-level split helper does not enforce 50 ms. The normal full-editor controls are stronger evidence: Cut requires more than **0.2 seconds of timeline time on each side**, and trim handles preserve **0.3 seconds**. Thus the 10–20 ms diagnostic is not representative of an ordinary operation through those controls.

Also, the assertion about a 50 ms interval containing a frame needs a bound on the **largest frame-timestamp gap**, as in regular ≥20 fps material; a nominal/average VFR rate is insufficient. Old/imported states, short actual source files, and sparse VFR intervals can still reach the fallback. That does not reopen the fixed audio defect or block shipping under the fallback policy, but it should prevent marketing this as an unconditional absence of black for every accepted input.

The extra count decode remains a measured performance cost, not a new correctness failure. It is still bounded by the existing lane deadlines. Neither that cost nor the stated intentional-gap/sub-frame scope blocks this fix.

Reproduction logs: `/tmp/round4-memory.log`, `/tmp/round4-empty-audio.log`, `/tmp/round4-suite.log`, `/tmp/round4-chunks.log`, `/tmp/round4-vfr.log`, `/tmp/round4-audio.log`, `/tmp/round4-edge.log`, `/tmp/round4-full.log`, `/tmp/round4-metrics.log`, `/tmp/round4-keys.log`, `/tmp/round4-tsc.log`, and `/tmp/round4-eslint.log`.

**Ship this reviewed working tree, including the four new sound module/type files.** The Round 3 shipping blockers are resolved; the defined fallback and representability limits are documented above. This review did not commit, push, or deploy anything.
