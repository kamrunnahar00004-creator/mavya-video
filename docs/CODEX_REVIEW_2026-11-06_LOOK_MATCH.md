Verdict: the tested browser export preserves the intended look closely, including the hook and clip 2 zooms. This is a qualified pass for these samples, not proof of identical pixels or universal playback. I would not sign off the stronger claim that preview, browser export, server export and social uploads all match. The server lane has measurable additional differences, and device/social compatibility remains unverified.

Review performed 2026-11-06. No application code was changed, no production writes were made, and nothing was committed or pushed. A read-only Supabase GET for job `9bec7785-cf21-47d8-8381-f6e480a67219` confirmed that its current `payload.spec` exactly matches the local `meta/new.json` spec. All seven local sources were used.

Measurements use three mapped frames per clip: 1: 15/31/46; 2: 83/105/127; 3: 170/192/213; 4: 246/258/269; 5: 294/307/320; 6: 350/367/384; 7: 416/431/446 (zero-based export frame numbers). I reran `map.mjs` using `frameSchedule`. There was no best-frame search. Exposure means mean Rec.709-weighted RGB luma on a 0–255 scale; contrast means its standard deviation on that scale, not the contrast slider; saturation means mean HSV S on a 0–100 scale. Tables give the largest absolute difference across the three frames, and the PSNR range. PSNR is RGB and includes geometry, resampling and compression differences.

Claude's analytical reference measurements mostly reproduce. These compare full caption-free export frames against ffmpeg-decoded, centre-cropped sources with the continuous JS curves applied. The original script skips both zoomed clips, so its good results alone do not establish their correctness.

| Clip | Max abs Δ exposure | Max abs Δ contrast | Max abs Δ saturation (pp) | PSNR range (dB) |
|---|---:|---:|---:|---:|
| 1 | — | — | — | — |
| 2 | — | — | — | — |
| 3 | 0.09 | 0.05 | 0.16 | 41.31–45.02 |
| 4 | 0.04 | 0.02 | 0.05 | 43.27–43.70 |
| 5 | 0.04 | 0.02 | 0.02 | 43.46–44.00 |
| 6 | 0.20 | 0.40 | 0.03 | 41.09–43.96 |
| 7 | 0.06 | 0.03 | 0.11 | 40.91–42.46 |

Clip 7 does **not** reproduce the claimed 43–44 dB: it is 40.91–42.46 dB. Clip 6's largest contrast difference is about 0.40. The unadjusted clips are close to their sources, with normal lossy encoding and chroma/resampling differences; they are not lossless copies.

I also rendered actual source `<video>` elements in Chrome with `object-fit:cover`, the real `videoStyle` and `motionAt` functions transpiled from `src/lib/adjust.ts`, and SVG component-transfer tables matching `WarmthFilter` in `run-preview.tsx` (257 exposure entries and 65 contrast entries, rounded to four decimals, sRGB interpolation), followed by CSS saturation. This exercises Chrome's table interpolation and video decoding, rather than applying the continuous formulas to an RGB array. All videos were opaque; neither exposure nor contrast changes alpha. The export explicitly disables premultiplied texture upload, and there is no evidence of an alpha problem for these opaque sources. Transparent media and overlay alpha were not separately certified.

Windows Node failed before launching Chrome with `WSL ... UtilBindVsockAnyPort ... socket failed 1`. I therefore used a temporary Linux Chrome for Testing 142.0.7444.61, headless, through CDP. Screenshots were captured at 1080×1920, device scale 1, after seeking to each mapped source frame and waiting for rendering. This is the preview's video/filter path at export resolution, not a screenshot of the founder's entire editor UI or their Windows GPU/display profile. The installed Windows Chrome was not successfully tested.

Full-frame caption-free export minus Chrome-rendered preview:

| Clip | Max abs Δ exposure | Max abs Δ contrast | Max abs Δ saturation (pp) | PSNR range (dB) |
|---|---:|---:|---:|---:|
| 1 | 0.57 | 0.14 | 2.03 | 41.03–41.40 |
| 2 | 0.84 | 0.13 | 1.08 | 39.80–40.86 |
| 3 | 0.78 | 0.08 | 0.84 | 40.87–43.25 |
| 4 | 1.17 | 0.07 | 1.03 | 41.37–41.62 |
| 5 | 1.17 | 0.13 | 0.67 | 41.79–42.17 |
| 6 | 0.15 | 0.13 | 0.62 | 40.69–43.43 |
| 7 | 1.34 | 0.09 | 2.61 | 39.15–40.04 |

These differences are small, but larger than the analytic-only comparison suggests. In particular, HSV saturation can differ by 2.61 percentage points even on unadjusted clip 7. The fact that unadjusted clips also differ shows why this must not automatically be diagnosed as an incorrect saturation slider. Video decoding, quantization, chroma upsampling and the screenshot/render path contribute. These measurements do not isolate each contribution.

For the two zoomed clips, geometry was evaluated at the **slot file time**, not the selected source frame timestamp: `piece.start + slot / 30`. Hook times were 0.500/1.033/1.533 s; clip 2 times were 1.957/2.790/3.624 s. The browser export uses continuous smoothstep zoom, whereas preview `motionAt` rounds motion to 0.1 units. This is a real, small implementation difference; the actual Chrome comparisons above include it. I found no large browser crop/zoom mismatch in these samples.

The production file is **not the same encode as clean.mp4 apart from captions**. ffmpeg identifies production as H.264 High, `yuvj420p(pc, bt709)`, about 20.98 Mb/s; clean is H.264 High, `yuv420p(tv, bt709)`, about 18.49 Mb/s. Both are 1080×1920 at 30 fps. The clean file therefore cannot by itself certify the production file's full-range handling.

I compared production with clean after decoding both to RGB with their declared ranges. Burned-in text was excluded using conservative full-width bands, selected from the sampled production images: clip 1 y=300–599; clip 2 200–499; clips 3–5 800–1249; clip 6 500–849; clip 7 400–749. Everything outside those bands was measured, retaining 76.6–84.4% of each frame. These bands deliberately exclude some clean image too; this is not a claim about every pixel outside a precisely traced text outline.

Production minus clean, on those caption-free regions:

| Clip | Max abs Δ exposure | Max abs Δ contrast | Max abs Δ saturation (pp) | PSNR range (dB) |
|---|---:|---:|---:|---:|
| 1 | 0.59 | 0.05 | 3.35 | 42.70–42.80 |
| 2 | 0.54 | 0.06 | 0.29 | 40.91–41.16 |
| 3 | 0.51 | 0.06 | 0.36 | 41.48–44.20 |
| 4 | 0.55 | 0.06 | 0.54 | 42.58–43.02 |
| 5 | 0.53 | 0.04 | 0.58 | 42.66–43.41 |
| 6 | 0.49 | 0.09 | 0.19 | 42.10–43.60 |
| 7 | 0.60 | 0.09 | 1.48 | 40.52–41.32 |

The images agree closely in those regions, but not exactly: production is roughly half a luma level brighter. Larger HSV differences occur in dark regions, especially the hook, despite high RGB PSNR. The two files' range and encode differences matter when interpreting those statistics.

Most directly relevant to the founder: production minus the actual Chrome preview, using those same caption-free regions:

| Clip | Max abs Δ exposure | Max abs Δ contrast | Max abs Δ saturation (pp) | PSNR range (dB) |
|---|---:|---:|---:|---:|
| 1 | 0.11 | 0.20 | 1.50 | 41.82–42.09 |
| 2 | 0.28 | 0.11 | 0.89 | 40.60–41.27 |
| 3 | 0.27 | 0.05 | 0.53 | 41.61–43.40 |
| 4 | 0.63 | 0.01 | 0.54 | 42.69–42.92 |
| 5 | 0.65 | 0.12 | 0.17 | 43.46–43.88 |
| 6 | 0.59 | 0.14 | 0.46 | 40.72–43.01 |
| 7 | 0.77 | 0.17 | 1.65 | 39.67–40.70 |

This supports a close browser-lane match in the sampled production images, without relying solely on the clean re-export. It does not establish identical display appearance in every player.

For the server lane I ran the actual `countArgs`, `countFrames` and `stepArgs` from `render/render.mjs` on all seven sources and the production spec, producing each full intermediate piece. I compared the corresponding output frames against clean, including speed, trim, fps scheduling, zoom and the actual server look. The counts before/after speed were 63/62, 100/87, 95/86, 46/46, 53/53, 77/67 and 62/61. Audio was disabled for these colour tests. These are server intermediate encodes, not a final server production job with captions/audio and another encode.

Caption-free browser export minus server intermediate, full frame:

| Clip | Max abs Δ exposure | Max abs Δ contrast | Max abs Δ saturation (pp) | PSNR range (dB) |
|---|---:|---:|---:|---:|
| 1 | 0.92 | 0.18 | 1.87 | 35.90–37.32 |
| 2 | 0.39 | 0.46 | 0.29 | 24.15–40.56 |
| 3 | 1.37 | 0.10 | 0.58 | 39.27–41.26 |
| 4 | 0.03 | 0.02 | 0.05 | 42.47–42.89 |
| 5 | 0.01 | 0.02 | 0.05 | 42.31–43.39 |
| 6 | 2.38 | 0.69 | 1.06 | 37.82–39.41 |
| 7 | 0.02 | 0.02 | 0.13 | 40.42–41.23 |

The server is close on the unadjusted clips, but is not equivalent to the browser lane. On clip 6 the browser is 1.91–2.38 luma levels brighter than the server; on clip 3 it is 1.26–1.37 brighter. The server uses successive 8-bit `lutrgb` operations, whereas the shader applies continuous curves before final encoding; quantization and RGB/YUV conversions are plausible contributors, not a fully isolated diagnosis. Contrary to the request's older description, current server saturation already uses `colorchannelmixer` with the CSS weights, **not** `eq=saturation`.

Clip 2's late zoom sample (export frame 127) falls to 24.15 dB against the server. Inspection of corresponding images shows a small positional/scale difference around detailed edges; PSNR here must not be interpreted as a major colour failure. Server `zoompan` uses a discrete crop/resampling path, unlike the WebGL window and CSS transform. The hook is also lower at 35.90–37.32 dB. Thus a server fallback can change the result, even though the intended look formulas are similar.

Full-range playback remains an open compatibility question. The production tag describes full-range BT.709, and the range-aware comparisons above do not show a gross range error. Full range is not intrinsically invalid. A consumer that interprets full-range values as limited range can expand and clip shadows/highlights; the converse interpretation lifts blacks and dulls whites. Range tags alone do not test what a particular phone player or social transcoder actually does. [FFmpeg's range definitions](https://ffmpeg.org/doxygen/trunk/pixfmt_8h.html) distinguish limited and full range. [Apple's archived colour-management note](https://developer.apple.com/library/archive/technotes/tn2227/_index.html) also explains that playback uses colour metadata and display profiles; it is background documentation, not evidence that this exact file plays correctly on current QuickTime.

No iPhone/Android playback, current QuickTime playback, TikTok upload or Instagram upload/returned transcode was tested. Consequently I cannot honestly answer “yes, all of those read it correctly.” No external uploads were made. Respect the founder's decision not to make a risky range change: do not simply flip metadata. Any future conversion must transform pixel levels and tag them consistently, followed by real device and upload/download comparisons.

Fixes needed: no emergency look-curve change is justified for this browser export by these samples. Before promising identical lanes, align the server's colour precision/conversions and zoom sampling with the browser and repeat these tests. For strict browser/preview geometry parity, also align the 0.1-unit motion rounding. Before claiming phone/QuickTime/social compatibility, test the actual production file on those destinations and compare returned transcodes. The clean file should be recreated with a verified matching encoder/range path if it is to serve as a production control. None of these fixes was applied in this verification-only review.

Reproduction evidence remains local: `/tmp/review-metrics.json`, `/tmp/prod-preview.json`, `/tmp/look-repro.txt`, `/tmp/server-review.mjs`, `/tmp/review-metrics.mjs`, and `/tmp/prod-preview.mjs`. Chrome harness, HTML, per-frame screenshots and seek/style metadata are in `C:\Users\farha\AppData\Local\Temp\mavya-enc\review*` (Linux fallback harness: `review-linux.cjs`). These are temporary artifacts, not repository changes. No credentials or signed media URLs are included in this report.
