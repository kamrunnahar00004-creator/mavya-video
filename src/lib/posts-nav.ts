"use client";
import { useSyncExternalStore } from "react";

// Whether the sidebar shows Scheduled posts: set from the signed-in account's own profile (AccountChip's /api/profile
// read, `scheduler: true` for the owner only). Memory only: signing out reloads the page, so it never carries over to
// another account (Codex 2026-11-15: a session cache did), and no extra request is made for anyone.
let shown = false;
const listeners = new Set<() => void>();

export function setPostsNav(value: boolean) {
  if (value === shown) return;
  shown = value;
  for (const l of listeners) l();
}

export function usePostsNav(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => shown, () => false);
}
