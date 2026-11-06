// Which source frame each output frame of a clip piece shows, exactly as stepArgs' ffmpeg chain picks it
// (render.mjs: trim, setpts=PTS-STARTPTS, fps, look, settb, setpts='ceil(N*frames/slots)', fps, tpad clone). Shared by the browser export
// (src/lib/browser-export.ts) so both lanes show the same frames; checked against real ffmpeg by
// scripts/frame-schedule-checks.cjs.

/** ffmpeg's AV_ROUND_NEAR_INF (halves away from zero), tolerant of float error in times like 0.25 - 0.2. */
const near = (x) => (x < 0 ? -Math.floor(-x + 0.5 + 1e-4) : Math.floor(x + 0.5 + 1e-4));

/**
 * @param {number[]} pts  presentation times (seconds, file time) of the source's frames, ascending
 * @param {{ start: number, end: number, frames: number }} step  the piece (file times) and its planned frame count
 * @param {number} speed
 * @param {number} fps
 * @returns {{ source: number[], slot: number[] }} for each output frame, an index into `pts` (-1 when the piece has no
 *   frame at all) and its first-pass slot j (the look's keyframe time is start + j / fps, as zoompan's `it`)
 */
export function frameSchedule(pts, step, speed, fps) {
  // trim: frames from start (inclusive) to end (exclusive), timestamps then start at the first kept frame.
  const ms = (x) => Math.round(x * 1000) / 1000;
  const start = ms(step.start), end = ms(step.end);
  const kept = [];
  for (let i = 0; i < pts.length; i++) if (pts[i] >= start - 1e-9 && pts[i] < end - 1e-9) kept.push(i);
  if (!kept.length) return { source: new Array(step.frames).fill(-1), slot: new Array(step.frames).fill(0) };
  const p0 = pts[kept[0]];
  // fps (first pass): slot j shows the last kept frame whose time rounds to a slot <= j. The stream ends at the
  // end of the last kept frame (its duration is the gap to the next source frame, or the previous gap at the end).
  const slotOf = kept.map((i) => near((pts[i] - p0) * fps));
  const lastIdx = kept[kept.length - 1];
  const own = pts.durations?.[lastIdx] ?? 0;
  const dur = lastIdx + 1 < pts.length ? pts[lastIdx + 1] - pts[lastIdx] : own > 0 ? own : lastIdx > 0 ? pts[lastIdx] - pts[lastIdx - 1] : 1 / fps;
  const slots = Math.max(1, near((pts[lastIdx] + dur - p0) * fps));
  const inter = [];
  for (let j = 0, k = 0; j < slots; j++) {
    while (k + 1 < kept.length && slotOf[k + 1] <= j) k++;
    inter.push(kept[k]);
  }
  // settb, setpts='ceil(N*frames/slots)', fps: the slots spread evenly over the planned frames, output n shows slot
  // floor(n * slots / frames). Never a slot past the piece's end, and no held last frame at the cut while the piece
  // has frames enough (founder 2026-11-06). `speed` is already in the planned frame count.
  void speed;
  const source = [], slot = [];
  for (let n = 0; n < step.frames; n++) {
    const j = Math.min(slots - 1, Math.floor((n * slots) / step.frames));
    source.push(inter[j]);
    slot.push(j);
  }
  return { source, slot };
}

/**
 * Where ffmpeg's file time starts (it subtracts the input's start time): the earliest stream's start, where a sound's
 * encoder priming (a little before 0, hidden by the file's edit list) counts as 0. Takes a mediabunny Input.
 * @returns {Promise<number>}
 */
export async function mediaOrigin(input) {
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack().catch(() => null);
  const v = video ? await video.getFirstTimestamp() : Infinity;
  const a = audio ? Math.max(0, await audio.getFirstTimestamp()) : Infinity;
  return Math.min(v, a);
}

/**
 * Presentation times (file time, ascending) of the source frames around a cut, from packet metadata: from the key
 * frame before the cut, in decode order, until the second key frame past its end (B-frames shown inside the cut can
 * come after a later frame in decode order, so stopping at the first late timestamp misses them). Takes a mediabunny
 * EncodedPacketSink. The array also carries `durations` (seconds, per time; 0 when the file gives none): ffmpeg's fps
 * pass ends a piece at its last frame's own duration, not at the gap before it (Codex 2026-11-06: a VFR file whose
 * last frame came 1 s after the one before it gave the browser 75 slots against ffmpeg's 45).
 * @returns {Promise<number[] & { durations?: number[] }>}
 */
export async function frameTimes(packets, origin, start, end) {
  const opts = { metadataOnly: true };
  const from = (await packets.getKeyPacket(origin + start, opts)) ?? (await packets.getFirstPacket(opts));
  const found = [];
  if (!from) return Object.assign([], { durations: [] });
  let keysAfter = 0;
  for await (const p of packets.packets(from, undefined, opts)) {
    const t = p.timestamp - origin;
    if (p.type === "key" && t > end && ++keysAfter >= 2) break;
    found.push([t, p.duration > 0 ? p.duration : 0]);
  }
  found.sort((x, y) => x[0] - y[0]);
  return Object.assign(found.map((f) => f[0]), { durations: found.map((f) => f[1]) });
}
