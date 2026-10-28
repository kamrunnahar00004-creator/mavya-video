"use client";
import { MediaVideo } from "@/components/media-video";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Eye, Heart, Link as LinkIcon, Loader2, Upload, X } from "lucide-react";
import { analyzeVideo } from "@/lib/analyze";
import { uploadFile } from "@/lib/client";
import { PLATFORM_LABEL, commentCta, fmtViews, isLikelyBoosted, type Reference } from "@/lib/types";
/** Curator mode: the founder's machine only (NEXT_PUBLIC_CURATOR=1 in .env.local). */
const CURATOR = process.env.NEXT_PUBLIC_CURATOR === "1";


const STYLES: { id: "all" | "text_music" | "talking"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "text_music", label: "Text + music" },
  { id: "talking", label: "Voiceover" },
];

type Sort = "views" | "likes" | "comments" | "new";
const SORTS: { id: Sort; label: string }[] = [
  { id: "views", label: "Most viewed" },
  { id: "likes", label: "Most liked" },
  { id: "comments", label: "Most comments" },
  { id: "new", label: "Newest" },
];
const sortValue = (r: Reference, sort: Sort): number | string =>
  sort === "views" ? (r.views ?? 0) : sort === "likes" ? (r.likes ?? 0) : sort === "comments" ? (r.comments ?? 0) : (r.postedAt ?? r.createdAt);

/** The hook library grid (step 1 picker panel and the Viral library page). */
export function SourcePicker({ refs, source, onRefsChange, onPick, onClear, onLoadMore }: { onLoadMore?: () => Promise<void>; refs: Reference[]; source: Reference | null; onRefsChange: (r: Reference[]) => void; onPick: (r: Reference) => void; onClear: () => void}) {
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<Sort>("views");
  const [style, setStyle] = useState<"all" | "text_music" | "talking">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Reference | null>(null);

  /** `isNew`: a just-uploaded video that isn't in `refs` yet. */
  async function pick(r: Reference, isNew = false) {
    setError(null);
    if (r.analysis || !r.mediaId) return onPick(r);
    setBusyId(r.id);
    try {
      const analysis = await analyzeVideo(`/api/media/${r.mediaId}`);
      await fetch(`/api/references/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ analysis }) });
      const updated = { ...r, analysis };
      onRefsChange((isNew ? [r, ...refs] : refs).map((x) => (x.id === r.id ? updated : x)));
      onPick(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this video");
    } finally {
      setBusyId(null);
    }
  }

  if (source) {
    return (
      <div className="flex items-center gap-4 rounded-2xl border border-line bg-panel p-3">
        <Thumb r={source} className="h-[86px] w-[50px] rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold">{source.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
            {source.author && <span>@{source.author}</span>}
            {source.views != null && (
              <span className="flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" />
                {fmtViews(source.views)}
              </span>
            )}
            {!source.mediaId && source.sourceUrl && (
              <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">
                Open link
              </a>
            )}
          </div>
        </div>
        <button type="button" onClick={onClear} className="rounded-lg px-3 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint">
          Change
        </button>
      </div>
    );
  }

  // Pending hooks (not yet fit-checked) are hidden from users; the curator sees them tagged.
  // Dropped hooks stay in the data (training labels) but never show.
  const library = refs.filter((r) => (r.owner ?? "curated") === "curated" && (r.mediaId || r.sourceUrl) && (!r.pending || CURATOR) && r.review?.verdict !== "drop");
  const list = [...library].filter((r) => (style === "all" || r.ai?.style === style)).sort((a, b) => {
    const x = sortValue(a, sort);
    const y = sortValue(b, sort);
    return typeof x === "number" && typeof y === "number" ? y - x : String(y).localeCompare(String(x));
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 border-b border-line">
        <div className="flex gap-6" role="tablist" aria-label="Hook style">
          {STYLES.map((o) => (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={style === o.id}
              onClick={() => setStyle(o.id)}
              className={`-mb-px border-b-2 pb-2.5 text-[14px] font-semibold transition-colors ${style === o.id ? "border-ink text-text" : "border-transparent text-soft hover:text-muted"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 pb-2">
          <SortMenu value={sort} onChange={setSort} />
        </div>
      </div>

      {library.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-panel py-12 text-center text-[14px] text-muted">New hooks are on the way.</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
          {list.map((r) => (
            <HookCard key={r.id} r={r} busy={busyId === r.id} disabled={busyId !== null} onPick={() => (!r.mediaId && embedUrl(r) ? setPreview(r) : void pick(r))} />
          ))}
        </div>
      )}
      {onLoadMore && <button type="button" disabled={loadingMore} className="btn-secondary px-4 py-2" onClick={async () => { setLoadingMore(true); try { await onLoadMore(); } catch { setError("List is unavailable. Try again."); } finally { setLoadingMore(false); } }}>Load more</button>}
      {error && <p className="text-[13px] text-red-500">{error}</p>}
      {preview && (
        <HookPreview
          r={preview}
          onClose={() => setPreview(null)}
          onUse={() => {
            setPreview(null);
            void pick(preview);
          }}
        />
      )}

    </div>
  );
}

function SortMenu({ value, onChange }: { value: Sort; onChange: (s: Sort) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13.5px] font-semibold text-text hover:bg-raised"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {SORTS.find((o) => o.id === value)?.label}
        <ChevronDown className={`h-4 w-4 text-soft transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="listbox" className="fade-in absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-line bg-panel p-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
          {SORTS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13.5px] font-medium text-text hover:bg-raised"
            >
              {o.label}
              {o.id === value && <Check className="h-4 w-4 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HookCard({ r, busy, disabled, onPick }: { r: Reference; busy: boolean; disabled: boolean; onPick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative aspect-[9/16] overflow-hidden rounded-xl bg-ink text-left outline-2 outline-offset-2 outline-transparent transition-[outline-color] hover:outline-accent disabled:opacity-60"
    >
      {r.mediaId && hover ? (
        <MediaVideo src={`/api/media/${r.mediaId}`} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
      ) : r.mediaId || r.thumbUrl ? (
        <Thumb r={r} className="absolute inset-0 h-full w-full" />
      ) : (
        <div className="absolute inset-0 flex flex-col p-3 pt-9">
          <span className="text-[30px] font-black leading-none text-accent">&ldquo;</span>
          <p className="line-clamp-6 text-[14px] font-bold leading-snug text-white">{r.title}</p>
        </div>
      )}
      {r.author && <span className="absolute left-2 top-2 max-w-[calc(100%-16px)] truncate rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-semibold text-white group-hover:opacity-0">@{r.author}</span>}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-8">
        <div className="flex items-center gap-2.5 text-[12px] font-bold text-white">
          {r.views != null && (
            <span className="flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {fmtViews(r.views)}
            </span>
          )}
          {r.likes != null && (
            <span className="flex items-center gap-1 text-white/80">
              <Heart className="h-3.5 w-3.5" />
              {fmtViews(r.likes)}
            </span>
          )}
        </div>
      </div>
      <span className="absolute inset-x-2 top-2 flex justify-center opacity-0 transition-opacity group-hover:opacity-100">
        <span className="rounded-md bg-white px-2 py-0.5 text-[11.5px] font-bold text-ink">{busy ? "Loading..." : !r.mediaId && embedUrl(r) ? "Preview" : "Use this hook"}</span>
      </span>
    </button>
  );
}

/** The platform's own embed player for a link reference (no download, no storage). */
function embedUrl(r: Reference): string | null {
  try {
    const u = new URL(r.sourceUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (r.platform === "instagram") {
      const i = parts.findIndex((p) => p === "reel" || p === "reels" || p === "p");
      if (i >= 0 && parts[i + 1]) return `https://www.instagram.com/${parts[i] === "p" ? "p" : "reel"}/${parts[i + 1]}/embed`;
    }
    if (r.platform === "youtube") {
      const id = u.hostname.endsWith("youtu.be") ? parts[0] : (u.searchParams.get("v") ?? (parts[0] === "shorts" ? parts[1] : null));
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (r.platform === "tiktok") {
      const i = parts.indexOf("video");
      if (i >= 0 && parts[i + 1]) return `https://www.tiktok.com/embed/v2/${parts[i + 1]}`;
    }
  } catch {
    // Not a valid URL: no preview.
  }
  return null;
}

/** "Mar 21" with the year on a second line. */
function fmtDate(iso?: string): React.ReactNode {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const day = new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <>
      {day}
      <span className="block text-[13px] font-semibold text-muted">{m[1]}</span>
    </>
  );
}

function HookPreview({ r, onClose, onUse }: { r: Reference; onClose: () => void; onUse: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const boosted = isLikelyBoosted(r);
  const cta = commentCta(r.caption);
  const pct = (n: number | null | undefined) => {
    if (!r.views || n == null) return null;
    const v = (100 * n) / r.views;
    return v < 0.01 ? "<0.01%" : `${v.toFixed(v < 0.1 ? 2 : 1)}%`;
  };
  const stats = [
    { label: "Views", value: r.views != null ? fmtViews(r.views) : null },
    { label: boosted ? "Organic likes" : "Likes", value: r.likes != null ? fmtViews(r.likes) : null },
    { label: boosted ? "Organic comments" : "Comments", value: r.comments != null ? fmtViews(r.comments) : null },
    { label: "Posted", value: fmtDate(r.postedAt) },
    { label: "Like rate", value: pct(r.likes) },
    { label: "Comment rate", value: pct(r.comments) },
  ].filter((s) => s.value);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4" onClick={onClose}>
      <div className="fade-in flex max-h-[94vh] w-full max-w-[880px] overflow-hidden rounded-2xl bg-panel shadow-[0_24px_64px_rgba(0,0,0,0.35)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex w-[400px] shrink-0 justify-center bg-raised">
          <iframe src={embedUrl(r) ?? undefined} title={r.title} className="h-[min(760px,94vh)] w-[400px] border-0" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-6">
          <div className="flex items-start justify-between gap-3">
            {r.author && (
              <a href={`https://www.instagram.com/${r.author}/`} target="_blank" rel="noreferrer" className="text-[13.5px] text-muted hover:text-text">
                <span className="font-bold text-text">@{r.author}</span>
                {r.followers != null && <span> · {fmtViews(r.followers)} followers</span>}
              </a>
            )}
            <button type="button" onClick={onClose} className="-mr-2 -mt-2 ml-auto rounded-lg p-1.5 text-soft hover:bg-raised hover:text-text" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <h3 className="mt-2 text-[22px] font-extrabold leading-tight tracking-tight">{r.title}</h3>
          {(r.ai?.style || boosted) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {r.ai?.style && (
                <span className="rounded-md border border-line bg-panel px-2 py-0.5 text-[12px] font-semibold text-muted">{r.ai.style === "talking" ? "Voiceover" : "Text + music"}</span>
              )}
              {boosted && (
                <span title="Most views likely came from ads. Instagram's API leaves out likes and comments on ads, so these counts are organic only." className="cursor-help rounded-md border border-line bg-panel px-2 py-0.5 text-[12px] font-semibold text-muted">
                  Likely Boosted
                </span>
              )}
            </div>
          )}

          {stats.length > 0 && (
            <dl className="mt-8 grid grid-cols-3 gap-x-8 gap-y-7">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="text-[12.5px] font-semibold text-soft">{s.label}</dt>
                  <dd className="mt-1 text-[20px] font-extrabold tabular-nums">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {cta && (
            <div className="mt-7 text-[13.5px]">
              <span className="font-semibold text-soft">CTA </span>
              <span className="font-bold">Comment &ldquo;{cta}&rdquo;</span>
            </div>
          )}
          <div className="mt-auto space-y-2 pt-6">
            {r.summary && (
              <div className="mb-3 rounded-xl border border-line bg-raised px-3.5 py-3">
                <div className="text-[12px] font-semibold text-soft">Summary</div>
                <p className="mt-1 text-[13.5px] leading-snug text-text">
                  {/* **Product** in the summary renders bold. */}
                  {r.summary.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i} className="font-bold">{part}</strong> : part))}
                </p>
              </div>
            )}
            <button type="button" onClick={onUse} className="btn-primary w-full py-3 text-[15px]">
              Use this hook
            </button>
            <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-[14px] font-bold text-accent hover:bg-accent-tint">
              Open on {PLATFORM_LABEL[r.platform]}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Upload any video to steal its hook (downloaded or screen-recorded). Platform-independent. */
export function UploadDrop({ onAdded }: { onAdded: (r: Reference) => void }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("video/")) return setError("That isn't a video file");
    setBusy(true);
    setError(null);
    try {
      const { mediaId } = await uploadFile(file, false);
      const res = await fetch("/api/references", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mediaId, title: file.name.replace(/\.[^.]+$/, "").slice(0, 120), platform: "other", owner: "user" }),
      });
      const data = (await res.json()) as Reference & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not use this video");
      onAdded(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use this video");
      setBusy(false);
    }
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files[0]);
        }}
        className={`flex h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed transition-colors ${drag ? "border-accent bg-accent-tint" : "border-line-strong bg-panel hover:border-accent hover:bg-accent-tint/40"} ${busy ? "pointer-events-none" : ""}`}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-tint text-accent">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
        </span>
        <span className="text-[15px] font-bold">{busy ? "Uploading" : "Drop a video or click to upload"}</span>
        {!busy && <span className="text-[12.5px] text-soft">MP4, MOV or WebM</span>}
        <input type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
      </label>
      {error && <p className="mt-2 text-[13px] text-red-500">{error}</p>}
    </div>
  );
}

export function Thumb({ r, className }: { r: Reference; className?: string }) {
  const original = r.analysis?.segments[0]?.thumb ?? r.thumbUrl;
  // The small cover first; if its link fails (expired, missing), fall back to the full thumbnail.
  const [coverFailed, setCoverFailed] = useState(false);
  const thumb = r.coverUrl && !coverFailed ? r.coverUrl : original;
  if (thumb)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={thumb} alt="" loading="lazy" decoding="async" onError={thumb === r.coverUrl ? () => setCoverFailed(true) : undefined} className={`object-cover ${className ?? ""}`} />
    );
  if (r.mediaId) return <MediaVideo src={`/api/media/${r.mediaId}#t=0.5`} muted preload="metadata" className={`object-cover ${className ?? ""}`} />;
  return (
    <span className={`flex items-center justify-center bg-raised text-soft ${className ?? ""}`}>
      <LinkIcon className="h-4 w-4" />
    </span>
  );
}

