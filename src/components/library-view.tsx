"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { fetchPage } from "@/lib/list-client";
import { patchRun } from "@/lib/client";
import type { Reference, Run } from "@/lib/types";
import { SourcePicker } from "@/components/source-picker";

/** Viral library: the same hook grid as step 1, browsable without starting a video. */
export function LibraryView() {
  const router = useRouter();
  const [cursor, setCursor] = useState<string | null>(null);
  const [refs, setRefs] = useState<Reference[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPage<Reference>("/api/references?view=studio")
      .then((page) => { if (alive) { setRefs(page.items); setCursor(page.next); } })
      .catch(() => alive && setRefs([]));
    return () => {
      alive = false;
    };
  }, []);

  /** "Use this hook" here starts a new video with the hook already picked. */
  async function startWithHook(ref: Reference) {
    try {
      const res = await fetch("/api/runs", { method: "POST" });
      if (!res.ok) throw new Error();
      const run = (await res.json()) as Run;
      const seg = ref.analysis?.segments.find((s) => s.role === "hook");
      await patchRun(run.id, { sourceRefId: ref.id, title: ref.title, hook: { ...run.hook, start: seg?.start ?? 0, end: seg?.end ?? 3 } });
      router.push(`/studio/${run.id}`);
    } catch {
      setError("Could not start a video with this hook");
    }
  }

  return (
    <div className="card h-full overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-line bg-panel/90 px-6 py-4 backdrop-blur">
        <h1 className="text-[20px] font-extrabold tracking-tight">Viral library</h1>
      </header>
      <div className="mx-auto max-w-[1100px] p-6">
        {refs === null ? (
          <div className="flex h-64 items-center justify-center text-soft">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <SourcePicker onLoadMore={cursor ? async () => { const page = await fetchPage<Reference>("/api/references?view=studio", cursor); setRefs(old => [...(old ?? []), ...page.items]); setCursor(page.next); } : undefined} refs={refs} source={null} onRefsChange={setRefs} onPick={(r) => void startWithHook(r)} onClear={() => undefined} />
        )}
        {error && <p className="mt-3 text-[13px] text-red-500">{error}</p>}
      </div>
    </div>
  );
}
