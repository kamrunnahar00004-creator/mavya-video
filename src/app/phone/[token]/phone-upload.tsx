"use client";

import { useState } from "react";
import { Check, Loader2, Upload } from "lucide-react";

type Item = { name: string; state: "waiting" | "uploading" | "done" | "failed"; error?: string };

/** The length of a video file, read on the phone (no upload needed). */
function lengthOf(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const end = (n: number | null) => { URL.revokeObjectURL(url); resolve(n); };
    v.preload = "metadata";
    v.onloadedmetadata = () => end(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
    v.onerror = () => end(null);
    v.src = url;
  });
}

async function call(token: string, body: object) {
  const res = await fetch(`/api/phone/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Upload failed. Try again.");
  return json;
}

/** One file: start, put it in storage, finish, then leave it in the video's inbox for the computer. */
async function send(token: string, file: File, order: number) {
  const mime = file.type || "video/mp4";
  const [seconds, start] = await Promise.all([lengthOf(file), call(token, { step: "start", mime, size: file.size })]);
  const put = await fetch(start.url, { method: "PUT", headers: { "content-type": mime }, body: file });
  if (!put.ok) throw new Error("Upload failed. Try again.");
  await call(token, { step: "finish", mime, mediaId: start.mediaId, name: file.name });
  await call(token, { step: "add", mediaId: start.mediaId, seconds, order });
}

/**
 * Upload from phone (founder 2026-11-27): one button opens the phone's library, pick all your demo videos at once,
 * they upload in the order picked and show up on your computer by themselves.
 */
export function PhoneUpload({ token }: { token: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const busy = items.some((i) => i.state === "waiting" || i.state === "uploading");
  const allDone = items.length > 0 && items.every((i) => i.state === "done");

  async function take(files: FileList | null) {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(f.name));
    if (!list.length) return;
    const base = items.length;
    setItems((old) => [...old, ...list.map((f) => ({ name: f.name, state: "waiting" as const }))]);
    // One at a time, in the order picked, so they land in the clips in that order.
    for (let i = 0; i < list.length; i++) {
      const at = base + i;
      setItems((old) => old.map((x, k) => (k === at ? { ...x, state: "uploading" } : x)));
      try {
        await send(token, list[i], at);
        setItems((old) => old.map((x, k) => (k === at ? { ...x, state: "done" } : x)));
      } catch (e) {
        setItems((old) => old.map((x, k) => (k === at ? { ...x, state: "failed", error: e instanceof Error ? e.message : "Upload failed. Try again." } : x)));
      }
    }
  }

  return (
    <div className="mt-8">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Add your demo</h1>
      <p className="mt-2 text-[16px] text-muted">Choose your demo videos. They show up on your computer.</p>
      <label className={`btn-primary mt-6 flex h-14 w-full cursor-pointer text-[17px] ${busy ? "pointer-events-none opacity-60" : ""}`}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
        {busy ? "Uploading" : items.length ? "Upload more" : "Upload from phone"}
        <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => { void take(e.target.files); e.target.value = ""; }} />
      </label>
      {items.length > 0 && (
        <ol className="mt-6 space-y-2">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-3 border border-line bg-panel px-3 py-3">
              <span className="w-5 text-[13px] font-bold tabular-nums text-soft">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{it.name}</span>
              {it.state === "done" ? <Check className="h-5 w-5 text-accent" /> : it.state === "failed" ? <span className="text-[13px] font-semibold text-red-600">{it.error}</span> : it.state === "uploading" ? <Loader2 className="h-5 w-5 animate-spin text-accent" /> : null}
            </li>
          ))}
        </ol>
      )}
      {allDone && <p className="mt-6 text-[16px] font-semibold text-accent">Done. Check your computer.</p>}
    </div>
  );
}
