/**
 * Short hooks (founder 2026-11-08). Kling v3 motion control needs at least 3 s of continuous motion in the reference:
 * a frozen last frame does not count, so a 2.8 s clip held to 3 s was refused ("The duration of continuous valid
 * motion is too short"), after minutes of queueing. 111 of the 246 library hooks are under 3 s. A short clip is now
 * slowed down to MOTION_TARGET seconds of real motion before it is sent, and the result is sped up by the same factor
 * when it comes back, so it has the original's length and timing. Hooks of 3 s or more are sent as before.
 * Pure: the ffmpeg arguments and the task id format, tested in scripts/short-hook-checks.cjs.
 */

/** Kling's floor for continuous motion, in seconds. */
export const MOTION_FLOOR = 3;
/** What a short clip is slowed to: above the floor, with room for rounding. */
export const MOTION_TARGET = 3.2;

/** How much slower a clip of `seconds` is played for Kling: 1 (as is) unless it is shorter than the floor. */
export function slowFactor(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds >= MOTION_FLOOR) return 1;
  return Math.ceil((MOTION_TARGET / seconds) * 10000) / 10000;
}

/** ffmpeg video arguments for the reference: slowed to real motion when short, else at most 30 s as before. */
export function referenceArgs(factor: number): string[] {
  return factor > 1 ? ["-vf", `setpts=${factor}*PTS,fps=30`] : ["-t", "30"];
}

/** ffmpeg video arguments that undo the slowdown on the generated clip. */
export function restoreArgs(factor: number): string[] {
  return ["-vf", `setpts=PTS/${factor},fps=30`];
}

/** The provider task id with the slowdown carried along ("<model>|<request id>|slow<factor>"), so the poll can undo it. */
export function withSlow(taskId: string, factor: number): string {
  return factor > 1 ? `${taskId}|slow${factor}` : taskId;
}

/** A provider task id split into model, request id and slowdown (1 when there is none or it is malformed). */
export function parseTask(taskId: string): { model: string; id: string; factor: number } {
  const [model = "", id = "", extra] = taskId.split("|");
  const m = extra ? /^slow(\d+(?:\.\d+)?)$/.exec(extra) : null;
  const factor = m ? Number(m[1]) : 1;
  return { model, id, factor: Number.isFinite(factor) && factor > 1 && factor < 10 ? factor : 1 };
}
