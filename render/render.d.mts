// Types for the render plan the Next app also runs (src/lib/server/fast-export.ts). render.mjs is the source.
export type Step = { kind: "gap" | "piece"; si?: number; pi?: number; start?: number; end?: number; frames: number; len: number };
export type Probe = { file: string; hasAudio: boolean; duration: number | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Spec = { width: number; height: number; fps: number; total: number; segments: any[]; sounds: any[]; overlays: any[] };
export function plan(spec: Spec): Step[];
export function stepArgs(spec: Spec, step: Step, src: Probe | null, out: string): string[];
export function finalArgs(spec: Spec, list: string, local: { sounds: Probe[]; overlays: string[] }, out: string): string[];
export function previewArgs(input: string, out: string, master?: string): string[];
export type Look = { brightness?: number; contrast?: number; saturation?: number; warmth?: number; zoom?: number; panX?: number; panY?: number; flip?: boolean; keys?: { t: number; zoom: number; panX: number; panY: number }[] };
export function exposurePower(v: number): number;
export function contrastGamma(c: number): number;
