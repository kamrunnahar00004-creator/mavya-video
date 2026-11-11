// Export loudness: every export is set to the level Instagram, TikTok and YouTube play at (-14 LUFS, ITU-R BS.1770)
// and never clips (peaks at most -1 dBFS). Founder 2026-11-11: an export with a song at full volume peaked at 0.0 dB
// (mean -9.1 dB, clipped): "can you then by default put the volume to a correct level?". One gain for the whole
// video (no compressor), so the mix sounds as it did in the editor, only louder or quieter. Shared by the browser
// export (src/lib/browser-export.ts) and the server's export (render/server.mjs), so both lanes sound the same.

/** Target loudness, LUFS (what the platforms normalise to). */
export const TARGET_LUFS = -14;
/** Highest true peak allowed in the finished file, dBTP. */
export const PEAK_MAX_DB = -1;
/**
 * Room left for the AAC encoder, dB: it can push sharp high sounds over what went in (Codex 2026-11-11: 10 kHz bursts
 * at -1 came out at +3.5). The mix is capped this much lower, and the server checks its encoded file (levelPasses).
 */
export const ENCODER_ROOM_DB = 1;
/** A quiet mix is raised at most this much (more would mostly raise noise). */
export const MAX_BOOST_DB = 12;
/** Below this the video counts as silent and is left alone. */
const SILENT_LUFS = -70;

/** K-weighting (BS.1770) biquads for `rate`: the head's high shelf, then the low cut. Coefficients as in libebur128. */
function kFilters(rate) {
  const shelf = (() => {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / rate), Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
    const a0 = 1 + K / Q + K * K;
    return { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  })();
  const low = (() => {
    const f0 = 38.13547087602444, Q = 0.5003270373238773, K = Math.tan((Math.PI * f0) / rate);
    const a0 = 1 + K / Q + K * K;
    return { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  })();
  return [shelf, low];
}

/** Squared K-weighted samples of one channel. */
function weighted(x, rate) {
  const out = new Float64Array(x.length);
  let src = x;
  for (const { b, a } of kFilters(rate)) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < src.length; i++) {
      const x0 = src[i], y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
      out[i] = y0;
    }
    src = out;
  }
  for (let i = 0; i < out.length; i++) out[i] *= out[i];
  return out;
}

/**
 * Integrated loudness (BS.1770-4: 400 ms blocks every 100 ms, gated at -70 LUFS, then 10 LU under the mean),
 * LUFS; -Infinity for silence or audio under one block.
 * @param {Float32Array[]} chs left and right (or one channel)
 * @param {number} rate samples per second
 */
export function integratedLufs(chs, rate) {
  const len = chs[0]?.length ?? 0, block = Math.round(0.4 * rate), hop = Math.round(0.1 * rate);
  if (len < block) return -Infinity;
  // Running sums of every channel's squared weighted samples (left and right count the same).
  const sum = new Float64Array(len + 1);
  for (const c of chs) { const w = weighted(c, rate); for (let i = 0; i < len; i++) sum[i + 1] += w[i]; }
  for (let i = 0; i < len; i++) sum[i + 1] += sum[i];
  const powers = [];
  for (let s = 0; s + block <= len; s += hop) powers.push((sum[s + block] - sum[s]) / block);
  const lufs = (p) => -0.691 + 10 * Math.log10(p);
  const mean = (ps) => ps.reduce((a, b) => a + b, 0) / ps.length;
  const loud = powers.filter((p) => p > 0 && lufs(p) > SILENT_LUFS);
  if (!loud.length) return -Infinity;
  const gate = lufs(mean(loud)) - 10;
  const kept = loud.filter((p) => lufs(p) > gate);
  return lufs(mean(kept.length ? kept : loud));
}

/** 4x oversampling taps (windowed sinc, 12 per phase) for the 3 in-between phases: the true peak (BS.1770 annex 2). */
const TAPS = [1, 2, 3].map((p) => {
  const h = [];
  for (let k = -5; k <= 6; k++) {
    const x = k - p / 4, w = 0.5 + 0.5 * Math.cos((Math.PI * x) / 6.5);
    h.push(x === 0 ? 1 : (Math.sin(Math.PI * x) / (Math.PI * x)) * w);
  }
  return h;
});

/** Highest true (between-sample) peak, dBTP (-Infinity for silence): what the encoder and a phone's DAC see. */
export function peakDb(chs) {
  let m = 0;
  for (const c of chs) {
    const n = c.length;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(c[i]); if (v > m) m = v;
      for (const h of TAPS) {
        let y = 0;
        for (let k = 0; k < 12; k++) { const j = i - 5 + k; if (j >= 0 && j < n) y += c[j] * h[k]; }
        if (Math.abs(y) > m) m = Math.abs(y);
      }
    }
  }
  return m > 0 ? 20 * Math.log10(m) : -Infinity;
}

/**
 * The one gain for an export, dB: to -14 LUFS, never more than +12 dB, and never a true peak over `cap` (dBTP). A mix
 * too short or too quiet to measure is only turned down when its peak is over the cap (Codex 2026-11-11: a 100 ms
 * mix at +6 dB was left clipping). Measured `lufs` and `peak` (dBTP).
 */
export function exportGainDb(lufs, peak, cap = PEAK_MAX_DB - ENCODER_ROOM_DB) {
  if (!Number.isFinite(peak)) return 0;
  const down = cap - peak;
  if (!Number.isFinite(lufs) || lufs <= SILENT_LUFS) return Math.min(0, down);
  return Math.min(TARGET_LUFS - lufs, down, MAX_BOOST_DB);
}

/** Applies the export gain to the mix in place; returns the gain used, dB. */
export function levelMix(chs, rate) {
  const gain = exportGainDb(integratedLufs(chs, rate), peakDb(chs));
  if (gain === 0) return 0;
  const k = 10 ** (gain / 20);
  for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k;
  return gain;
}

/**
 * The server's levelling of an encoded export (render/server.mjs): `measure(file)` gives {lufs, peak} of a file (null
 * = the export as made), `apply(gainDb, pass)` writes the export with that gain and returns its file. The result is
 * measured again: when the AAC encoder pushed a peak over the limit, the gain drops by that much more, at most
 * `passes` times (Codex 2026-11-11). Returns the levelled file, or null when the export was already right.
 */
export async function levelFile(measure, apply, passes = 3) {
  const first = await measure(null);
  let gain = exportGainDb(first.lufs, first.peak), out = null;
  for (let pass = 0; pass < passes && Math.abs(gain) >= 0.1; pass++) {
    out = await apply(gain, pass);
    const over = (await measure(out)).peak - PEAK_MAX_DB;
    if (!(over > 0)) break;
    gain -= over + 0.2;
  }
  return out;
}
