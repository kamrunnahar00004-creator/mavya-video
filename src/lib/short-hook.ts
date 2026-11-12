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

/**
 * The provider task id with the slowdown carried along ("<model>/slow<factor>|<request id>"), so the poll can undo it.
 * The factor sits in the model part: the database stores only "<model>|<id>" (mavya_generation_transition), and the
 * old "<model>|<id>|slow<factor>" was refused after Kling had already made (and charged for) the hook, leaving the job
 * stuck (founder 2026-11-12: a 2.53 s library hook "stuck" while generating).
 */
export function withSlow(taskId: string, factor: number): string {
  if (!(factor > 1)) return taskId;
  const [model, id] = taskId.split("|");
  return `${model}/slow${factor}|${id}`;
}

/** A provider task id split into model, request id and slowdown (1 when there is none or it is malformed). */
export function parseTask(taskId: string): { model: string; id: string; factor: number } {
  const [stored = "", id = "", extra] = taskId.split("|");
  const inModel = /^(.*)\/slow(\d+(?:\.\d+)?)$/.exec(stored);
  const old = extra ? /^slow(\d+(?:\.\d+)?)$/.exec(extra) : null;
  const model = inModel ? inModel[1] : stored;
  const factor = inModel ? Number(inModel[2]) : old ? Number(old[1]) : 1;
  return { model, id, factor: Number.isFinite(factor) && factor > 1 && factor < 10 ? factor : 1 };
}
