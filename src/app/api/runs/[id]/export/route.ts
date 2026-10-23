import { after } from "next/server";
import { exportLayers } from "@/lib/export-layers";
import { billingRpc } from "@/lib/server/billing-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { advanceExport, exportJob } from "@/lib/server/export-jobs";
import { randomUUID } from "node:crypto";
import { fullAdjust } from "@/lib/adjust";
import { segSpeed, timeline, videoLength } from "@/lib/edit";
import { cloud, getRun, libraryLink, mediaAccess, mediaLink, mediaUploadLink, newUpload } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";
import { pieceEnd, soundPieces } from "@/lib/sound";

export const maxDuration = 300;
const W = 1080, H = 1920, FPS = 30, LINK_SECONDS = 6 * 3600;
const renderer = () => (process.env.RENDER_URL && process.env.RENDER_SECRET ? { url: process.env.RENDER_URL.replace(/\/+$/, ""), secret: process.env.RENDER_SECRET } : null);

/** A link the render server can download a run's file from (null when it is not this user's). */
async function inputLink(src: string, who: string, origin: string): Promise<string | null> {
  const media = /^\/api\/media\/([^/?#]+)$/.exec(src);
  if (media) return (await mediaAccess(media[1], who)) ? mediaLink(media[1], LINK_SECONDS) : null;
  const sound = /^\/api\/sounds\/([A-Za-z0-9_-]+)$/.exec(src);
  if (sound) return libraryLink("audio", sound[1], LINK_SECONDS);
  // Files that ship with the app (public/).
  if (/^\/(samples|landing|characters)\//.test(src)) return `${origin}${src}`;
  return null;
}

export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/export">) {
  const { id } = await ctx.params;
  const who = await currentUser();
  if (!who) return signInFirst();
  const render = renderer();
  if (!cloud() || !render) return Response.json({ error: "Export is not connected yet." }, { status: 503 });
  const run = await getRun(id, who);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  if (!run.hook.generated) return Response.json({ error: "Generate the hook first." }, { status: 400 });

  const existing = await exportJob(who, id);
  if (existing) return Response.json({job:existing.id});
  const body = await request.json().catch(()=>null) as {snapshot?:unknown;texts?:{id?:unknown;mediaId?:unknown;x?:unknown;y?:unknown}[]} | null;
  if(body?.snapshot!==run.updatedAt || !Array.isArray(body.texts) || body.texts.length>200) return Response.json({error:"Your run changed. Save and try again."},{status:409});
  const texts=body.texts;
  const expected=exportLayers(run);
  if(texts.length!==expected.length || new Set(texts.map(t=>t?.id)).size!==texts.length || expected.some(t=>!texts.some(p=>p?.id===t.id)))return Response.json({error:"Text images are incomplete. Try again."},{status:400});
  const ids=texts.map(t=>typeof t.mediaId==="string"?t.mediaId:"");
  if(new Set(ids).size!==ids.length)return Response.json({error:"Invalid text images."},{status:400});
  if(ids.length){
    const db=createSupabaseAdminClient();
    const [owned,uploads]=await Promise.all([
      db.from("media").select("id").eq("user_id",who).eq("mime","image/png").lte("size",3_000_000).in("id",ids),
      db.from("upload_reservations").select("media_id").eq("user_id",who).eq("temporary",true).eq("state","done").in("media_id",ids)
    ]);
    if(owned.error||uploads.error)throw owned.error??uploads.error;
    if(owned.data.length!==ids.length||uploads.data.length!==ids.length)return Response.json({error:"Text images expired. Try again."},{status:400});
  }
  const origin = new URL(request.url).origin;
  const segs = timeline(run, null).filter((s) => s.src);
  const total = videoLength(segs);
  if (!segs.length || total <= 0) return Response.json({ error: "Nothing to export yet." }, { status: 400 });
  if (total > 180) return Response.json({ error: "Videos can be up to 3 minutes." }, { status: 400 });

  const segments = [];
  for (const s of segs) {
    const url = await inputLink(s.src!, who, origin);
    if (!url) return Response.json({ error: `A clip in "${s.label}" can't be found. Upload it again.` }, { status: 400 });
    const a = fullAdjust(s.adjust);
    segments.push({
      url,
      gap: s.gap,
      speed: segSpeed(s),
      volume: s.editable ? a.volume / 100 : 0,
      look: s.editable ? { brightness: a.brightness, contrast: a.contrast, saturation: a.saturation, warmth: a.warmth, zoom: a.zoom, panX: a.panX, panY: a.panY, flip: a.flip, keys: a.keys } : null,
      pieces: s.parts.map((p) => ({ start: p.start, end: p.end })),
    });
  }

  const pieces = soundPieces(run, total);
  const sounds = [];
  for (const [i, p] of pieces.entries()) {
    const end = pieceEnd(pieces, i, total);
    if (end - p.at < 0.05 || p.volume <= 0) continue;
    const url = await inputLink(p.src, who, origin);
    if (url) sounds.push({ url, at: p.at, dur: end - p.at, start: p.start, volume: p.volume / 100 });
  }

  const overlays=[];
  for(const t of texts){
    if(typeof t.x!=="number"||typeof t.y!=="number"||!Number.isFinite(t.x)||!Number.isFinite(t.y)||t.x<0||t.x>W||t.y<0||t.y>H)return Response.json({error:"Invalid text position."},{status:400});
    const layer=expected.find(x=>x.id===t.id)!;
    overlays.push({url:await mediaLink(t.mediaId as string,LINK_SECONDS),start:Math.max(0,layer.start),end:Math.min(total,layer.end),x:t.x,y:t.y});
  }
  const {mediaId}=newUpload("video/mp4"), job=randomUUID();
  const meta={who,runId:id,mediaId,seconds:Math.round(total*10)/10};
  const payload={id:job,spec:{width:W,height:H,fps:FPS,total,segments,sounds,overlays},output:{url:await mediaUploadLink(mediaId,"video/mp4",LINK_SECONDS),contentType:"video/mp4"},meta};
  const reserved=await billingRpc<boolean>("mavya_reserve_export",{p_user:who,p_run:id,p_expected:run.updatedAt,p_id:job,p_media:mediaId,p_payload:payload,p_overlays:ids});
  if(!reserved)return Response.json({error:"Your run changed. Try again."},{status:409});
  after(async()=>{try{await advanceExport(who,job);}catch(error){console.error("export worker",job,error);}});
  return Response.json({job});
}

export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]/export">) {
  const {id}=await ctx.params,who=await currentUser();
  if(!who)return signInFirst();
  const key=new URL(request.url).searchParams.get("job");
  if(key&&!/^[0-9a-f-]{36}$/i.test(key))return Response.json({error:"Not found"},{status:404});
  const job=await exportJob(who,id,key??undefined);
  if(!job)return key?Response.json({error:"Not found"},{status:404}):Response.json({state:"idle"});
  if(["pending","running"].includes(job.state)||!job.cleaned)after(async()=>{try{await advanceExport(who,job.id);}catch(error){console.error("export recovery",job.id,error);}});
  return Response.json({job:job.id,state:job.state==="done"?"done":job.state==="failed"?"failed":"running",progress:job.progress,export:job.result,error:job.state==="failed"?"The export failed. Try again.":undefined});
}
