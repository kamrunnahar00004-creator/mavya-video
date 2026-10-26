"use client";
import { MediaVideo } from "@/components/media-video";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { uploadFile, waitRunSaves } from "@/lib/client";
import { pollDelay, waitForPoll } from "@/lib/polling";
import { exportLayers } from "@/lib/export-layers";
import { renderLimitError } from "@/lib/render-limits";
import { timeline, videoLength } from "@/lib/edit";
import { soundPieces } from "@/lib/sound";
import type { Run } from "@/lib/types";

type Done = { src: string; seconds: number; at: string };

/**
 * Export in the run header: draws the texts (text-png.ts), starts the render (POST /api/runs/[id]/export), shows
 * the progress on the button, then opens the finished video with Download. The video is also kept in My files.
 */
export function ExportButton({ run, beforeExport, ready, onToast, onDone }: { run: Run; beforeExport: () => Promise<void>; ready: boolean; onToast: (msg: string) => void; onDone: (x: Done) => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const [jobId,setJobId]=useState<string|null>(null);
  const blocked=useRef(false);
  const callback=useRef(onDone);
  const notify=useRef(onToast);
  useEffect(()=>{notify.current=onToast;},[onToast]);
  useEffect(()=>{callback.current=onDone;},[onDone]);
  useEffect(()=>{
    let stop=false;
    void fetch(`/api/runs/${run.id}/export`,{cache:"no-store",signal:AbortSignal.timeout(30_000)}).then(r=>r.ok?r.json():null).then(reply=>{
      if(!stop&&!blocked.current&&reply?.job){blocked.current=true;setProgress(0);setJobId(reply.job);}
    }).catch(()=>undefined);
    return ()=>{stop=true;};
  },[run.id]);
  useEffect(()=>{
    if(!jobId)return;
    let stop=false;
    const abort=new AbortController();
    void(async()=>{
      let failures=0;
      for(let i=0;i<400&&!stop;i++){
        await waitForPoll(pollDelay(2500,failures,document.hidden),abort.signal);
        if(stop)return;
        const response=await fetch(`/api/runs/${run.id}/export?job=${jobId}`,{cache:"no-store",signal:AbortSignal.timeout(30_000)}).catch(()=>null);
        const reply=await response?.json().catch(()=>null);
        if(stop)return;
        if(reply?.state==="done"&&reply.export){
          setProgress(null);setJobId(null);blocked.current=false;setDone(reply.export);callback.current(reply.export);return;
        }
        if(reply?.state==="failed"||response?.status===404){setProgress(null);setJobId(null);blocked.current=false;notify.current(reply?.error??"The export failed. Try again.");return;}
        failures=response?.ok?0:failures+1;
        if(typeof reply?.progress==="number")setProgress(previous=>Math.max(previous??0,0.02,Math.min(1,reply.progress)));
      }
      if(!stop){setProgress(null);setJobId(null);blocked.current=false;notify.current("This is taking too long. Reopen this run to continue.");}
    })();
    return ()=>{stop=true;abort.abort();};
  },[jobId,run.id]);

  async function start() {
    if(blocked.current)return;
    blocked.current=true;setProgress(0);
    try{
      await beforeExport();
      if(!(await waitRunSaves(run.id)))throw Error("Couldn't save your changes. Try again.");
      const response=await fetch(`/api/runs/${run.id}`,{cache:"no-store",signal:AbortSignal.timeout(30_000)});
      if(!response.ok)throw Error("Couldn't load the saved run.");
      const snapshot=await response.json() as Run;
      const segments=timeline(snapshot,null).filter(s=>s.src),total=videoLength(segments);
      const bounds=renderLimitError(segments,exportLayers(snapshot).length,soundPieces(snapshot,total).length,total);
      if(bounds)throw Error(bounds);
      const {textPng}=await import("@/lib/text-png");
      const manifest=[];
      // Draw/upload one at a time, avoiding 200 simultaneous full-resolution canvases.
      for(const t of exportLayers(snapshot)){
        const drawn=await textPng(t);
        if(!drawn)throw Error("A text image could not be drawn.");
        const blob=await (await fetch(drawn.png)).blob();
        const uploaded=await uploadFile(new File([blob],"text.png",{type:"image/png"}),false,"export-text");
        manifest.push({id:t.id,mediaId:uploaded.mediaId,x:drawn.x,y:drawn.y});
      }
      const sent=await fetch(`/api/runs/${run.id}/export`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({snapshot:snapshot.updatedAt,texts:manifest}),signal:AbortSignal.timeout(60_000)});
      const reply=await sent.json().catch(()=>null);
      if(!sent.ok||!reply?.job)throw Error(reply?.error??"Couldn't start the export. Try again.");
      if(alive.current)setJobId(reply.job);
    }catch(error){
      blocked.current=false;
      if(alive.current){setProgress(null);onToast(error instanceof Error?error.message:"Couldn't start the export. Try again.");}
    }
  }

  const busy = progress !== null;
  const name = (run.title && run.title !== "Untitled run" ? run.title : "mavya-video").replace(/[^\w -]/g, "").trim().slice(0, 60) || "mavya-video";
  return (
    <>
      <button
        type="button"
        disabled={!ready || busy}
        title={ready ? undefined : "Generate the hook and add a demo first"}
        onClick={() => void start()}
        className="btn-primary ml-1 min-w-[112px] px-4 py-2 text-[14px] tabular-nums"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {busy ? (progress > 0.03 ? `${Math.round(progress * 100)}%` : "Exporting") : "Export"}
      </button>
      {done && (
        <div role="dialog" aria-modal="true" aria-labelledby="export-title" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setDone(null)}>
          <div className="fade-in flex max-h-full w-full max-w-[380px] flex-col rounded-2xl bg-panel p-5 shadow-[0_24px_64px_rgba(15,23,42,0.35)]">
            <div className="flex items-center justify-between">
              <h2 id="export-title" className="text-[17px] font-bold">Your video</h2>
              <button type="button" onClick={() => setDone(null)} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-text" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <MediaVideo src={done.src} controls autoPlay playsInline className="mt-4 aspect-[9/16] max-h-[60vh] w-full rounded-xl bg-black object-contain" />
            <a href={`${done.src}?download=${encodeURIComponent(name)}`} download className="btn-primary mt-4 w-full py-2.5 text-[14px]">
              <Download className="h-4 w-4" />
              Download
            </a>
          </div>
        </div>
      )}
    </>
  );
}
