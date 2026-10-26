"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2, RefreshCw, Scissors, Trash2, Wand2 } from "lucide-react";
import { analyzeVideo } from "@/lib/analyze";
import { PLATFORM_LABEL, ROLE_COLOR, ROLE_LABEL, fmtTime, fmtViews, type Analysis, type Reference, type Role } from "@/lib/types";

export function ReferenceView() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const [ref, setRef] = useState<Reference | null>(null);
  const [missing, setMissing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const started = useRef(false);

  const save = useCallback(
    async (analysis: Analysis) => {
      await fetch(`/api/references/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ analysis }) });
    },
    [id]
  );

  const runAnalysis = useCallback(
    async (r: Reference) => {
      setError(null);
      setProgress(0);
      try {
        const analysis = await analyzeVideo(`/api/media/${r.mediaId}`, setProgress);
        setRef({ ...r, analysis });
        await save(analysis);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analysis failed");
      } finally {
        setProgress(null);
      }
    },
    [save]
  );

  useEffect(() => {
    let alive = true;
    fetch(`/api/references/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("missing");
        const r = (await res.json()) as Reference;
        if (!alive) return;
        setRef(r);
        if (!r.analysis && search.get("analyze") === "1" && !started.current) {
          started.current = true;
          void runAnalysis(r);
        }
      })
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [id, search, runAnalysis]);

  // Debounced save of segment edits (role, note).
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  function editSegment(i: number, patch: { role?: Role; note?: string }) {
    if (!ref?.analysis) return;
    const analysis = { ...ref.analysis, segments: ref.analysis.segments.map((s, k) => (k === i ? { ...s, ...patch } : s)) };
    setRef({ ...ref, analysis });
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void save(analysis), 500);
  }

  function seek(t: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    void v.play();
  }

  async function remove() {
    if (!confirm("Delete this video from the library?")) return;
    const response = await fetch(`/api/references/${id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) return alert("Couldn't delete the hook. Try again.");
    router.push("/library");
  }

  if (missing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        Not found
        <Link href="/library" className="text-accent">
          Back to library
        </Link>
      </div>
    );
  }
  if (!ref) {
    return (
      <div className="flex h-full items-center justify-center text-soft">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const a = ref.analysis;
  const duration = a?.duration ?? 0;
  const activeIndex = a ? a.segments.findIndex((s) => time >= s.start && time < s.end) : -1;

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/library" className="rounded-md p-1.5 text-soft hover:bg-raised hover:text-text" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="truncate text-[15px] font-semibold">{ref.title}</h1>
          <span className="rounded bg-raised px-1.5 py-0.5 text-[11px] font-semibold text-muted">{PLATFORM_LABEL[ref.platform]}</span>
          {ref.views != null && <span className="text-[12.5px] text-muted">{fmtViews(ref.views)} views</span>}
          {ref.sourceUrl && (
            <a href={ref.sourceUrl} target="_blank" rel="noreferrer" className="text-soft hover:text-text" aria-label="Open source">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={remove} className="rounded-md p-2 text-soft hover:bg-raised hover:text-red-400" aria-label="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
          {a && (
            <button type="button" onClick={() => void runAnalysis(ref)} disabled={progress !== null} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-raised hover:text-text disabled:opacity-40">
              <RefreshCw className="h-3.5 w-3.5" />
              Re-analyze
            </button>
          )}
          <button
            type="button"
            disabled={!a}
            onClick={async () => {
              const run = (await (await fetch("/api/runs", { method: "POST" })).json()) as { id: string; hook: Record<string, unknown> };
              const seg = a?.segments.find((s) => s.role === "hook");
              await fetch(`/api/runs/${run.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ sourceRefId: ref.id, title: ref.title, hook: { ...run.hook, start: seg?.start ?? 0, end: seg?.end ?? 3 } }),
              });
              router.push(`/studio/${run.id}`);
            }}
            className="btn-primary px-3.5 py-1.5 text-[13.5px]"
          >
            <Wand2 className="h-4 w-4" />
            Use in a new run
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-bg p-6">
          <video
            ref={videoRef}
            src={`/api/media/${ref.mediaId}`}
            controls
            playsInline
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            className="max-h-[calc(100vh-200px)] rounded-xl bg-black"
            style={{ aspectRatio: a ? `${a.width} / ${a.height}` : "9 / 16" }}
          />
          {a && (
            <div className="relative w-full max-w-[560px]">
              <div className="flex h-9 overflow-hidden rounded-md">
                {a.segments.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => seek(s.start)}
                    title={`${ROLE_LABEL[s.role]} ${fmtTime(s.start)} to ${fmtTime(s.end)}`}
                    className="relative border-r-2 border-bg last:border-0"
                    style={{ flex: s.end - s.start, background: `${ROLE_COLOR[s.role]}${i === activeIndex ? "" : "55"}` }}
                  >
                    <span className="absolute left-1.5 top-1 text-[10px] font-bold text-black/80">{ROLE_LABEL[s.role]}</span>
                  </button>
                ))}
              </div>
              <div className="pointer-events-none absolute -top-1 bottom-[-4px] w-0.5 bg-panel" style={{ left: `${(time / Math.max(0.01, duration)) * 100}%` }} />
            </div>
          )}
        </div>

        <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-[14px] font-semibold">Structure</h2>
            {a && (
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                <Scissors className="h-3.5 w-3.5" />
                {a.cuts.length} cuts · {fmtTime(a.duration)}
              </span>
            )}
          </div>

          {progress !== null ? (
            <div className="space-y-3 p-5">
              <div className="flex items-center gap-2 text-[13.5px] text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Finding the hook and cuts
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            </div>
          ) : !a ? (
            <div className="space-y-3 p-5">
              {error && <p className="text-[13px] text-red-400">{error}</p>}
              <button type="button" onClick={() => void runAnalysis(ref)} className="btn-primary px-3.5 py-2 text-[13.5px]">
                <Wand2 className="h-4 w-4" />
                Analyze
              </button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {a.segments.map((s, i) => (
                <div key={i} className={`flex gap-3 border-b border-line px-5 py-3.5 ${i === activeIndex ? "bg-raised" : ""}`}>
                  <button type="button" onClick={() => seek(s.start)} className="relative h-[86px] w-[50px] shrink-0 overflow-hidden rounded-md bg-black">
                    {s.thumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.thumb} alt="" className="h-full w-full object-cover" />
                    )}
                    <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: ROLE_COLOR[s.role] }} />
                  </button>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <select
                        value={s.role}
                        onChange={(e) => editSegment(i, { role: e.target.value as Role })}
                        className="rounded border border-line bg-raised px-1.5 py-1 text-[12.5px] font-semibold outline-none"
                        style={{ color: ROLE_COLOR[s.role] }}
                      >
                        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => seek(s.start)} className="font-mono text-[12px] tabular-nums text-muted hover:text-text">
                        {fmtTime(s.start)} → {fmtTime(s.end)}
                      </button>
                    </div>
                    <input
                      value={s.note}
                      onChange={(e) => editSegment(i, { note: e.target.value })}
                      placeholder={s.role === "hook" ? "Shocked reaction, text on screen..." : s.role === "cta" ? "End card, link in bio..." : "Phone filming laptop, scroll..."}
                      className="w-full rounded-md border border-line bg-raised px-2.5 py-1.5 text-[13px] outline-none placeholder:text-soft focus:border-accent"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
