# Original upload versus export review — 2026-11-06

**Verdict: passes the requested mean VMAF ≥95 target on the three unadjusted clips, but does not justify an absolute “no difference the naked eye can see” promise.** The production export is very close to a 1080×1920 rendering of the originals. Subtle smoothing/texture changes are visible in direct 100% comparisons, particularly clip 4. Some individual frames score below 95. This is a qualified quality pass for these samples, not proof of perceptual identity, preservation of all original 4K detail, or device/social playback compatibility.

Verification only: no application code changes, commits, pushes, external uploads, or production writes. Inputs are the production job/file, three original MOVs, three `v1080` files and `clean.mp4` identified in the request. All encoding/measurement used this repository's `node_modules/ffmpeg-static/ffmpeg`, default `vmaf_v0.6.1`, no frame subsampling. Local `meta/new.json[0].payload.spec` run through current `plan()` confirms ranges 235–280, 281–333, 401–461, with 46/53/61 frames. No new production-job query was needed.

**Reference and alignment.** FFmpeg auto-rotates each original, centre-crops the portrait image with `crop=ih*9/16:ih`, and bicubic-scales to 1080×1920, preserving limited-range BT.709 and converting to 8-bit YUV420. Production is explicitly converted from pc to tv using `scale=in_range=pc:out_range=tv,format=yuv420p`. Clean and working copies are already limited-range. Lossless FFV1 intermediates avoid another lossy encode. Streams are reset to `N/(30*TB)` and trimmed explicitly; the metrics below do not repeat terminal frames.

For exact reproduction of Claude's reported sample lengths, initial tables use the first 45/52/60 frames (N−1), source frame 0 paired with the first export frame. Independently checked **all 160 export frames**, including the three omitted terminal frames: for each frame, searched available source offsets −2 through +2 using caption-excluded grayscale MSE at 270×480. Offset zero won every frame; no skipped/duplicated source frame was detected within this search. This is a frame-by-frame temporal check at reduced resolution, not an exhaustive search of all possible source timestamps. Full-resolution metrics then use that fixed zero-offset mapping, not per-frame score maximization.

**Reproduction of the five reported regions.** PSNR is combined YUV420 PSNR, obtained by pooling per-plane squared errors with sample weights 4:1:1 across frames, then converting to dB. It is not an arithmetic average of plane dB. The five numbers reproduce Claude's rounded PSNR and VMAF results.

| Clip | Region, half-open y | Frames | PSNR dB | Mean VMAF | Minimum VMAF | Worst export frame |
|---|---|---:|---:|---:|---:|---:|
| 4 | 0–800 | 45 | 45.66 | 95.86 | 93.29 | 263 |
| 4 | 1250–1920 | 45 | 44.10 | 96.70 | 93.68 | 255 |
| 5 | 0–800 | 52 | 43.20 | 98.92 | 95.11 | 281 |
| 5 | 1250–1920 | 52 | 44.60 | 98.89 | 94.62 | 289 |
| 7 | 750–1920 | 60 | 42.88 | 99.11 | 95.16 | 401 |

Additional per-plane PSNR and SSIM for the same regions follow. Plane PSNR columns are arithmetic means of per-frame dB from libvmaf; SSIM is libvmaf's **float_ssim luminance feature**, not FFmpeg's three-plane `ssim All` value. Chroma is evaluated separately through Cb/Cr PSNR.

| Clip / region | VMAF mean | Y PSNR dB | Cb PSNR dB | Cr PSNR dB | Luma SSIM |
|---|---:|---:|---:|---:|---:|
| 4 / y=0 | 95.86 | 44.54 | 49.91 | 49.97 | 0.9955 |
| 4 / y=1250 | 96.70 | 43.08 | 46.98 | 48.23 | 0.9941 |
| 5 / y=0 | 98.92 | 42.22 | 50.59 | 50.59 | 0.9941 |
| 5 / y=1250 | 98.89 | 43.66 | 49.45 | 50.44 | 0.9945 |
| 7 / y=750 | 99.11 | 42.37 | 44.17 | 44.67 | 0.9973 |

**Full-frame controls.** Cropped VMAF is useful for locating differences but is not a calibrated substitute for full-frame perception. It changes image context and feature pooling; the default model's training assumes 1080p display/viewing conditions, not these portrait subregions. [Netflix's v0 model documentation](https://github.com/Netflix/vmaf/blob/master/resource/doc/models_v0.md) and [FAQ](https://github.com/Netflix/vmaf/blob/master/resource/doc/faq.md) explain the resolution/viewing assumptions. Even the full portrait measurements here should be treated as engineering quality indicators, not a psychophysical guarantee.

For production, blacked out the same full-width area in both streams before measuring the unchanged 1080×1920 frame: y=800–1250 for clips 4/5; y=0–750 for clip 7. The latter is intentionally conservative and excludes the upper image, not just the caption. Black is limited-range Y=16/Cb=Cr=128. This retains 76.6%/76.6%/60.9% of real picture. Identical black pixels inflate PSNR/SSIM and can change VMAF pooling and boundary features, so masked scores are supplementary, not an unbiased full-frame estimate. The independent **unmasked clean export** is the second control; it is a different limited-range encode (~18.49 Mb/s versus production ~20.98 Mb/s), not production with captions mathematically removed.

| Clip / comparison against original | VMAF mean | Y PSNR dB | Cb PSNR dB | Cr PSNR dB | Luma SSIM |
|---|---:|---:|---:|---:|---:|
| 4 / Production, black mask | 96.86 | 44.96 | 49.49 | 50.25 | 0.9978 |
| 4 / Clean, unmasked | 96.51 | 43.45 | 48.39 | 48.58 | 0.9969 |
| 4 / Working copy, unmasked | 97.75 | 44.96 | 49.96 | 49.94 | 0.9984 |
| 5 / Production, black mask | 99.15 | 43.95 | 51.18 | 51.66 | 0.9975 |
| 5 / Clean, unmasked | 99.32 | 42.68 | 50.39 | 50.56 | 0.9965 |
| 5 / Working copy, unmasked | 99.65 | 44.14 | 51.59 | 51.66 | 0.9980 |
| 7 / Production, black mask | 98.35 | 44.52 | 46.32 | 46.82 | 0.9985 |
| 7 / Clean, unmasked | 98.98 | 41.53 | 44.90 | 44.92 | 0.9972 |
| 7 / Working copy, unmasked | 99.48 | 42.73 | 46.17 | 46.11 | 0.9983 |

Including **all** 46/53/61 production frames gives masked mean/minimum VMAF of 96.85/94.81, 99.16/95.63 and 98.37/95.08, respectively. Thus excluding the last frame does not explain the pass. Clean clip 4 and clip 5 also have individual frames below 95. A requirement of ≥95 on **every frame** would fail.

**Why clip 4 is lower.** It contains fine hair, ribbed dark fabric, small interface text and photographed-screen texture. At 100%, export smooths some of this texture. The loss is real relative to the chosen bicubic reference, but its magnitude depends strongly on the reference scaler. A controlled clip-4 experiment changed only the original-reference scaler:

| Original reference scaler | Working-copy full-frame mean VMAF | Clean-export full-frame mean VMAF |
|---|---:|---:|
| Bicubic, requested baseline | 97.75 | 96.51 |
| Bilinear | 99.55 | 98.81 |
| Lanczos | 97.56 | 96.31 |

Bilinear also raises working-copy mean Y PSNR from 44.96 to 45.38 dB, and clean from 43.45 to 44.07 dB. Much of the VMAF gap therefore reflects resampling/texture differences, not simply a catastrophically inadequate final bitrate. This does not prove that a particular historical encoder used bilinear; current `previewArgs` in `render/render.mjs` uses centre crop plus `scale=1080:1920` without an explicit scaler flag, then x264 CRF18. The files alone do not identify every historical scaler setting.

Production versus the **working copy**, using identical full-frame masks, scores 98.99/99.91/99.80 for clips 4/5/7; corresponding mean Y PSNR is 49.02/48.86/49.64 dB. Clip 4's working copy is already lower against the bicubic original reference, and the browser/output path adds a smaller further difference. VMAF differences cannot be subtracted as additive loss budgets. These controls separate upstream working-copy differences from downstream rendering/encoding collectively; they do not fully isolate browser texture sampling, RGB/YUV conversion and hardware encoding from one another.

Clip 4's worst cropped score is at source frame 28/export 263, not its maximum-motion frame. Clips 5 and 7 have substantially larger measured frame changes yet higher VMAF, so “motion alone” does not explain clip 4. Fine screen patterns/noise and scaling interact; a noise-specific causal claim is not established without a denoising/resampling/encode ablation. There is no evidence here for a temporal alignment failure.

**Visual and motion evidence.** PNGs are in `/tmp/claude-1000/-home-farhan-listinglens/77a52ec3-36ea-4781-bab1-ef9ec234d177/scratchpad/sbs/`. Original reference is always **left**, production export **right**. Both are converted from normalized limited-range YUV to RGB consistently. Added export captions intentionally remain visible, while source-screen text is present on both sides. “100%” refers to the 1080p output/reference pixel grid, not unscaled 4K source pixels.

Worst-frame stems are `clip4-frame263`, `clip5-frame289`, `clip7-frame401`. Each has `-full.png` (2160×1920), `-face.png` (two 680×800 crops at x=200,y=400), `-upper.png` (680×700 at x=200,y=0), `-middle.png` (680×500 at x=200,y=750), and `-detail.png` (680×670 at x=200,y=1250). Crops are not resized. View at native pixels; a fit-to-window viewer can hide differences. These include faces, source UI/text, hair and fabric details.

I inspected the worst full frames and native detail crops, plus successive frames around fast motion. Clip 4 shows subtle loss of hair/fabric/screen texture and small edge changes; faces remain close. Clip 5 preserves facial expression, hand shape and source UI text closely, with small texture/moire differences. Clip 7 preserves the face, glasses and source text closely, with slight softness/chroma-edge differences. No large framing, brightness or colour mismatch is apparent after correct range handling. “Very close” is defensible; “indistinguishable under direct inspection” is stronger than the evidence.

For motion, computed every consecutive reference and production frame difference at 270×480, excluding caption bands. The largest caption-free reference changes occur at export frames 261, 305 and 415. Saved/inspected consecutive full and face PNGs at 260–262, 304–306 and 414–416. Also saved clip-4 270–272 around the maximum **unmasked** frame change (271). The unmasked maximum can be affected by content inside the excluded band, hence both clip-4 sequences are supplied.

| Clip / fastest caption-free transition ending at frame | Original mean absolute frame change | Export mean absolute frame change | RMSE between the two temporal-difference images |
|---|---:|---:|---:|
| 4 / 261 | 7.092 | 7.011 | 1.228 |
| 5 / 305 | 20.833 | 20.822 | 1.129 |
| 7 / 415 | 22.181 | 22.164 | 1.373 |

Values are grayscale levels on a 0–255 scale after diagnostic downsampling. Moving pen/hand/glasses positions agree in the inspected sequences; no added ghost image or displaced motion edge is apparent. This is temporal-difference and consecutive-image inspection, **not a real-time human playback study** on a calibrated display. It cannot certify imperceptibility in motion for every viewer/player.

**Full-range control.** Correct pc→tv conversion yields the close PSNR/SSIM and appearance above. A deliberate bad control preserves full-range numerical sample levels (`scale=in_range=pc:out_range=pc,format=yuv420p,setrange=limited`) and compares them as limited-range. On the same masks, Y PSNR falls to 29.56/27.69/30.11 dB and luma SSIM to 0.9851/0.9868/0.9531. This is a substantial range error. Strikingly, default VMAF reports **100.00 for every frame of all three bad controls**. Default VMAF alone is therefore unsafe for certifying range/contrast fidelity in this material. The initial metadata-only control automatically triggered FFmpeg's normal range conversion and was identical to the baseline; the explicit preserve-level control above is the meaningful test.

There is no evidence of a gross range mismatch in the correctly decoded production comparison. Full→limited conversion normalizes the comparison, with ordinary 8-bit rounding, not lossless equality. This test does not establish how phones or social transcoders interpret the original file; changing only its range tag would be wrong.

**What would improve the strict claim.** If the goal is ordinary viewing at output resolution, these samples support high quality without an emergency encoder change. If the goal is no visible difference under direct 100% inspection, first make the intended reference scaler explicit and consistent, retain more upstream detail (higher-quality or lossless working intermediate, or render directly from originals), and minimize repeated resampling and lossy encoding. Then A/B final encoder quality at matched geometry/range; increasing final bitrate cannot restore texture already removed upstream. Test any scaler change on photographed screens because sharper kernels can change aliasing/moire. A production-matched caption-free encode would remove the clean-control confound. None of these changes was applied. Real-time blinded viewing and device/social round trips remain necessary before advertising universal invisibility.

Reproduction artifacts: `/tmp/orig-review/run.py` prepares references and runs the baseline metric batches; `extra.py` contains the production-versus-working comparisons; `range.py` produces the corrected preserve-level range control and full-count masks; `scaler.py` runs the reference-scaler sensitivity checks; `align.cjs` extracts all PNGs and per-frame offset results; `motion.cjs` measures temporal differences. Logs, per-frame VMAF/plane-PSNR/SSIM JSON, `alignment.json`, and `motion.json` are alongside them. `*-mask-short.json` uses N−1; `*-prod-mask.json` uses all N. These temporary artifacts contain local paths, not credentials or signed URLs. The report is the only repository file created by this review.
