// Types for render/loudness.mjs (the source).
export declare const TARGET_LUFS: number;
export declare const PEAK_MAX_DB: number;
export declare const MAX_BOOST_DB: number;
export declare function integratedLufs(chs: Float32Array[], rate: number): number;
export declare function peakDb(chs: Float32Array[]): number;
export declare const ENCODER_ROOM_DB: number;
export declare function exportGainDb(lufs: number, peak: number, cap?: number): number;
export declare function levelMix(chs: Float32Array[], rate: number): number;
export declare function levelFile(measure: (file: string | null) => Promise<{ lufs: number; peak: number }>, apply: (gainDb: number, pass: number) => Promise<string>, passes?: number): Promise<string | null>;
