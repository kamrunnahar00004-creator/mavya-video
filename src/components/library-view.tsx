"use client";
import { flushSync } from "react-dom";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { libraryMore, loadLibrary } from "@/lib/library-cache";
import { RouteSkeleton } from "@/components/route-skeleton";
import type { Reference } from "@/lib/types";
import { SourcePicker } from "@/components/source-picker";
import { startCreate } from "@/lib/pending-runs";

/** Viral library: the same hook grid as step 1, browsable without starting a video. */
export function LibraryView() {
  const router = useRouter();
  const busy = useRef(false);
  const [creating, setCreating] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [refs, setRefs] = useState<Reference[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // New video leaves this page while the video is created; Next keeps the page and shows it again on Back, so its
  // busy state resets as it is hidden (otherwise Back shows the loading skeleton for good).
  useEffect(() => () => {
    busy.current = false;
    setCreating(false);
  }, []);

  useEffect(() => {
    let alive = true;
    loadLibrary()
      .then((page) => { if (alive) { setRefs(page.items); setCursor(page.next); } })
      .catch(() => { if (alive) { setRefs([]); setError("Library is unavailable. Try again."); } });
    return () => {
      alive = false;
    };
  }, []);

  /** "Use this hook" here starts a new video with the hook already picked. */
  async function startWithHook(ref: Reference) {
    if (busy.current) return;
    busy.current = true;
    flushSync(() => setCreating(true));
    // Opens the new video at once; it is created on the server meanwhile (src/lib/pending-runs.ts).
    const id = crypto.randomUUID();
    void startCreate(id, ref.id);
    window.dispatchEvent(new CustomEvent("mavya:navigate", { detail: `/studio/${id}` }));
    router.push(`/studio/${id}`);
  }

  if (creating) return <RouteSkeleton path="/studio/new" />;

  return (
    <div className="card h-full overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-line bg-panel/90 px-6 py-4 backdrop-blur">
        <h1 className="text-[20px] font-extrabold tracking-tight">Viral library</h1>
      </header>
      <div className="mx-auto max-w-[1100px] p-6">
        {refs === null ? (
          // Card-shaped placeholders in the same grid as the hooks, so the page has its shape at once.
          <div aria-busy="true" aria-label="Loading hooks" className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
            {Array.from({ length: 12 }, (_, i) => <div key={i} className="aspect-[9/16] animate-pulse rounded-xl bg-raised" />)}
          </div>
        ) : (
          <SourcePicker onLoadMore={cursor ? async () => { const page = await libraryMore(cursor); setRefs(old => [...(old ?? []), ...page.items]); setCursor(page.next); } : undefined} refs={refs} source={null} onRefsChange={setRefs} onPick={startWithHook} onClear={() => undefined} />
        )}
        {error && <p className="mt-3 text-[13px] text-red-500">{error}</p>}
      </div>
    </div>
  );
}
