// Types for the render plan the Next app also runs (src/lib/server/fast-export.ts). render.mjs is the source.
export type Step = { kind: "gap" | "piece"; si?: number; pi?: number; start?: number; end?: number; frames: number; len: number };
export type Probe = { file: string; hasAudio: boolean; duration: number | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Spec = { width: number; height: number; fps: number; total: number; segments: any[]; sounds: any[]; overlays: any[] };
export function plan(spec: Spec): Step[];
export function planLength(spec: Pick<Spec, "fps" | "segments">): number;
export type FrameRange = { from: number; to: number; start: number; end: number };
export function layout(spec: Spec): { steps: Step[]; segs: { gap: FrameRange; clip: FrameRange }[] };
export function textFrames(spec: Spec, layoutOrNull: ReturnType<typeof layout> | null, text: { start: number; end: number; owner?: { seg: number; gap: boolean } | null }): { from: number; to: number };
export function stepArgs(spec: Spec, step: Step, src: Probe | null, out: string, slots?: number, sound?: string): string[];
export function countArgs(spec: Spec, step: Step, src: Probe, out: string): string[];
export function countFrames(text: string): number;
export function pieceHasSound(spec: Spec, step: Step, src: Probe | null): boolean;
export function pieceSoundArgs(step: Step, src: Probe, out: string): string[];
export function finalArgs(spec: Spec, list: string, local: { sounds: Probe[]; overlays: string[] }, out: string): string[];
export function previewArgs(input: string, out: string, master?: string, hdr?: boolean): string[];
export const TONEMAP: string;
export function previewRuns(input: string, out: string, master?: string, hdr?: boolean): string[][];
export function isHdr(probeText: string): boolean;
export type Look = { brightness?: number; contrast?: number; saturation?: number; warmth?: number; zoom?: number; panX?: number; panY?: number; flip?: boolean; keys?: { t: number; zoom: number; panX: number; panY: number }[] };
export function exposurePower(v: number): number;
export function contrastGamma(c: number): number;
export function demoAt(spec: Spec): number | null;
export function demoArgs(input: string, out: string, at: number): string[];
