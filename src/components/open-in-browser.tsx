"use client";

import { useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { inAppBrowser, openInBrowserUrl, type InApp } from "@/lib/in-app-browser";

/**
 * Inside Instagram / Facebook / TikTok's own browser: a bar asking to open Mavya in the real browser (founder
 * 2026-11-26), where Google sign-in and Apple Pay work. Android jumps to Chrome; iPhone tries Safari and, if the app
 * blocks that, shows how to do it from the app's menu. Never shown in a normal browser. Can be closed.
 */
export function OpenInBrowser() {
  const [env, setEnv] = useState<InApp | null>(null);
  const [tried, setTried] = useState(false);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    // Read once on the device (the server never sees it), so the page itself renders the same everywhere.
    const found = inAppBrowser(navigator.userAgent);
    if (found) queueMicrotask(() => setEnv(found));
  }, []);
  if (!env || closed) return null;
  const canJump = env.os !== "other";
  const browser = env.os === "android" ? "Chrome" : "Safari";
  const open = () => {
    // Built at the click, from the page shown now (the bar stays across in-app navigation). Codex 2026-11-26.
    const target = openInBrowserUrl(window.location.href, env.os);
    if (target) window.location.href = target;
    // Still here a moment later: the app blocked the jump; show the manual way.
    setTimeout(() => setTried(true), 1200);
  };
  return (
    <div role="region" aria-label="Open in your browser" className="fixed inset-x-2 top-2 z-[60] rounded-xl border border-line-strong bg-panel p-3 shadow-[0_12px_32px_-8px_rgba(21,18,31,0.35)]">
      <button type="button" aria-label="Close" onClick={() => setClosed(true)} className="absolute right-1.5 top-1.5 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-soft hover:bg-raised"><X className="h-4 w-4" /></button>
      <p className="pr-8 text-[14px] font-bold">Open Mavya in {browser}</p>
      <p className="mt-0.5 pr-8 text-[12.5px] text-muted">{env.app}&apos;s browser blocks Google sign-in and Apple Pay.</p>
      {tried || !canJump ? (
        <p className="mt-2 rounded-lg bg-raised px-3 py-2 text-[13px] font-semibold">Tap <b>⋯</b> at the top right, then <b>Open in {env.os === "android" ? "Chrome" : "external browser"}</b>.</p>
      ) : (
        <button type="button" onClick={open} className="btn-primary mt-2 w-full px-4 py-2.5 text-[14px]"><ExternalLink className="h-4 w-4" />Open in {browser}</button>
      )}
    </div>
  );
}
