"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { flushRunSaves, saveStateOf, subscribeSaves } from "@/lib/client";
import { textPng } from "@/lib/text-png";
import type { Run, TextLayer } from "@/lib/types";

type Done = { src: string; seconds: number; at: string };

/** Waits for this run's pending edits to reach the server (the export reads the saved run). */
function saved(id: string): Promise<void> {
  flushRunSaves();
  return new Promise((resolve) => {
    const check = () => {
      if (saveStateOf(id) !== "saving") {
        stop();
        resolve();
      }
    };
    const stop = subscribeSaves(check);
    check();
  });
}

/**
 * Export in the run header: draws the texts (text-png.ts), starts the render (POST /api/runs/[id]/export), shows
 * the progress on the button, then opens the finished video with Download. The video is also kept in My files.
 */
export function ExportButton({ run, texts, ready, onToast, onDone }: { run: Run; texts: TextLayer[]; ready: boolean; onToast: (msg: string) => void; onDone: (x: Done) => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function start() {
    setProgress(0);
    const fail = (msg: string) => {
      if (!alive.current) return;
      setProgress(null);
      onToast(msg);
    };
    try {
      await saved(run.id);
      const shown = texts.filter((t) => t.text.trim() && t.end > t.start);
      let pngs: { png: string; start: number; end: number }[];
      try {
        pngs = await Promise.all(shown.map(async (t) => ({ png: await textPng(t), start: t.start, end: t.end })));
      } catch {
        return fail("This browser can't draw the texts. Export in Chrome, Edge or Firefox.");
      }
      const res = await fetch(`/api/runs/${run.id}/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texts: pngs }) });
      const job = (await res.json().catch(() => null)) as { job?: string; error?: string } | null;
      if (!res.ok || !job?.job) return fail(job?.error ?? "Couldn't start the export. Try again.");
      for (let i = 0; i < 400 && alive.current; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const s = (await fetch(`/api/runs/${run.id}/export?job=${job.job}`, { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null)) as { state?: string; progress?: number; error?: string; export?: Done } | null;
        if (s?.state === "failed") return fail(s.error ?? "The export failed. Try again.");
        if (s?.state === "done" && s.export) {
          if (!alive.current) return;
          setProgress(null);
          setDone(s.export);
          onDone(s.export);
          return;
        }
        if (typeof s?.progress === "number") setProgress(Math.max(0.02, s.progress));
      }
      fail("This is taking too long. Try again.");
    } catch {
      fail("Couldn't start the export. Try again.");
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
            <video src={done.src} controls autoPlay playsInline className="mt-4 aspect-[9/16] max-h-[60vh] w-full rounded-xl bg-black object-contain" />
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
