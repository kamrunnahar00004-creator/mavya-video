"use client";

import { useRef, useState } from "react";
import { ArrowUp, Globe, Loader2, Plus, Sparkles, X } from "lucide-react";
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

/**
 * Step 1 "Your product": the website goes in (paste or Analyze, both explicit; it runs Gemini) and is read in the
 * background. Under it, an optional box for the seller's own words, photos and videos; the step stays open until they
 * open step 2. Send (an explicit click) saves the box and, when a clip is picked, rewrites the script.
 */
export function ProductStep({ product, reading, host, error, failedUrl, onAnalyze, notes = "", files = [], writing = false, onAddFiles, onRemoveFile, onSend, onSave }: {
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
  /** Keep the typed notes (no AI). */
  onSave: (notes: string) => void;
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
            rows={7}
            maxLength={2000}
            onChange={(e) => { setText(e.target.value); setDirty(true); }}
            // Leaving the box keeps what was typed (no AI); Send is what rewrites the script.
            onBlur={() => onSave(text)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && dirty) { e.preventDefault(); onSend(text); setDirty(false); }
            }}
            aria-label="About your product (optional)"
            placeholder={"(Optional)\nDescribe your product in one sentence:\n\nWho's it for?\n\nWhich feature should the video show off?"}
            // Inline: the global :focus-visible outline and textarea background would otherwise cut across the box's border.
            style={{ outline: "none", background: "transparent" }}
            className="block w-full resize-none rounded-t-2xl px-4 pt-3 text-[14.5px] leading-relaxed placeholder:text-soft"
          />
          <div className="flex items-center justify-between px-2.5 pb-2.5">
            <span className="group/add relative">
              <button type="button" onClick={() => picker.current?.click()} disabled={adding || files.length >= 5} aria-label="Add a screenshot or a screen recording" className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted hover:border-accent hover:text-accent disabled:opacity-50">
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
              <span role="tooltip" className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[12px] font-semibold text-white opacity-0 transition-opacity group-hover/add:opacity-100 group-focus-within/add:opacity-100">
                A screenshot or a screen recording of your product
              </span>
            </span>
            <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" multiple className="hidden" onChange={(e) => void addFiles(e.target.files).then(() => (e.target.value = ""))} />
            <button type="button" onClick={() => { onSend(text); setDirty(false); }} disabled={!dirty || writing || reading} aria-label="Send" title="Send" className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white hover:opacity-90 disabled:opacity-35">
              {writing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {fileError && <p role="alert" className="text-[13px] font-semibold text-red-600">{fileError}</p>}
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
