"use client";
import { MediaVideo } from "@/components/media-video";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, List, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { fetchPage } from "@/lib/list-client";
import { runSteps } from "@/lib/edit";
import { fmtDate, type Reference, type Run } from "@/lib/types";

const titleOf = (r: Run) => (r.title === "Untitled run" ? "Untitled video" : r.title);
const VIEW_KEY = "mavya-videos-view";
type View = "grid" | "list";

/** A video's picture: the generated hook's first frame, else the stolen hook's cover. */
function Cover({ run, source }: { run: Run; source?: Reference }) {
  const thumb = (run as Run & {cover?: string}).cover ?? source?.analysis?.segments[0]?.thumb ?? source?.thumbUrl;
  if (run.hook.generated) return <MediaVideo src={`${run.hook.generated.src}#t=0.5`} muted preload="metadata" className="absolute inset-0 h-full w-full object-cover" />;
  if (thumb)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />;
  return null;
}

/** Progress as a short label: "Ready", or the next step to do. */
function progress(r: Run) {
  const steps = runSteps(r);
  const done = steps.filter(Boolean).length;
  return { ready: done === steps.length, label: done === steps.length ? "Ready" : `Step ${steps.findIndex((d) => !d) + 1} of ${steps.length}`, done, total: steps.length };
}

/** The title, renamed in place: click the pencil (or the title in list view), Enter saves, Esc cancels. */
function Title({ run, editing, onEdit, onRename, className }: { run: Run; editing: boolean; onEdit: (on: boolean) => void; onRename: (t: string) => void; className?: string }) {
  const [draft, setDraft] = useState(titleOf(run));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  if (!editing) return <span className={`block truncate ${className ?? ""}`}>{titleOf(run)}</span>;
  const done = (save: boolean) => {
    onEdit(false);
    const t = draft.trim();
    if (save && t && t !== titleOf(run)) onRename(t);
    else setDraft(titleOf(run));
  };
  return (
    <input
      ref={input}
      value={draft}
      maxLength={140}
      aria-label="Video title"
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.preventDefault()}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") done(true);
        if (e.key === "Escape") done(false);
      }}
      className={`-mx-1.5 box-border block h-[1.55em] w-[calc(100%+0.75rem)] min-w-0 rounded-md border border-accent bg-panel px-1.5 py-0 leading-none outline-none ${className ?? ""}`}
    />
  );
}

export function RunsList() {
  const router = useRouter();
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<View>("grid");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "list" || saved === "grid") queueMicrotask(() => alive && setView(saved));
    } catch {
      // No storage: grid by default.
    }
    fetchPage<Run>("/api/runs?view=summary")
      .then((page) => { if (alive) { setRuns(page.items); setCursor(page.next); } })
      .catch(() => alive && setRuns([]));
    return () => {
      alive = false;
    };
  }, []);

  function pick(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Not remembered; fine.
    }
  }

  async function newRun() {
    if (creating) return;
    setCreating(true);
    // Next keeps this page's state when you leave it (cacheComponents), so the spinner must stop here,
    // or it is still spinning when you come back to the dashboard.
    try {
      const res = await fetch("/api/runs", { method: "POST" });
      if (!res.ok) return;
      const run = (await res.json()) as Run;
      router.push(`/studio/${run.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function rename(r: Run, title: string) {
    setRuns((all) => all?.map((x) => (x.id === r.id ? { ...x, title } : x)) ?? null);
    await fetch(`/api/runs/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
  }

  async function remove(r: Run) {
    if (!confirm(`Delete "${titleOf(r)}"? This can't be undone.`)) return;
    const response = await fetch(`/api/runs/${r.id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) return setError("Couldn't delete the video. Try again.");
    setRuns((all) => all?.filter((x) => x.id !== r.id) ?? null);setError(null);
  }

  const iconBtn = "flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-text";
  /** Rename / delete, shown on hover (and always reachable by keyboard). */
  const actions = (r: Run, onDark = false) => (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        aria-label="Rename"
        title="Rename"
        onClick={(e) => {
          e.preventDefault();
          setEditing(r.id);
        }}
        className={onDark ? "flex h-8 w-8 items-center justify-center rounded-md bg-black/55 text-white hover:bg-black/75" : iconBtn}
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Delete"
        title="Delete"
        onClick={(e) => {
          e.preventDefault();
          void remove(r);
        }}
        className={onDark ? "flex h-8 w-8 items-center justify-center rounded-md bg-black/55 text-white hover:bg-red-600" : `${iconBtn} hover:!bg-red-50 hover:!text-red-600`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-4 border-b border-line px-6 py-4">
        <h1 className="text-[22px] font-bold">Your videos</h1>
        <div role="group" aria-label="View" className="ml-auto flex rounded-lg bg-raised p-0.5">
          {(
            [
              ["grid", LayoutGrid, "Grid view"],
              ["list", List, "List view"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={view === id}
              onClick={() => pick(id)}
              className={`flex h-8 w-9 items-center justify-center rounded-md ${view === id ? "bg-panel text-text shadow-[0_1px_2px_rgba(21,18,31,0.08)]" : "text-soft hover:text-text"}`}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void newRun()} disabled={creating} className="btn-primary px-4 py-2.5 text-[14px]">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" strokeWidth={2.6} />}
          New video
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {cursor && <button type="button" disabled={loadingMore} className="btn-secondary m-4 px-4 py-2" onClick={async () => { setLoadingMore(true); try { const page = await fetchPage<Run>("/api/runs?view=summary", cursor); setRuns(old => [...(old ?? []), ...page.items]); setCursor(page.next); } catch { setError("List is unavailable. Try again."); } finally { setLoadingMore(false); } }}>Load more</button>}
      {error && <p role="alert" className="mb-4 text-[13px] text-red-500">{error}</p>}
        {runs === null ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="shimmer aspect-[9/16] rounded-xl" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="mx-auto flex max-w-[380px] flex-col items-center gap-4 pt-20 text-center">
            <div className="text-[20px] font-bold">Make your first video</div>
            <p className="text-[14.5px] text-muted">Steal a hook that already went viral, put your character in it, then show your product.</p>
            <button type="button" onClick={() => void newRun()} disabled={creating} className="btn-primary px-5 py-2.5 text-[14px]">
              <Plus className="h-4 w-4" strokeWidth={2.6} />
              New video
            </button>
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-5 gap-y-6">
            {runs.map((r) => {
              const p = progress(r);
              return (
                <Link prefetch={false} key={r.id} href={`/studio/${r.id}`} className="group block" onClick={(e) => editing === r.id && e.preventDefault()}>
                  <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-[#1d1a2b] transition-transform group-hover:-translate-y-0.5">
                    <Cover run={r} />
                    <span className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[12px] font-bold ${p.ready ? "bg-accent text-white" : "bg-white/90 text-text"}`}>{p.label}</span>
                    <div className="absolute right-2 top-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">{actions(r, true)}</div>
                  </div>
                  <Title run={r} editing={editing === r.id} onEdit={(on) => setEditing(on ? r.id : null)} onRename={(t) => void rename(r, t)} className="mt-2.5 text-[14.5px] font-semibold group-hover:text-accent" />
                  <div className="mt-1 text-[13px] text-soft">{fmtDate(r.createdAt)}</div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="grid grid-cols-[56px_minmax(0,1fr)_160px_110px_80px] items-center gap-4 border-b border-line bg-raised px-4 py-2.5 text-[13px] font-semibold text-muted">
              <span />
              <span>Title</span>
              <span>Progress</span>
              <span>Created</span>
              <span />
            </div>
            {runs.map((r) => {
              const p = progress(r);
              return (
                <Link
                  prefetch={false}
                  key={r.id}
                  href={`/studio/${r.id}`}
                  onClick={(e) => editing === r.id && e.preventDefault()}
                  className="group grid grid-cols-[56px_minmax(0,1fr)_160px_110px_80px] items-center gap-4 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-raised"
                >
                  <div className="relative h-[72px] w-[40px] overflow-hidden rounded-md bg-[#1d1a2b]">
                    <Cover run={r} />
                  </div>
                  <Title run={r} editing={editing === r.id} onEdit={(on) => setEditing(on ? r.id : null)} onRename={(t) => void rename(r, t)} className="text-[14.5px] font-semibold" />
                  <div className="flex items-center gap-2.5">
                    <div className="flex gap-1">
                      {Array.from({ length: p.total }, (_, i) => (
                        <span key={i} className={`h-1.5 w-4 rounded-full ${i < p.done ? "bg-accent" : "bg-hover"}`} />
                      ))}
                    </div>
                    <span className={`text-[13px] ${p.ready ? "font-semibold text-accent" : "text-muted"}`}>{p.ready ? "Ready" : `${p.done}/${p.total}`}</span>
                  </div>
                  <span className="text-[13px] tabular-nums text-muted">{fmtDate(r.createdAt)}</span>
                  <div className="flex justify-end opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">{actions(r)}</div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
