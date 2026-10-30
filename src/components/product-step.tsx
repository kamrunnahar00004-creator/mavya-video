"use client";

import { useRef, useState } from "react";
import { ArrowRight, ArrowUp, Globe, ImagePlus, Loader2, Plus, Sparkles, X } from "lucide-react";
import type { Run } from "@/lib/types";


async function post(url: string, body?: unknown): Promise<{ run?: Run; error?: string; status?: number }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const data = (await res.json().catch(() => null)) as (Run & { error?: string }) | null;
    if (!res.ok || !data) return { error: data?.error ?? "Something went wrong. Try again.", status: res.status };
    return { run: data };
  } catch {
    return { error: "Couldn't reach Mavya. Check your connection." };
  }
}

/** Read the site into a brief. A 409 means the run moved under the request (before migration 0017): try once more. */
export async function readProduct(runId: string, url: string): Promise<{ run?: Run; error?: string }> {
  const first = await post(`/api/runs/${runId}/product`, { url });
  return first.status === 409 ? post(`/api/runs/${runId}/product`, { url }) : first;
}

/** Three new hook lines for this product (Regenerate on the hook text), avoiding the ones already seen. */
export async function newHookLines(runId: string, avoid: string[]): Promise<{ run?: Run; error?: string }> {
  const first = await post(`/api/runs/${runId}/hook-text`, { avoid });
  return first.status === 409 ? post(`/api/runs/${runId}/hook-text`, { avoid }) : first;
}

/** Write the script and demo shot plan for this product and hook. Same single retry on 409. */
export async function writeScript(runId: string): Promise<{ run?: Run; error?: string }> {
  const first = await post(`/api/runs/${runId}/script`);
  return first.status === 409 ? post(`/api/runs/${runId}/script`) : first;
}

const FILE_TYPES = /^(image\/(png|jpeg|webp)|video\/(mp4|quicktime|webm))$/;
const VIDEO_MAX = 12 * 1024 * 1024;
/** Hints: each starts a line in the box (the last one opens the file picker). */
const STARTERS = [
  { label: "Who is it for?", text: "It's for " },
  { label: "The one thing it does", text: "The one thing it does: " },
  { label: "What to show in the video", text: "In the video, show " },
];

/**
 * Step 1 "Your product": the website goes in (paste or Analyze, both explicit; it runs Gemini) and is read in the
 * background. Under it, an optional box for the seller's own words, photos and videos. The step stays open until
 * "Steal a hook that already works". Send (an explicit click) saves the box and, when a clip is picked, rewrites the script.
 */
export function ProductStep({ product, reading, host, error, failedUrl, onAnalyze, notes = "", files = [], writing = false, onAddFiles, onRemoveFile, onSend, onContinue }: {
  product: Run["product"] | null;
  reading: boolean;
  /** The site being read (shown while there is no brief yet). */
  host?: string;
  error: string | null;
  failedUrl?: string;
  onAnalyze: (url: string) => void;
  /** The seller's own words about the product (saved). */
  notes?: string;
  /** Photos and short videos of the product (media ids), up to 5. */
  files?: string[];
  /** The script is being rewritten after Send. */
  writing?: boolean;
  onAddFiles: (files: File[]) => Promise<void>;
  onRemoveFile: (mediaId: string) => void;
  onSend: (notes: string) => void;
  onContinue: (notes: string) => void;
}) {
  const [url, setUrl] = useState(failedUrl ?? product?.url ?? "");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(notes);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const analyze = (value = url) => {
    if (!value.trim() || reading) return;
    setEditing(false);
    onAnalyze(value.trim());
  };

  const addFiles = async (list: FileList | null) => {
    const all = [...(list ?? [])];
    const ok = all.filter((f) => FILE_TYPES.test(f.type) && (!f.type.startsWith("video/") || f.size <= VIDEO_MAX)).slice(0, 5 - files.length);
    if (!ok.length) return setFileError(all.some((f) => f.type.startsWith("video/")) ? "Videos up to 12 MB." : "Use photos (PNG, JPG) or videos (MP4, MOV).");
    setFileError(null);
    setAdding(true);
    try {
      await onAddFiles(ok);
      setDirty(true);
    } catch {
      setFileError("Couldn't upload. Try again.");
    } finally {
      setAdding(false);
    }
  };

  const start = (line: string) => {
    const next = text.trim() ? `${text.trimEnd()}\n${line}` : line;
    setText(next);
    setDirty(true);
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.length, next.length);
    });
  };

  const brief = product?.brief;
  if ((brief || reading) && !editing && !error) {
    return (
      // The rest of the brief (audience, wow moment, features) is kept for the script and demo plan, not shown.
      <div className="space-y-3">
        <div className="flex items-center gap-4 rounded-2xl border border-line bg-panel p-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent">
            {reading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Globe className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold">{reading ? host : brief?.name}</p>
            {!reading && <p className="truncate text-[13.5px] text-muted">{brief?.oneLiner}</p>}
          </div>
          {!reading && (
            <button type="button" onClick={() => setEditing(true)} className="rounded-lg px-3 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint">
              Change
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-line-strong bg-panel focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {files.map((id) => (
                <span key={id} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-line bg-raised">
                  {/\.(mp4|mov|webm)$/i.test(id) ? (
                    <video src={`/api/media/${id}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/media/${id}`} alt="" className="h-full w-full object-cover object-top" />
                  )}
                  <button type="button" onClick={() => { onRemoveFile(id); setDirty(true); }} aria-label="Remove file" className="absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                    <X className="h-4 w-4" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={box}
            value={text}
            rows={3}
            maxLength={2000}
            onChange={(e) => { setText(e.target.value); setDirty(true); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && dirty) { e.preventDefault(); onSend(text); setDirty(false); }
            }}
            aria-label="About your product (optional)"
            placeholder={"Tell Mavya about your product (optional)\ne.g. It's for gym beginners. Snap a photo of your meal, get the calories in 2 seconds."}
            className="block w-full resize-none bg-transparent px-4 pt-3 text-[14.5px] leading-relaxed outline-none placeholder:text-soft"
          />
          <div className="flex items-center justify-between px-2.5 pb-2.5">
            <button type="button" onClick={() => picker.current?.click()} disabled={adding || files.length >= 5} aria-label="Add photos or videos" title="Add photos or videos" className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted hover:border-accent hover:text-accent disabled:opacity-50">
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </button>
            <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" multiple className="hidden" onChange={(e) => void addFiles(e.target.files).then(() => (e.target.value = ""))} />
            <button type="button" onClick={() => { onSend(text); setDirty(false); }} disabled={!dirty || writing || reading} aria-label="Send" title="Send" className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white hover:opacity-90 disabled:opacity-35">
              {writing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <button key={s.label} type="button" onClick={() => start(s.text)} className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-muted hover:border-accent hover:text-accent">
              {s.label}
            </button>
          ))}
          <button type="button" onClick={() => picker.current?.click()} disabled={adding || files.length >= 5} title="A screenshot or screen recording of exactly the feature you're selling" className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-muted hover:border-accent hover:text-accent disabled:opacity-50">
            <ImagePlus className="h-3.5 w-3.5" />
            Screenshot of your main feature
          </button>
        </div>
        {fileError && <p role="alert" className="text-[13px] font-semibold text-red-600">{fileError}</p>}

        <button type="button" onClick={() => { onContinue(text); setDirty(false); }} className="btn-primary px-4 py-2.5 text-[14px]">
          Steal a hook that already works
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        analyze();
      }}
      className="rounded-2xl border border-line bg-panel p-4"
    >
      <label htmlFor="product-url" className="text-[13.5px] font-semibold">
        Your app or website
      </label>
      <div className="mt-2 flex flex-wrap gap-2.5">
        <input
          id="product-url"
          type="text"
          inputMode="url"
          autoComplete="url"
          value={url}
          disabled={reading}
          onChange={(e) => setUrl(e.target.value)}
          onPaste={(e) => {
            // Pasting a whole link is the action: read it right away, no extra click.
            const pasted = e.clipboardData.getData("text").trim();
            if (!url.trim() && /^(https?:\/\/)?[^\s/]+\.[^\s]{2,}$/i.test(pasted)) {
              e.preventDefault();
              setUrl(pasted);
              analyze(pasted);
            }
          }}
          placeholder="yourapp.com"
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-panel px-3 py-2.5 text-[14.5px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
        />
        <button type="submit" disabled={!url.trim() || reading} className="btn-primary px-4 py-2.5 text-[14px] disabled:opacity-50">
          {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Analyze
        </button>
        {editing && (
          <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 text-[14px] font-semibold text-muted hover:text-text">
            Cancel
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-600">{error}</p>}
    </form>
  );
}
