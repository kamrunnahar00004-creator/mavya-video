// Types for render/limits.mjs (the source).
export const MAX_QUEUE: number;
export const MAX_FILE_BYTES: number;
export const MAX_JOB_BYTES: number;
export const JOB_MS: number;
export const MAX_OVERLAY_PIXELS: number;
export function countOverlayPixels(budget: { overlayPixels?: number }, width: number, height: number): void;
export function validJob(b: unknown): boolean;
export function validProbe(width: number, height: number, duration: number): boolean;
