// Types for render/frames.mjs (the source).
export function frameSchedule(pts: number[], step: { start: number; end: number; frames: number }, speed: number, fps: number): { source: number[]; slot: number[] };
export function mediaOrigin(input: unknown): Promise<number>;
export function frameTimes(packets: unknown, origin: number, start: number, end: number): Promise<number[]>;
