// Which source frame each output frame of a clip piece shows, exactly as stepArgs' ffmpeg chain picks it
// (render.mjs: trim, setpts=PTS-STARTPTS, fps, look, setpts=PTS/speed, fps, tpad clone). Shared by the browser export
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
  const dur = lastIdx + 1 < pts.length ? pts[lastIdx + 1] - pts[lastIdx] : lastIdx > 0 ? pts[lastIdx] - pts[lastIdx - 1] : 1 / fps;
  const slots = Math.max(1, near((pts[lastIdx] + dur - p0) * fps));
  const inter = [];
  for (let j = 0, k = 0; j < slots; j++) {
    while (k + 1 < kept.length && slotOf[k + 1] <= j) k++;
    inter.push(kept[k]);
  }
  // setpts=PTS/speed (truncated to whole 1/fps ticks), then fps again: output n shows the last slot at or before n.
  // setpts moves the stream's end the same way, so the second fps stops at trunc(slots / speed) and drops a slot
  // landing there. At speed 1 there is no setpts and slot n is output n. Past the end, tpad repeats the last frame.
  const at = inter.map((_, j) => (speed === 1 ? j : Math.trunc(j / speed)));
  const stop = Math.max(1, speed === 1 ? slots : Math.trunc(slots / speed));
  const source = [], slot = [];
  for (let n = 0, j = 0; n < step.frames; n++) {
    if (n < stop) while (j + 1 < inter.length && at[j + 1] <= n) j++;
    source.push(inter[j]);
    slot.push(j);
  }
  return { source, slot };
}
