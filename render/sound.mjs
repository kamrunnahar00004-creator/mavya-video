// A clip piece's own sound, stretched to exactly its planned length. Shared by the browser export
// (src/lib/browser-export.ts) and the server's piece render (render/render.mjs soundArgs), so both lanes make the same
// sound. Reads only the piece's own samples, never past its end, and never leaves silence at its edges (founder
// 2026-11-06: clips join like CapCut's magnet; Codex 2026-11-06: ffmpeg atempo returned up to 17 ms short, which
// apad filled with silence).

const N = 2048, HS = N / 2, TOL = 384;

/**
 * Pitch-keeping speed change (WSOLA) to exactly `n` samples per channel. Inputs shorter than one analysis window
 * (2048 samples, 43 ms) are resampled instead: a pitch change too short to hear, never silence.
 * @param {Float32Array[]} chs  the piece's samples per channel
 * @param {number} n  planned samples
 * @returns {Float32Array[]}
 */
export function fillSound(chs, n) {
  const len = chs[0]?.length ?? 0;
  if (n <= 0) return chs.map(() => new Float32Array(0));
  if (!len) return chs.map(() => new Float32Array(n));
  if (len === n) return chs.map((c) => c.slice());
  if (len < N) return chs.map((c) => resample(c, n));
  return tempo(chs, len / n, n);
}

/** Linear resampling of one channel to `n` samples, first and last sample kept. */
function resample(c, n) {
  const out = new Float32Array(n), len = c.length;
  if (n === 1 || len === 1) return out.fill(c[0]);
  const step = (len - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    const x = i * step, k = Math.min(len - 2, Math.floor(x)), f = x - k;
    out[i] = c[k] + (c[k + 1] - c[k]) * f;
  }
  return out;
}

/**
 * WSOLA: Hann windows of 2048 samples at a synthesis hop of 1024, each taken from the source near m * hop * speed
 * where it best continues the previous one. Every window lies wholly inside the source (the last ones end at the
 * source's end), so every output sample is covered by two windows, except the first half window, which is the source's
 * own start. Output: exactly `outLen` samples.
 */
function tempo(chs, speed, outLen) {
  const len = chs[0].length, Ha = HS * speed, last = len - N;
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  // Similarity on the channels' sum, computed where needed: no extra full-length array (the 512 MB render server
  // stretches up to 360 s of stereo sound; Codex 2026-11-06 measured 546 MB with every buffer held at once).
  const k = chs.length, c0 = chs[0], c1 = chs[1];
  const at2 = k === 2 ? (i) => c0[i] + c1[i] : k === 1 ? (i) => c0[i] : (i) => { let v = 0; for (const c of chs) v += c[i]; return v; };
  const out = chs.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  let prev = 0;
  for (let m = 0; m * HS < outLen; m++) {
    const target = Math.min(last, Math.round(m * Ha));
    let best = target;
    if (m > 0) {
      const nat = Math.min(last, prev + HS);
      let score = -Infinity;
      for (let d = -TOL; d <= TOL; d += 2) {
        const at = target + d;
        if (at < 0 || at > last) continue;
        let s = 0;
        for (let i = 0; i < HS; i += 4) s += at2(at + i) * at2(nat + i);
        if (s > score) { score = s; best = at; }
      }
    }
    const o = m * HS;
    for (let i = 0; i < N; i++) {
      const w = win[i];
      for (let c = 0; c < chs.length; c++) out[c][o + i] += chs[c][best + i] * w;
      norm[o + i] += w;
    }
    prev = best;
  }
  // The first half window alone covers the start, from the source's own start (best = 0): divided by its weight, it
  // is the source itself; where that weight is ~0, take the source sample directly.
  // Normalized in place (no second set of output arrays).
  return out.map((c, ci) => {
    const src = chs[ci];
    for (let i = 0; i < outLen; i++) c[i] = norm[i] > 1e-3 ? c[i] / norm[i] : src[Math.min(i, len - 1)];
    return c.subarray(0, outLen);
  });
}
