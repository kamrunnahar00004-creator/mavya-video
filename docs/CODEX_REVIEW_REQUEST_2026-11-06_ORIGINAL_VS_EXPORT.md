# Codex: verify that exported clips look the same as the original uploads (2026-11-06)

The founder asks: is the quality of the original uploaded clips and the exported clips almost the same, with no difference a naked eye can see? The target (2026-11-05) is VMAF 95 or more against the original at 1080x1920, plus a side-by-side look at stills and motion.

**Verify only. Do not change code, commit or push.** Write `docs/CODEX_REVIEW_2026-11-06_ORIGINAL_VS_EXPORT.md` with a verdict.

## Files

- **Export:** production job `9bec7785-cf21-47d8-8381-f6e480a67219`, browser lane, encoder `hw-qp20 21.1mbps-file e2edca9`. Local copy: `/tmp/claude-1000/-home-farhan-listinglens/77a52ec3-36ea-4781-bab1-ef9ec234d177/scratchpad/meta/cfda7e88-a43c-42d9-8c6e-ddd9d542d216.mp4`. The file is full range (`yuvj420p`, pc).
- **Originals:** iPhone, 3840x2160 H.264 SDR BT.709, rotated −90, 30 fps, about 47 Mbps. Local copies in `.../scratchpad/orig/`: `5b684b76-...mov` (clip 4), `d57536dd-...mov` (clip 5), `e8d57b5a-...mov` (clip 7).
- **Clips 4, 5 and 7** have no look changes, speed 1, start 0. They occupy export frames 235-280, 281-333 and 401-461; the cuts are in the job spec, from `plan()`.
- Clips 1, 2, 3 and 6 have looks (brightness, contrast, saturation and zoom), so they are not expected to match the original. See `docs/CODEX_REVIEW_2026-11-06_LOOK_MATCH.md`.

## What Claude measured

ffmpeg libvmaf (default model), aligned by the best PSNR offset (it was 0 in every case).
- **Export side:** `select` frame range, converted from pc to tv range, yuv420p.
- **Original side:** the first N−1 frames, auto-rotated, centre-cropped to 9:16, bicubic-scaled to 1080x1920.
- The burned-in captions are excluded by measuring regions without text: clips 4 and 5 at y 0-800 and 1250-1920, clip 7 at y 750-1920.

| Clip | Region | PSNR | VMAF mean | Worst frame |
| --- | --- | --- | --- | --- |
| 4 | y 0-800 | 45.7 dB | 95.86 | 93.3 |
| 4 | y 1250-1920 | 44.1 dB | 96.70 | 93.7 |
| 5 | y 0-800 | 43.2 dB | 98.92 | 95.1 |
| 5 | y 1250-1920 | 44.6 dB | 98.89 | 94.6 |
| 7 | y 750-1920 | 42.9 dB | 99.11 | 95.2 |

## Check brutally

1. Reproduce these numbers, and check the alignment frame by frame.
2. Is VMAF on cropped regions valid? VMAF is trained on full frames. Add full-frame measurements that mask the caption areas another way: the caption-free re-export `C:\Users\farha\AppData\Local\Temp\mavya-enc\clean.mp4` (same spec, no overlays, though Round 1 of LOOK_MATCH found it is limited range and a slightly different encode), or a masked comparison. Also add SSIM, and PSNR on the chroma planes.
3. Why is clip 4 lower (mean 95.9, worst 93.3)? Is it motion, noise, or a real loss? Where is the loss: the 1080p working copy, the browser encode, or the scaler? Measure the working copy `v1080` (in `C:\Users\farha\AppData\Local\Temp\mavya-enc\`) against the original too.
4. Look at it. Write side-by-side PNG crops (original against export) of the worst frame per clip, at 100% zoom on faces, text and fine detail, and give your honest visual judgement. Check motion too: the frame differences around the fastest motion.
5. Does the export's full range affect this comparison? The range conversion should make it neutral; check it.
6. Verdict: does it meet "no difference the naked eye can see" (VMAF 95+ and visual)? If not, where and what would fix it.
