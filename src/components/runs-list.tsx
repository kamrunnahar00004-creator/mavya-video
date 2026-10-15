"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, Loader2, Plus, Sparkles } from "lucide-react";
import { fmtDate, type Run } from "@/lib/types";

function stepsDone(r: Run): number {
  return [Boolean(r.sourceRefId), Boolean(r.hook.face || r.hook.clip), Boolean(r.demo.clip)].filter(Boolean).length;
}

export function RunsList() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/runs")
      .then((r) => r.json())
      .then((data: Run[]) => alive && setRuns(data))
      .catch(() => alive && setRuns([]));
    return () => {
      alive = false;
    };
  }, []);

  async function newRun() {
    setCreating(true);
    const res = await fetch("/api/runs", { method: "POST" });
    const run = (await res.json()) as Run;
    router.push(`/studio/${run.id}`);
  }

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight">Hook + Demo</h1>
          <p className="text-[13px] text-muted">Your videos</p>
        </div>
        <button type="button" onClick={() => void newRun()} disabled={creating} className="btn-primary px-4 py-2.5 text-[14px]">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" strokeWidth={2.6} />}
          New video
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {runs === null ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="shimmer h-[68px] rounded-xl" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="mx-auto flex max-w-[420px] flex-col items-center gap-4 pt-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-tint text-accent">
              <Clapperboard className="h-6 w-6" />
            </div>
            <div>
              <div className="text-[17px] font-bold">Your product deserves to be seen</div>
              <div className="mt-1 text-[13.5px] text-muted">Steal a hook that works. Show your product. Post.</div>
            </div>
            <button type="button" onClick={() => void newRun()} disabled={creating} className="btn-primary px-5 py-2.5 text-[14px]">
              <Sparkles className="h-4 w-4" />
              Make a video
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {runs.map((r) => {
              const done = stepsDone(r);
              return (
                <Link key={r.id} href={`/studio/${r.id}`} className="flex items-center gap-4 rounded-xl border border-line bg-panel px-4 py-3 hover:border-accent-line hover:bg-accent-tint/40">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-raised text-accent">
                    <Sparkles className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-semibold">{r.title}</div>
                    <div className="text-[12.5px] text-muted">Created {fmtDate(r.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className={`h-1.5 w-6 rounded-full ${i < done ? "bg-accent" : "bg-hover"}`} />
                      ))}
                    </div>
                    <span className="w-14 text-right text-[12px] font-medium text-muted">{done === 3 ? "Ready" : `${done} of 3`}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
