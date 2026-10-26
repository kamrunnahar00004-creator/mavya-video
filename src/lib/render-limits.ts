import limits from "../../render/constraints.json";
export const RENDER_LIMITS = limits;
type Segment = { parts?: unknown[]; pieces?: unknown[]; adjust?: { keys?: unknown[] }; look?: { keys?: unknown[] } | null };
/** The same envelope applies before saving, reserving an export, and admitting worker jobs. */
export function renderLimitError(segments: Segment[], texts = 0, sounds = 0, seconds?: number): string | null {
  if (segments.length > limits.segments) return `Use up to ${limits.segments} clips per video.`;
  if (segments.reduce((n, s) => n + (s.parts?.length ?? s.pieces?.length ?? 1), 0) > limits.pieces) return `Use up to ${limits.pieces} clip pieces per video.`;
  if (segments.some(s => (s.adjust?.keys?.length ?? s.look?.keys?.length ?? 0) > limits.keyframes)) return `Use up to ${limits.keyframes} keyframes per clip.`;
  if (texts > limits.overlays) return `Use up to ${limits.overlays} text layers.`;
  if (sounds > limits.sounds) return `Use up to ${limits.sounds} sounds.`;
  if (seconds !== undefined && seconds > limits.seconds) return "Videos can be up to 3 minutes.";
  return null;
}
