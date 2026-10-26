import limits from "./constraints.json" with { type: "json" };
export const MAX_QUEUE = 8;
export const MAX_FILE_BYTES = 300 * 1024 * 1024;
export const MAX_JOB_BYTES = 600 * 1024 * 1024;
export const JOB_MS = 15 * 60_000;
export const MAX_OVERLAY_PIXELS = 32 * 1024 * 1024;
export function countOverlayPixels(budget, width, height) {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0)throw new Error('Invalid text image');
 budget.overlayPixels=(budget.overlayPixels??0)+width*height;
 if(budget.overlayPixels>MAX_OVERLAY_PIXELS)throw new Error('Text images exceed the render memory budget');
}
const number = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const link = x => typeof x === 'string' && x.length <= 8192 && /^https:\/\//.test(x);
export function validJob(b) {
 const s=b?.spec;
 if (!s || s.width!==limits.width || s.height!==limits.height || s.fps!==limits.fps || !number(s.total,0.05,limits.seconds) || !link(b.output?.url) || b.output.contentType!=='video/mp4') return false;
 if (!/^[0-9a-f-]{36}$/i.test(b.meta?.who??'') || JSON.stringify(b.meta).length>2048) return false;
 if (!Array.isArray(s.segments)||s.segments.length<1||s.segments.length>limits.segments||!Array.isArray(s.sounds)||s.sounds.length>limits.sounds||!Array.isArray(s.overlays)||s.overlays.length>limits.overlays) return false;
 let pieces=0,len=0;
 for(const seg of s.segments){
  if(!link(seg.url)||!number(seg.speed,0.5,2)||!number(seg.gap,0,180)||!number(seg.volume,0,1)||!Array.isArray(seg.pieces)||!seg.pieces.length)return false;
  pieces+=seg.pieces.length;len+=seg.gap;
  for(const p of seg.pieces){if(!number(p.start,0,3600)||!number(p.end,p.start+0.01,3600))return false;len+=(p.end-p.start)/seg.speed;}
  if(seg.look?.keys && (!Array.isArray(seg.look.keys)||seg.look.keys.length>limits.keyframes))return false;
 }
 if(pieces>limits.pieces||len>limits.seconds+1||Math.abs(len-s.total)>1)return false;
 for(const a of s.sounds)if(!link(a.url)||!number(a.at,0,s.total)||!number(a.start,0,3600)||!number(a.dur,0.01,s.total)||!number(a.volume,0,1))return false;
 for(const o of s.overlays)if(!link(o.url)||!number(o.start,0,s.total)||!number(o.end,0,s.total)||o.end<=o.start||!number(o.x,0,limits.width)||!number(o.y,0,limits.height))return false;
 return true;
}
export function validProbe(width,height,duration) {
 return (!width || (width<=4096&&height<=4096&&width*height<=4096*4096)) && (!duration || duration<=3600);
}
