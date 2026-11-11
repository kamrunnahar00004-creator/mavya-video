import { after } from "next/server";
import { exportLayers, exportWindow } from "@/lib/export-layers";
import { billingRpc } from "@/lib/server/billing-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { advanceExport, cancelBrowserExport, exportJob } from "@/lib/server/export-jobs";
import { randomUUID } from "node:crypto";
import { fullAdjust } from "@/lib/adjust";
import { segSpeed, timeline, videoLength } from "@/lib/edit";
import { cloud, getRun, libraryLink, mediaAccess, mediaLink, mediaUploadLink, newUpload } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";
import { exportSource, masterKey, masterReady, requestPreview } from "@/lib/server/previews";
import { copyEta } from "@/lib/copy-eta";
import { signedGet, signedPut } from "@/lib/server/r2";
import { pieceEnd, soundPieces } from "@/lib/sound";
import { RENDER_LIMITS, renderLimitError } from "@/lib/render-limits";
import { demoAt, planLength } from "../../../../../../render/render.mjs";

export const maxDuration = 300;
// 720p: every source is 720p (Kling, library hooks); 1080p only added render time (founder 2026-10-24: as fast as possible).
const { width: W, height: H, fps: FPS } = RENDER_LIMITS;
const LINK_SECONDS = 6 * 3600;
const renderer = () => (process.env.RENDER_URL && process.env.RENDER_SECRET ? { url: process.env.RENDER_URL.replace(/\/+$/, ""), secret: process.env.RENDER_SECRET } : null);

/** A link the render server can download a run's file from (null when it is not this user's; "wait" while a demo
 *  clip's working copy is still being made). */
async function inputLink(src: string, who: string, origin: string, working = false): Promise<string | null | "wait"> {
  const media = /^\/api\/media\/([^/?#]+)$/.exec(src);
  if (media) {
    if (!(await mediaAccess(media[1], who))) return null;
    // Demo clips: the 1080p working copy (src/lib/server/previews.ts exportSource: tone-mapped for HDR uploads).
    if (working) {
      const from = await exportSource(media[1]).catch(() => "wait" as const);
      return from === "copy" ? signedGet(masterKey(media[1]), LINK_SECONDS) : "wait";
    }
    return mediaLink(media[1], LINK_SECONDS);
  }
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
  const body = await request.json().catch(()=>null) as {snapshot?:unknown;mode?:unknown;job?:unknown;size?:unknown;demoSize?:unknown;encoder?:unknown;texts?:{id?:unknown;mediaId?:unknown;x?:unknown;y?:unknown}[]} | null;
  if (body?.mode === "cancel") {
    // A browser export whose upload failed: end its job now, so Export works again at once (instead of after the
    // 15 minute wait in advanceExport). The browser still has the video.
    if (typeof body.job !== "string" || !/^[0-9a-f-]{36}$/i.test(body.job)) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ state: await cancelBrowserExport(who, id, body.job) });
  }
  if (!run.hook.generated) return Response.json({ error: "Generate the hook first." }, { status: 400 });
  const sourceSegments = timeline(run, null).filter(s => s.src);
  const bounds = renderLimitError(sourceSegments, exportLayers(run).length, soundPieces(run, videoLength(sourceSegments)).length, videoLength(sourceSegments));
  if (bounds) return Response.json({ error: bounds }, { status: 400 });

  const existing = await exportJob(who, id);
  if (existing) return Response.json({job:existing.id});
  // Browser export (src/lib/browser-export.ts): mode "sources" returns the job's spec (the same segments and sounds
  // the server would render) so the browser can render it; mode "local" then reserves the job for the finished file
  // the browser uploads (texts are drawn into it, so none are sent).
  const mode = body?.mode === "sources" || body?.mode === "local" ? body.mode : null;
  // The browser's finished file: its exact size is signed into the upload link (at most what the worker accepts).
  const size = typeof body?.size === "number" && Number.isInteger(body.size) && body.size > 0 && body.size <= 300 * 1024 * 1024 ? body.size : null;
  if (mode === "local" && !size) return Response.json({ error: "The video is too large to save." }, { status: 400 });
  if(body?.snapshot!==run.updatedAt || (!mode && !Array.isArray(body.texts)) || (body.texts?.length ?? 0)>RENDER_LIMITS.overlays) return Response.json({error:"Your run changed. Save and try again."},{status:409});
  const texts=mode?[]:body.texts!;
  const expected=exportLayers(run);
  if(!mode && (texts.length!==expected.length || new Set(texts.map(t=>t?.id)).size!==texts.length || expected.some(t=>!texts.some(p=>p?.id===t.id))))return Response.json({error:"Text images are incomplete. Try again."},{status:400});
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
  const edited = videoLength(segs);
  if (!segs.length || edited <= 0) return Response.json({ error: "Nothing to export yet." }, { status: 400 });
  if (edited > RENDER_LIMITS.seconds) return Response.json({ error: "Videos can be up to 3 minutes." }, { status: 400 });

  const segments = [];
  // Every link at once (one by one took seconds for a 10-clip video). The hook always exports from its own file (it
  // stays exactly as generated).
  const links = await Promise.all(segs.map((s) => inputLink(s.src!, who, origin, s.id !== "hook")));
  if (links.includes("wait")) return Response.json({ error: "Your clips are still being prepared. Try again in a minute." }, { status: 409 });
  for (const [i, s] of segs.entries()) {
    const url = links[i] as string | null;
    if (!url) return Response.json({ error: `A clip in "${s.label}" can't be found. Upload it again.` }, { status: 400 });
    const a = fullAdjust(s.adjust);
    segments.push({
      url,
      gap: s.gap,
      speed: segSpeed(s),
      volume: s.editable ? a.volume / 100 : 0,
      look: s.editable ? { brightness: a.brightness, contrast: a.contrast, saturation: a.saturation, warmth: a.warmth, zoom: a.zoom, panX: a.panX, panY: a.panY, flip: a.flip, keys: a.keys } : null,
      // A piece of a Cut clip with its own settings carries its own look and sound (Speed is the clip's).
      pieces: s.parts.map((p) => {
        if (!s.editable || !p.adjust) return { start: p.start, end: p.end };
        const own = fullAdjust({ ...s.adjust, ...p.adjust });
        return { start: p.start, end: p.end, volume: own.volume / 100, look: { brightness: own.brightness, contrast: own.contrast, saturation: own.saturation, warmth: own.warmth, zoom: own.zoom, panX: own.panX, panY: own.panY, flip: own.flip, keys: own.keys } };
      }),
    });
  }

  // The export's own length (whole planned frames), so the picture and the sound end together (render.mjs planLength).
  const total = planLength({ fps: FPS, segments });
  const pieces = soundPieces(run, total);
  const sounds = [];
  const soundLinks = await Promise.all(pieces.map((p, i) => (pieceEnd(pieces, i, total) - p.at < 0.05 || p.volume <= 0 ? null : inputLink(p.src, who, origin))));
  for (const [i, p] of pieces.entries()) {
    const end = pieceEnd(pieces, i, total);
    if (end - p.at < 0.05 || p.volume <= 0) continue;
    const url = soundLinks[i];
    if (url && url !== "wait") sounds.push({ url, at: p.at, dur: end - p.at, start: p.start, volume: p.volume / 100 });
  }

  if (mode === "sources") return Response.json({ spec: { width: W, height: H, fps: FPS, total, segments, sounds, overlays: [] } }, { headers: { "Cache-Control": "no-store" } });
  const overlays=[];
  for(const t of texts){
    if(typeof t.x!=="number"||typeof t.y!=="number"||!Number.isFinite(t.x)||!Number.isFinite(t.y)||t.x<0||t.x>W||t.y<0||t.y>H)return Response.json({error:"Invalid text position."},{status:400});
    const layer=expected.find(x=>x.id===t.id)!;
    // Nothing left of it inside the export's whole frames: left out (exportWindow).
    const at=exportWindow(layer,total);
    if(!at)continue;
    overlays.push({url:await mediaLink(t.mediaId as string,LINK_SECONDS),start:at.start,end:at.end,owner:layer.owner,x:t.x,y:t.y});
  }
  const {mediaId}=newUpload("video/mp4"), job=randomUUID();
  // The demo part (after the hook) is saved as its own clip too (My files, Demos): its own file id.
  const spec={width:W,height:H,fps:FPS,total,segments,sounds,overlays};
  const at=demoAt(spec), demoMedia=at!==null?newUpload("video/mp4").mediaId:null;
  // Browser export: which picture setting the user's browser used and the rate it reached (browser-export.ts), to check
  // production files (Codex 2026-11-05).
  const encoder=mode==="local"&&typeof body?.encoder==="string"&&/^[\w .-]{1,80}$/.test(body.encoder)?body.encoder:null;
  // The demo's texts, as placed in it (My files lists each demo once: same clips and same texts = same demo).
  const demoTexts=demoMedia?JSON.stringify(expected.filter(t=>t.end>at!+0.05).map(t=>({...t,id:undefined,owner:undefined,start:Math.round((t.start-at!)*100)/100,end:Math.round((t.end-at!)*100)/100}))).slice(0,20000):null;
  const meta={who,runId:id,mediaId,seconds:Math.round(total*10)/10,...(encoder?{encoder}:{}),...(demoMedia?{demoMediaId:demoMedia,demoSeconds:Math.round((total-at!)*10)/10,demoTexts}:{})};
  const demoSize=typeof body?.demoSize==="number"&&Number.isInteger(body.demoSize)&&body.demoSize>0&&body.demoSize<=300*1024*1024?body.demoSize:null;
  const payload={id:job,spec,output:{url:await mediaUploadLink(mediaId,"video/mp4",LINK_SECONDS),contentType:"video/mp4"},meta,
    ...(demoMedia&&mode!=="local"?{demo:{url:await mediaUploadLink(demoMedia,"video/mp4",LINK_SECONDS),contentType:"video/mp4"}}:{}),
    ...(demoMedia&&mode==="local"&&demoSize?{demoUpload:{key:`exports/${job}/demo.mp4`,size:demoSize}}:{}),...(mode==="local"?{lane:"browser",laneAt:Date.now(),upload:{key:`exports/${job}/upload.mp4`,size:size!}}:{})};
  const reserved=await billingRpc<boolean>("mavya_reserve_export",{p_user:who,p_run:id,p_expected:run.updatedAt,p_id:job,p_media:mediaId,p_payload:payload,p_overlays:ids});
  if(!reserved)return Response.json({error:"Your run changed. Try again."},{status:409});
  after(async()=>{try{await advanceExport(who,job);}catch(error){console.error("export worker",job,error);}});
  // The browser gets a short, single-size link to a staging key, never the job's own file (advanceExport checks the
  // upload and copies it there).
  return Response.json(mode==="local"?{job,upload:await signedPut(`exports/${job}/upload.mp4`,"video/mp4",900,size!),...(payload.demoUpload?{demoUpload:await signedPut(payload.demoUpload.key,"video/mp4",900,payload.demoUpload.size)}:{})}:{job});
}

export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]/export">) {
  const {id}=await ctx.params,who=await currentUser();
  if(!who)return signInFirst();
  const params=new URL(request.url).searchParams;
  // ?copies=<id>,<id>: which of these uploaded clips still have no working copy, and about how long until they all
  // do (copy-eta.ts). The Export button waits on this before it can be clicked (founder 2026-11-11). The ids come
  // from the editor (its clips, saved or not); only the user's own files are looked at, and each missing copy is asked
  // for again.
  const copies=params.get("copies");
  if(copies!==null){
    const ids=[...new Set(copies.split(",").filter(Boolean))];
    if(ids.length>50||ids.some(x=>!/^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i.test(x)))return Response.json({error:"Not found"},{status:404});
    // Local development has no copies (the export reads the files themselves); only videos get one.
    if(!cloud())return Response.json({pending:0,seconds:0},{headers:{"Cache-Control":"no-store"}});
    const missing=(await Promise.all(ids.map(async x=>(await mediaAccess(x,who))?.mime.startsWith("video/")&&!(await masterReady(x))?x:null))).filter((x):x is string=>Boolean(x));
    if(!missing.length)return Response.json({pending:0,seconds:0},{headers:{"Cache-Control":"no-store"}});
    await Promise.all(missing.map(x=>requestPreview(x)));
    const {data,error}=await createSupabaseAdminClient().from("media").select("id,size,created_at").eq("user_id",who).in("id",missing);
    if(error)throw error;
    const now=Date.now();
    const pending=missing.map(x=>{const row=data?.find(r=>r.id===x);return {size:Number(row?.size??0),uploadedAt:row?.created_at?Date.parse(row.created_at):now};});
    return Response.json({pending:missing.length,seconds:copyEta(pending,now)},{headers:{"Cache-Control":"no-store"}});
  }
  const key=params.get("job");
  if(key&&!/^[0-9a-f-]{36}$/i.test(key))return Response.json({error:"Not found"},{status:404});
  const job=await exportJob(who,id,key??undefined);
  if(!job)return key?Response.json({error:"Not found"},{status:404}):Response.json({state:"idle"});
  if(["pending","running"].includes(job.state)||!job.cleaned)after(async()=>{try{await advanceExport(who,job.id);}catch(error){console.error("export recovery",job.id,error);}});
  return Response.json({job:job.id,state:job.state==="done"?"done":job.state==="failed"?"failed":"running",progress:job.progress,export:job.result,error:job.state==="failed"?"The export failed. Try again.":undefined});
}
