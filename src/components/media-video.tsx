"use client";
import { useState, type ComponentProps } from "react";
const posters = new Map<string, string>();
const empty = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='720' height='1280'/%3E";
/** Reuse an already decoded frame as a poster; never fetch a second video or post-process a hook. */
export function MediaVideo({ src, poster, preload = "metadata", onLoadedData, ...props }: ComponentProps<"video">) {
  const [captured, setCaptured] = useState<{src: string; url: string} | null>(null);
  const key = typeof src === "string" ? src : null;
  const cached = key ? posters.get(key) : undefined;
  return <video {...props} src={src} preload={preload} poster={poster ?? (captured?.src === src ? captured?.url : cached) ?? empty} onLoadedData={event => {
    onLoadedData?.(event);
    if (poster || !key || posters.has(key)) return;
    const video = event.currentTarget;
    if (!video.videoWidth || !video.videoHeight) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(320, video.videoWidth); canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/jpeg", 0.75);
      if (posters.size >= 100) posters.delete(posters.keys().next().value!);
      posters.set(key, url); setCaptured({src: key, url});
    } catch { /* Cross-origin video without canvas permission still displays its decoded frame normally. */ }
  }} />;
}
