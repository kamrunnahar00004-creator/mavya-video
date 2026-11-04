// Types for render/frames.mjs (the source).
export function frameSchedule(pts: number[], step: { start: number; end: number; frames: number }, speed: number, fps: number): { source: number[]; slot: number[] };
