"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, Download, Expand, ImageIcon, Library, Loader2, Music, Plus, Trash2, Video } from "lucide-react";
import { fmtDate, type Asset } from "@/lib/types";
import { uploadFile } from "@/lib/client";

type Tab = "video" | "image" | "music";

export function LibraryPanel({
  open,
  onToggle,
  useLabel,
  onUse,
  refreshKey,
}: {
  open: boolean;
  onToggle: () => void;
  /** When a step is waiting for a clip, each item gets a "Use" button. */
  useLabel?: string;
  onUse?: (asset: Asset) => void;
  refreshKey?: number;
}) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [tab, setTab] = useState<Tab>("video");
  const [selected, setSelected] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<Asset | null>(null);

  const load = useCallback(() => {
    fetch("/api/assets")
      .then((r) => r.json())
      .then((a: Asset[]) => setAssets(a))
      .catch(() => setAssets([]));
  }, []);

  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load, refreshKey]);

  const videos = assets?.filter((a) => a.kind === "video") ?? [];
  const photos = assets?.filter((a) => a.kind === "image") ?? [];
  const music = assets?.filter((a) => a.kind === "audio") ?? [];
  const shown = tab === "video" ? videos : tab === "image" ? photos : music;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    for (const f of Array.from(files)) {
      await uploadFile(f, true).catch(() => undefined);
    }
    setUploading(false);
    load();
  }

  async function remove(ids: string[]) {
    if (!ids.length || !confirm(ids.length === 1 ? "Delete this file?" : `Delete ${ids.length} files?`)) return;
    await Promise.all(ids.map((id) => fetch(`/api/assets/${id}`, { method: "DELETE" })));
    setSelected([]);
    load();
  }

  if (!open) {
    return (
      <button type="button" onClick={onToggle} className="card flex h-full w-12 flex-col items-center gap-2 py-4 text-muted hover:text-text" aria-label="Open library">
        <Library className="h-[18px] w-[18px]" />
        <span className="text-[11px] font-semibold [writing-mode:vertical-rl]">Library</span>
      </button>
    );
  }

  const allOn = shown.length > 0 && shown.every((a) => selected.includes(a.mediaId));

  return (
    <div className="card flex h-full w-[392px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-[15px] font-bold">
          <Library className="h-[18px] w-[18px] text-muted" />
          Library
        </div>
        <div className="flex items-center gap-1">
          <label className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-accent hover:bg-accent-tint ${uploading ? "pointer-events-none opacity-50" : ""}`}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />}
            Upload
            <input type="file" multiple accept="video/*,image/png,image/jpeg,audio/*" className="hidden" onChange={(e) => void upload(e.target.files)} />
          </label>
          <button type="button" onClick={onToggle} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-text" aria-label="Close library">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-3 px-4 pt-3">
        <div className="flex gap-1 rounded-xl bg-raised p-1">
          {(
            [
              { id: "image", label: "Photos", icon: ImageIcon, count: photos.length },
              { id: "video", label: "Videos", icon: Video, count: videos.length },
              { id: "music", label: "Music", icon: Music, count: music.length },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setSelected([]);
              }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] font-semibold ${tab === t.id ? "bg-hover text-text shadow-sm" : "text-muted hover:text-text"}`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              <span className={`rounded-md px-1.5 text-[11px] ${tab === t.id ? "bg-accent-tint text-accent" : "bg-hover"}`}>{t.count}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
          <span className="text-[12px] text-muted">{selected.length ? `${selected.length} selected` : "Select for bulk actions"}</span>
          <div className="flex items-center gap-1">
            {selected.length > 0 && (
              <button type="button" onClick={() => void remove(selected)} className="rounded-md px-2 py-1 text-[12px] font-semibold text-red-500 hover:bg-red-500/10">
                Delete
              </button>
            )}
            <button
              type="button"
              disabled={!shown.length}
              onClick={() => setSelected(allOn ? [] : shown.map((a) => a.mediaId))}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-text hover:bg-raised disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              {allOn ? "Clear" : "Select all"}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {assets === null ? (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="shimmer aspect-[9/14] rounded-xl" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-center text-[13px] text-muted">
            {tab === "music" ? <Music className="h-5 w-5 text-soft" /> : <Plus className="h-5 w-5 text-soft" />}
            {tab === "music" ? "No music yet" : tab === "video" ? "Upload clips and screen recordings" : "Upload screenshots and photos"}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {shown.map((a) => {
              const on = selected.includes(a.mediaId);
              return (
                <div key={a.mediaId} className={`group overflow-hidden rounded-xl border bg-panel ${on ? "border-accent ring-2 ring-accent-line" : "border-line"}`}>
                  <div className="flex items-center gap-0.5 px-1.5 py-1.5">
                    <button
                      type="button"
                      onClick={() => setSelected((s) => (on ? s.filter((x) => x !== a.mediaId) : [...s, a.mediaId]))}
                      className={`mr-auto flex h-4 w-4 items-center justify-center rounded border ${on ? "border-accent bg-accent text-accent-ink" : "border-line"}`}
                      aria-label="Select"
                    >
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </button>
                    <button type="button" onClick={() => setPreview(a)} className="rounded p-1 text-soft hover:bg-raised hover:text-text" aria-label="Expand">
                      <Expand className="h-3.5 w-3.5" />
                    </button>
                    <a href={`/api/media/${a.mediaId}`} download={a.name} className="rounded p-1 text-soft hover:bg-raised hover:text-text" aria-label="Download">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    <button type="button" onClick={() => void remove([a.mediaId])} className="rounded p-1 text-soft hover:bg-red-500/10 hover:text-red-500" aria-label="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="relative aspect-[9/14] bg-black">
                    {a.kind === "audio" ? (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-raised p-2">
                        <Music className="h-6 w-6 text-accent" />
                        <audio src={`/api/media/${a.mediaId}`} controls preload="none" className="w-full" />
                      </div>
                    ) : a.kind === "video" ? (
                      <video src={`/api/media/${a.mediaId}#t=0.3`} muted preload="metadata" className="h-full w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/media/${a.mediaId}`} alt="" className="h-full w-full object-cover" />
                    )}
                    {onUse && (
                      <button type="button" onClick={() => onUse(a)} className="btn-primary absolute inset-x-2 bottom-2 py-1.5 text-[12px] opacity-0 transition-opacity group-hover:opacity-100">
                        {useLabel ?? "Use"}
                      </button>
                    )}
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="truncate text-[12px] font-semibold">{a.name}</div>
                    <div className="text-[11px] text-soft">{fmtDate(a.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={() => setPreview(null)}>
          {preview.kind === "video" ? (
            <video src={`/api/media/${preview.mediaId}`} controls autoPlay className="max-h-full rounded-2xl" onClick={(e) => e.stopPropagation()} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/${preview.mediaId}`} alt="" className="max-h-full rounded-2xl" />
          )}
        </div>
      )}
    </div>
  );
}
