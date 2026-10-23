export const MAX_QUEUE = 8;
export const MAX_FILE_BYTES = 300 * 1024 * 1024;
export const MAX_JOB_BYTES = 600 * 1024 * 1024;
export const JOB_MS = 15 * 60_000;
const number = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const link = x => typeof x === 'string' && x.length <= 8192 && /^https:\/\//.test(x);
export function validJob(b) {
 const s=b?.spec;
 if (!s || s.width!==1080 || s.height!==1920 || s.fps!==30 || !number(s.total,0.05,180) || !link(b.output?.url) || b.output.contentType!=='video/mp4') return false;
 if (!/^[0-9a-f-]{36}$/i.test(b.meta?.who??'') || JSON.stringify(b.meta).length>2048) return false;
 if (!Array.isArray(s.segments)||s.segments.length<1||s.segments.length>40||!Array.isArray(s.sounds)||s.sounds.length>20||!Array.isArray(s.overlays)||s.overlays.length>200) return false;
 let pieces=0,len=0;
 for(const seg of s.segments){
  if(!link(seg.url)||!number(seg.speed,0.5,2)||!number(seg.gap,0,180)||!number(seg.volume,0,1)||!Array.isArray(seg.pieces)||!seg.pieces.length)return false;
  pieces+=seg.pieces.length;len+=seg.gap;
  for(const p of seg.pieces){if(!number(p.start,0,3600)||!number(p.end,p.start+0.01,3600))return false;len+=(p.end-p.start)/seg.speed;}
  if(seg.look?.keys && (!Array.isArray(seg.look.keys)||seg.look.keys.length>200))return false;
 }
 if(pieces>200||len>181||Math.abs(len-s.total)>1)return false;
 for(const a of s.sounds)if(!link(a.url)||!number(a.at,0,s.total)||!number(a.start,0,3600)||!number(a.dur,0.01,s.total)||!number(a.volume,0,1))return false;
 for(const o of s.overlays)if(!link(o.url)||!number(o.start,0,s.total)||!number(o.end,0,s.total)||o.end<=o.start||!number(o.x,0,1080)||!number(o.y,0,1920))return false;
 return true;
}
export function validProbe(width,height,duration) {
 return (!width || (width<=4096&&height<=4096&&width*height<=4096*4096)) && (!duration || duration<=3600);
}
