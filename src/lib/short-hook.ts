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
 * ffmpeg arguments for the generated clip (Kling 4.0, founder 2026-11-21): no sound (Kling 4.0 adds its own audio;
 * hook clips are silent), cut to the length that was sent, then any slowdown undone.
 */
export function finishArgs(factor: number, length: number): string[] {
  // The cut is on the generated clip's own timeline, before any speed-up (an output -t would cut after it).
  const trim = length > 0 ? [`trim=duration=${length}`, "setpts=PTS-STARTPTS"] : [];
  const speed = factor > 1 ? [`setpts=PTS/${factor}`] : [];
  return ["-an", "-vf", [...trim, ...speed, "fps=30"].join(",")];
}

/**
 * Kling 4.0's input limits (fal): each side 700 to 4553 px, aspect ratio 0.40 to 2.50. A clip outside the ratio is
 * cropped to it around the center, then its short side is brought to at least 720 px and its long side to at most
 * 4552 px, both even (x264 needs even sizes; Codex 2026-11-21: a 721 px wide upload failed to encode).
 */
export const MIN_SIDE = 720;
export const minSideFilter = [
  // 2.45 and 0.41, inside the limits: rounding to even sizes, then scaling a tiny clip up, moves the ratio (Codex 2026-11-21).
  "crop='max(2,trunc(min(iw,ih*2.45)/2)*2)':'max(2,trunc(min(ih,iw/0.41)/2)*2)'",
  `scale='trunc(if(lt(iw,ih),max(iw,${MIN_SIDE}),max(ih,${MIN_SIDE})*iw/ih)/2)*2':'trunc(if(lt(iw,ih),max(iw,${MIN_SIDE})*ih/iw,max(ih,${MIN_SIDE}))/2)*2'`,
  "scale='trunc(min(iw,iw*4552/max(iw,ih))/2)*2':'trunc(min(ih,ih*4552/max(iw,ih))/2)*2'",
].join(",");

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

/**
 * The task id with the length of the clip that was sent ("<model>[/slow<f>]/len<seconds>|<id>"). Kling 4.0 rounds its
 * output up to whole seconds (3.63 s in, 4.04 s out, the extra at the end), so the poll trims the result back to it.
 * Same model-part trick as withSlow: the database accepts [A-Za-z0-9_./-] there.
 */
export function withLength(taskId: string, seconds: number): string {
  if (!(Number.isFinite(seconds) && seconds > 0 && seconds <= 60)) return taskId;
  const [model, id] = taskId.split("|");
  return `${model}/len${Math.round(seconds * 100) / 100}|${id}`;
}

/** A provider task id split into model, request id, slowdown (1 when none or malformed) and sent length (0 when none). */
export function parseTask(taskId: string): { model: string; id: string; factor: number; length: number } {
  const [stored = "", id = "", extra] = taskId.split("|");
  const withLen = /^(.*)\/len(\d+(?:\.\d+)?)$/.exec(stored);
  const rest = withLen ? withLen[1] : stored;
  const inModel = /^(.*)\/slow(\d+(?:\.\d+)?)$/.exec(rest);
  const old = extra ? /^slow(\d+(?:\.\d+)?)$/.exec(extra) : null;
  const model = inModel ? inModel[1] : rest;
  const factor = inModel ? Number(inModel[2]) : old ? Number(old[1]) : 1;
  const length = withLen ? Number(withLen[2]) : 0;
  return {
    model, id,
    factor: Number.isFinite(factor) && factor > 1 && factor < 10 ? factor : 1,
    length: Number.isFinite(length) && length > 0 && length <= 60 ? length : 0,
  };
}
