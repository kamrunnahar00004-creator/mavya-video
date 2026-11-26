"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, CircleCheck, Copy, Download, ExternalLink, Eye, LoaderCircle, Plus, Sparkles, Trash2, X } from "lucide-react";
import { ThumbImg } from "@/components/thumb-img";
import { fileDownload } from "@/lib/export-name";
import { CAPTION_MAX, captionFor, DEFAULT_TEMPLATES, tagList, draftCaptions, type Drafts, finalTimes, HASHTAGS, MAX_BATCH, NAMES, NO_APP, randomSlots, seeded, slotMoments, TARGETS, TITLE_MAX, totalViews, type AppProfile, type Post, type Target, type Templates } from "@/lib/scheduled-posts";

type ExportChoice = { mediaId: string; title: string; hook: string; at: string; seconds: number; src: string };

const DAY = 86_400_000;
const field = "w-full border border-line-strong bg-panel px-3 py-2 text-[14px] text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

/** Monday 00:00 (local) of the week holding `t`. */
function weekStart(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
const addDays = (t: number, n: number) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const timeText = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dateInput = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const without = (o: Record<string, number | null>, id: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== id));
/** A time as a datetime-local value (local), and back. */
const localInput = (t: number) => `${dateInput(t)}T${hhmm(new Date(t).getHours() * 60 + new Date(t).getMinutes())}`;
const fromLocalInput = (v: string) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };
/** Local date (yyyy-mm-dd) + minutes after midnight, as a time. */
const at = (date: string, minutes: number) => { const [y, m, d] = date.split("-").map(Number); return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60).getTime(); };
const compact = (n: number) => new Intl.NumberFormat([], { notation: "compact", maximumFractionDigits: 1 }).format(n);

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json?.error ?? "Something went wrong. Try again."), { plans: res.status === 402, status: res.status });
  return json as T;
}

/**
 * Content calendar (founder 2026-11-26): plan exported videos for Instagram, Facebook, TikTok and YouTube Shorts,
 * copy each platform's caption, post by hand, then mark it posted with its link and views. Nothing posts by itself.
 * Lists show still pictures (ThumbImg), never videos (founder 2026-11-09; 2026-11-15: the picker showed black tiles).
 */
export function ScheduledPostsView() {
  const [week, setWeek] = useState(() => weekStart(Date.now()));
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [adding, setAdding] = useState<number | null>(null);
  const [editing, setEditing] = useState<Post | null>(null);
  const [setup, setSetup] = useState(false);
  const [templates, setTemplates] = useState<Templates>(DEFAULT_TEMPLATES);
  const [app, setApp] = useState<AppProfile | null>(null);
  const [setupRev, setSetupRev] = useState("");

  // The week's posts; a reply for a week no longer shown is dropped.
  const shown = useRef(week);
  const load = useCallback(() => call<{ posts: Post[] }>(`/api/posts?from=${new Date(week).toISOString()}&to=${new Date(addDays(week, 7)).toISOString()}`)
    .then((out) => { if (shown.current === week) { setPosts(out.posts); setError(null); } })
    .catch((e: Error) => { if (shown.current === week) { setError(e.message); setPosts((p) => p ?? []); } }), [week]);

  useEffect(() => { shown.current = week; void load(); }, [week, load]);
  const goWeek = (w: number) => { if (w !== week) { setPosts(null); setWeek(w); setMobileDay(null); } };
  // Settings must load before "Your app & captions" opens, or saving it would write defaults over them (Codex 2026-11-26).
  const [settingsError, setSettingsError] = useState(false);
  const loadSettings = useCallback(() => call<{ templates: Templates; app: AppProfile; rev: string }>("/api/posts/templates")
    .then((o) => { setTemplates(o.templates); setApp(o.app); setSetupRev(o.rev); setSettingsError(false); })
    .catch(() => setSettingsError(true)), []);
  useEffect(() => { void loadSettings(); }, [loadSettings]);
  // Which days have passed: moves every minute.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  // The day shown on phones: picked by hand, else today when it is in this week, else Monday.
  const [mobileDay, setMobileDay] = useState<number | null>(null);
  const todayIndex = days.findIndex((d) => sameDay(d, now));
  const shownDay = mobileDay ?? (todayIndex >= 0 ? todayIndex : 0);
  const byDay = (d: number) => (posts ?? []).filter((p) => sameDay(Date.parse(p.at), d)).sort((a, b) => a.at.localeCompare(b.at));
  const planned = (posts ?? []).filter((p) => p.state !== "posted").length;
  const posted = (posts ?? []).length - planned;
  const views = (posts ?? []).reduce((sum, p) => sum + (totalViews(p) ?? 0), 0);
  const replace = (p: Post) => setPosts((all) => (all ?? []).map((x) => x.id === p.id ? p : x).filter((x) => Date.parse(x.at) >= week && Date.parse(x.at) < addDays(week, 7)));

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-6 py-4">
        <h1 className="text-[20px] font-extrabold tracking-tight">Content calendar</h1>
        <div className="ml-2 flex items-center gap-1">
          <button type="button" aria-label="Previous week" onClick={() => goWeek(addDays(week, -7))} className="flex h-8 w-8 cursor-pointer items-center justify-center text-muted hover:bg-raised hover:text-text"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => goWeek(weekStart(Date.now()))} className="h-8 cursor-pointer px-2 text-[13px] font-semibold text-muted hover:bg-raised hover:text-text">This week</button>
          <button type="button" aria-label="Next week" onClick={() => goWeek(addDays(week, 7))} className="flex h-8 w-8 cursor-pointer items-center justify-center text-muted hover:bg-raised hover:text-text"><ChevronRight className="h-4 w-4" /></button>
          <span className="ml-2 text-[14px] font-semibold">{new Date(week).toLocaleDateString([], { month: "short", day: "numeric" })} to {new Date(addDays(week, 6)).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span>
        </div>
        <p className="text-[13px] text-soft">{planned} planned · {posted} posted{views ? ` · ${compact(views)} views` : ""}</p>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" disabled={!app} onClick={() => setSetup(true)} className="h-9 cursor-pointer border border-line-strong px-3 text-[13px] font-semibold hover:bg-raised disabled:cursor-default disabled:opacity-50">Your app & captions</button>
          <button type="button" onClick={() => setAdding(Math.max(Date.now(), week))} className="btn-primary px-3 py-1.5 text-[13px]"><Plus className="h-4 w-4" />Add videos</button>
        </div>
      </header>
      {app && !app.domain && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-accent-tint px-6 py-2.5 text-[13px]">
          <Sparkles className="h-4 w-4 text-accent" />
          <span>Add your app&apos;s link once. Every caption then gets your link and hashtags for each platform.</span>
          <button type="button" onClick={() => setSetup(true)} className="cursor-pointer font-bold text-accent hover:underline">Add your app</button>
        </div>
      )}
      {error && <p role="alert" className="border-b border-line bg-red-50 px-6 py-2 text-[13px] font-semibold text-red-700">{error}</p>}
      {settingsError && <p role="alert" className="border-b border-line bg-red-50 px-6 py-2 text-[13px] font-semibold text-red-700">Couldn&apos;t load your captions. <button type="button" onClick={() => void loadSettings()} className="cursor-pointer underline">Try again</button></p>}
      {/* Phones: one day at a time, picked here (founder 2026-11-26); desktop shows the whole week. */}
      <div role="tablist" aria-label="Day" className="grid grid-cols-7 gap-1 border-b border-line px-2 py-2 md:hidden">
        {days.map((d, i) => (
          <button key={d} type="button" role="tab" aria-selected={i === shownDay} onClick={() => setMobileDay(i)}
            className={`flex cursor-pointer flex-col items-center rounded-lg py-1.5 text-[11px] font-semibold ${i === shownDay ? "bg-accent text-white" : sameDay(d, now) ? "bg-accent-tint text-text" : "text-muted"}`}>
            {new Date(d).toLocaleDateString([], { weekday: "short" }).slice(0, 2)}
            <span className="text-[14px] font-bold">{new Date(d).getDate()}</span>
            <span className={`mt-0.5 h-1 w-1 rounded-full ${byDay(d).length ? (i === shownDay ? "bg-white" : "bg-accent") : "bg-transparent"}`} />
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 divide-x divide-line overflow-y-auto md:grid-cols-7">
        {days.map((d, i) => {
          const list = byDay(d);
          return (
            <section key={d} className={`${i === shownDay ? "flex" : "hidden"} min-w-0 flex-col md:flex ${sameDay(d, now) ? "md:bg-accent-tint" : ""}`}>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel/95 px-2 py-2">
                <span className="text-[12.5px] font-bold">{new Date(d).toLocaleDateString([], { weekday: "short", day: "numeric" })}</span>
                <button type="button" aria-label="Add videos on this day" onClick={() => setAdding(d)} className="flex h-6 w-6 cursor-pointer items-center justify-center text-soft hover:bg-raised hover:text-text"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              <div className="space-y-1.5 p-1.5">
                {posts === null ? <div className="h-24 animate-pulse bg-raised" /> : list.map((p) => <PostCard key={p.id} post={p} onOpen={setEditing} />)}
                {posts !== null && !list.length && addDays(d, 1) > now && <button type="button" onClick={() => setAdding(Math.max(d, Date.now()))} className="w-full cursor-pointer border border-dashed border-line-strong py-3 text-[12px] text-soft hover:bg-raised hover:text-text">+ Add</button>}
              </div>
            </section>
          );
        })}
      </div>
      {adding !== null && <AddDialog day={adding} templates={templates} app={app ?? NO_APP} onClose={() => setAdding(null)} onDone={(made) => { setAdding(null); setPosts((all) => [...(all ?? []), ...made.filter((p) => Date.parse(p.at) >= week && Date.parse(p.at) < addDays(week, 7))]); }} />}
      {editing && <PostDialog post={editing} templates={templates} app={app ?? NO_APP} onStale={() => void load()} onClose={() => setEditing(null)} onSaved={(p) => { setEditing(null); if (p) replace(p); else setPosts((all) => (all ?? []).filter((x) => x.id !== editing.id)); }} />}
      {setup && app && <SetupDialog templates={templates} app={app} rev={setupRev} onClose={() => setSetup(false)} onSaved={(t, a, r) => { setTemplates(t); setApp(a); setSetupRev(r); }} onStale={() => void loadSettings()} />}
    </div>
  );
}

const EDGE: Record<Post["state"], string> = { scheduled: "border-l-line-strong", posted: "border-l-green-600" };

/**
 * One post on the calendar: picture, time, name, then one logo per platform. A logo is grey until it is marked
 * posted there, then in colour (and a link to the post when one was added).
 */
const PostCard = memo(function PostCard({ post, onOpen }: { post: Post; onOpen: (p: Post) => void }) {
  const views = totalViews(post);
  return (
    <div className={`border border-l-[3px] border-line bg-panel transition-colors hover:border-t-line-strong hover:border-r-line-strong hover:border-b-line-strong ${EDGE[post.state]}`}>
      <div className="flex gap-2 p-1.5">
        <button type="button" onClick={() => onOpen(post)} aria-label={`Open ${post.title || "post"}`} className="shrink-0 cursor-pointer">
          <ThumbImg src={`/api/media/${post.mediaId}`} className="aspect-[9/16] w-11 bg-raised object-cover" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <button type="button" onClick={() => onOpen(post)} className="cursor-pointer text-left">
            <span className="block text-[13px] font-bold leading-tight">{timeText(Date.parse(post.at))}</span>
            <span className="block truncate text-[11.5px] text-muted">{post.title || "Untitled video"}</span>
          </button>
          <div className="mt-auto flex flex-wrap items-center gap-1 pt-1.5">
            {post.targets.map((t) => {
              const r = post.result[t];
              if (r?.url) return <a key={t} href={r.url} target="_blank" rel="noreferrer" title={`Open on ${NAMES[t]}`} aria-label={`Open on ${NAMES[t]}`} className="transition-transform hover:scale-110"><NetworkLogo t={t} className="h-4 w-4" /></a>;
              return <span key={t} title={`${NAMES[t]}: ${r?.postedAt ? "posted" : "not posted yet"}`} className={r?.postedAt ? "" : "opacity-40"}><NetworkLogo t={t} className="h-4 w-4" /><span className="sr-only">{NAMES[t]}: {r?.postedAt ? "posted" : "not posted yet"}</span></span>;
            })}
            <span className="ml-auto pl-1">
              {post.state === "posted"
                ? <span className="flex items-center gap-1 whitespace-nowrap text-[11px] font-bold text-green-700">{views !== null ? <><Eye className="h-3.5 w-3.5" />{compact(views)}</> : <><CircleCheck className="h-3.5 w-3.5 fill-green-600 text-white" />Posted</>}</span>
                : <span className="whitespace-nowrap text-[11px] font-semibold text-muted">Planned</span>}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});

function Dialog({ title, onClose, wide, medium, children }: { title: string; onClose: () => void; wide?: boolean; medium?: boolean; children: React.ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1c2633]/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`relative flex max-h-full w-full flex-col bg-panel text-text shadow-[0_24px_64px_-16px_rgba(21,18,31,0.45)] ${wide ? "max-w-[1040px]" : medium ? "max-w-[780px]" : "max-w-[620px]"}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[17px] font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 cursor-pointer items-center justify-center text-soft hover:bg-raised hover:text-text"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** The hook words the caption will use: the video's own on-screen hook text. */
function HookLine({ hook }: { hook?: string }) {
  return <p className="truncate text-[11px] text-muted" title={hook ?? ""}>Hook: {hook ? `“${hook}”` : <i>none, the caption skips the hook line</i>}</p>;
}

/** Each platform's mark, in its own colours. */
function NetworkLogo({ t, className = "h-4 w-4" }: { t: Target; className?: string }) {
  // Each logo its own gradient id: many on one page must not share one (Codex 2026-11-15).
  const grad = `ig-${useId().replace(/:/g, "")}`;
  if (t === "facebook") return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}><circle cx="12" cy="12" r="12" fill="#1877F2" /><path fill="#fff" d="M13.4 19.5v-6.3h2.1l.3-2.5h-2.4V9.2c0-.7.2-1.2 1.2-1.2h1.3V5.8c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3v1.8H8.7v2.5h2.1v6.3h2.6z" /></svg>
  );
  if (t === "tiktok") return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}><rect width="24" height="24" rx="6" fill="#000" /><path fill="#25F4EE" d="M10.2 10.6v-.8a5.6 5.6 0 0 0-.8-.1 4.7 4.7 0 0 0-2.7 8.6 4.7 4.7 0 0 1 3.5-7.7z" /><path fill="#25F4EE" d="M10.4 18.4a2.2 2.2 0 0 0 2.2-2.1V5.2h2a3.8 3.8 0 0 1-.1-.7h-2.8v11.1a2.2 2.2 0 0 1-3.2 1.9 2.2 2.2 0 0 0 1.9.9zm8-9.6v-.8a3.8 3.8 0 0 1-2.1-.6 3.8 3.8 0 0 0 2.1 1.4z" /><path fill="#FE2C55" d="M16.3 7.4a3.8 3.8 0 0 1-.9-2.5h-.7a3.8 3.8 0 0 0 1.6 2.5zm-6.9 5.5a2.2 2.2 0 0 0-1 4.2 2.2 2.2 0 0 1 2.6-3.5v-2.8a5 5 0 0 0-.8-.1h-.1v2.1a2.2 2.2 0 0 0-.7.1zm9-4.1v2.1a6.3 6.3 0 0 1-3.7-1.2v5.5a4.7 4.7 0 0 1-7.4 3.9 4.7 4.7 0 0 0 8.1-3.2V10.4a6.3 6.3 0 0 0 3.7 1.2V8.9a3.8 3.8 0 0 1-.7-.1z" /><path fill="#fff" d="M14.7 15.9v-5.5a6.3 6.3 0 0 0 3.7 1.2V9.5a3.8 3.8 0 0 1-2.1-1.4 3.8 3.8 0 0 1-1.6-2.5h-2.1v11.1a2.2 2.2 0 0 1-4.2.9 2.2 2.2 0 0 1 2.6-3.5v-2.1a4.7 4.7 0 0 0-3.5 7.7 4.7 4.7 0 0 0 7.2-3.8z" /></svg>
  );
  if (t === "youtube") return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}><rect width="24" height="24" rx="6" fill="#FF0000" /><path fill="#fff" d="M9.8 8.3v7.4l6.2-3.7z" /></svg>
  );
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <defs><radialGradient id={grad} cx="0.3" cy="1.07" r="1.2"><stop offset="0" stopColor="#FFD600" /><stop offset="0.25" stopColor="#FF7A00" /><stop offset="0.5" stopColor="#FF0069" /><stop offset="0.8" stopColor="#D300C5" /><stop offset="1" stopColor="#7638FA" /></radialGradient></defs>
      <rect width="24" height="24" rx="6" fill={`url(#${grad})`} />
      <rect x="5" y="5" width="14" height="14" rx="4" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.3" fill="none" stroke="#fff" strokeWidth="1.8" /><circle cx="16.3" cy="7.7" r="1.05" fill="#fff" />
    </svg>
  );
}

const SHORT: Record<Target, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube" };

/** The platforms as on/off chips, two to a row. */
function Targets({ value, onChange }: { value: Target[]; onChange: (t: Target[]) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {TARGETS.map((t) => {
        const on = value.includes(t);
        return (
          <button key={t} type="button" role="checkbox" aria-checked={on} aria-label={NAMES[t]} onClick={() => onChange(on ? value.filter((x) => x !== t) : TARGETS.filter((x) => x === t || value.includes(x)))}
            className={`flex cursor-pointer items-center gap-1.5 border px-2 py-1.5 text-[12.5px] font-semibold ${on ? "border-accent bg-accent-tint text-text" : "border-line-strong text-muted opacity-60 hover:opacity-100"}`}>
            <NetworkLogo t={t} className="h-4 w-4 shrink-0" />{SHORT[t]}
          </button>
        );
      })}
    </div>
  );
}

/** Copies a caption; shows "Copied" for a moment. */
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1500); return () => clearTimeout(t); }, [done]);
  return (
    <button type="button" onClick={() => void navigator.clipboard.writeText(text).then(() => setDone(true), () => undefined)} className="flex cursor-pointer items-center gap-1 px-1.5 py-0.5 text-[12px] font-semibold text-accent hover:bg-raised">
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{done ? "Copied" : label}
    </button>
  );
}

/** A caption box with its counter; YouTube's first line is the Short's title (100 characters). */
function CaptionBox({ t, value, onChange, rows }: { t: Target; value: string; onChange: (v: string) => void; rows?: number }) {
  const title = value.split("\n")[0] ?? "";
  return (
    <div className="block text-[12px] font-semibold">
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5"><NetworkLogo t={t} className="h-5 w-5" />{NAMES[t]}</span>
        <span className="flex items-center gap-1">
          <span className={value.length > CAPTION_MAX ? "text-red-600" : "font-normal text-soft"}>{value.length}/{CAPTION_MAX}</span>
          <CopyButton text={value} />
        </span>
      </span>
      <textarea aria-label={`${NAMES[t]} caption`} rows={rows ?? 5} value={value} onChange={(e) => onChange(e.target.value)} className={`${field} mt-1 resize-y text-[13px]`} />
      {t === "youtube" && <span className={`block text-[11px] font-normal ${title.length > TITLE_MAX ? "text-red-600" : "text-soft"}`}>First line is the Short&apos;s title ({title.length}/{TITLE_MAX}).</span>}
    </div>
  );
}

/**
 * Pick exported videos for the calendar. One video: a time. Several: spread through the days, 1.5 to 2 hours apart;
 * any one can be changed by hand. Times may be in the past, to log videos already posted. Then a last look at every
 * caption before saving.
 */
function AddDialog({ day, templates, app, onClose, onDone }: { day: number; templates: Templates; app: AppProfile; onClose: () => void; onDone: (posts: Post[]) => void }) {
  const [exports, setExports] = useState<ExportChoice[] | null>(null);
  const [used, setUsed] = useState<Map<string, Post["state"]>>(new Map());
  const [picked, setPicked] = useState<string[]>([]);
  const [date, setDate] = useState(dateInput(day));
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("22:00");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [targets, setTargets] = useState<Target[]>([...TARGETS]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [opened] = useState(() => Date.now());

  useEffect(() => {
    void call<{ exports: ExportChoice[] }>("/api/posts/exports").then((o) => setExports(o.exports)).catch((e) => { setExports([]); setError((e as Error).message); });
    // Which videos are already on the calendar (30 days back and ahead), to mark them.
    const t = Date.now();
    void call<{ posts: Post[] }>(`/api/posts?from=${new Date(t - 30 * DAY).toISOString()}&to=${new Date(t + 30 * DAY).toISOString()}`).then((o) => setUsed(new Map(o.posts.map((p) => [p.mediaId, p.state])))).catch(() => undefined);
  }, []);

  /** Times in pick order: one video at the next hour (or 9:00 on a later day); several spread from `date`. */
  const spread = useMemo(() => {
    if (picked.length < 2) {
      const nextHour = opened + 60 * 60_000 - ((opened + 60 * 60_000) % (5 * 60_000));
      return [dateInput(opened) === date ? nextHour : at(date, toMinutes(from))];
    }
    const start = at(date, 0);
    const o = new Date(opened);
    const today = dateInput(opened) === date ? o.getHours() * 60 + o.getMinutes() + 5 : 0;
    const minutes = randomSlots(picked.length, toMinutes(from), toMinutes(to), seeded(seed), today);
    const lo = toMinutes(from), hi = toMinutes(to);
    const clockMin = (t: number) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
    const fits = (t: number) => clockMin(t) >= lo && clockMin(t) <= hi;
    const nextStart = (t: number) => at(dateInput(clockMin(t) < lo ? t : addDays(t, 1)), lo + (Math.floor(t / 60_000) % 23));
    return slotMoments(minutes, (m) => at(dateInput(addDays(start, Math.floor(m / 1440))), m % 1440), 0, fits, nextStart);
  }, [picked.length, from, to, date, opened, seed]);
  const single = picked.length === 1;
  // Times set by hand; the rest follow the spread.
  const [own, setOwn] = useState<Record<string, number | null>>({});
  const times = finalTimes(picked, spread, own);
  const missing = times.some((t) => t === null);
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const byId = new Map((exports ?? []).map((e) => [e.mediaId, e]));
  const toggle = (id: string) => {
    if (picked.includes(id)) setOwn((o) => without(o, id));
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_BATCH ? p : [...p, id]);
  };

  // The review screen: every caption, editable, before anything is saved (founder 2026-11-15).
  const [drafts, setDrafts] = useState<Drafts>({});
  const [reviewing, setReviewing] = useState(false);
  function review() {
    if (!picked.length || !targets.length || missing) return;
    setError(null);
    setDrafts((kept) => draftCaptions(picked, (id) => byId.get(id)?.hook ?? "", targets, templates, app, kept));
    setReviewing(true);
  }
  const tooLong = picked.some((id) => targets.some((t) => (drafts[id]?.[t] ?? "").length > CAPTION_MAX));

  async function save() {
    if (!picked.length || !targets.length || tooLong || missing) return;
    setSaving(true);
    setError(null);
    try {
      const items = picked.map((id, i) => {
        const e = byId.get(id)!;
        return { mediaId: id, at: new Date(times[i]!).toISOString(), targets, title: e.title, hook: e.hook, captions: Object.fromEntries(targets.map((t) => [t, drafts[id]?.[t] ?? captionFor(t, templates[t], e.hook, app)])) };
      });
      const out = await call<{ posts: Post[] }>("/api/posts", { method: "POST", body: JSON.stringify({ items }) });
      onDone(out.posts);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Dialog title={reviewing ? "Check captions" : "Add videos"} onClose={onClose} wide>
      {reviewing ? (
        <div>
          <p className="border-b border-line px-5 py-3 text-[13px] text-muted">Change any caption, then save. You can copy them later from the calendar too.</p>
          <div className="max-h-[62vh] divide-y divide-line overflow-y-auto">
            {picked.map((id, i) => (
              <div key={id} className="flex gap-4 px-5 py-4">
                <ThumbImg src={`/api/media/${id}`} className="aspect-[9/16] w-16 shrink-0 self-start bg-raised object-cover" />
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-[14px] font-bold">{byId.get(id)?.title}</p>
                    <p className="shrink-0 text-[12.5px] font-semibold text-muted">{times[i] ? new Date(times[i]!).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</p>
                  </div>
                  <div className={`grid gap-3 ${targets.length > 1 ? "md:grid-cols-2" : ""}`}>
                    {targets.map((t) => <CaptionBox key={t} t={t} value={drafts[id]?.[t] ?? ""} onChange={(v) => setDrafts((d) => ({ ...d, [id]: { ...d[id], [t]: v } }))} />)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 border-t border-line px-5 py-3">
            <button type="button" disabled={saving} onClick={() => setReviewing(false)} className="cursor-pointer px-3 py-2 text-[13.5px] font-semibold text-muted hover:bg-raised">Back</button>
            {error && <p role="alert" className="text-[13px] font-semibold text-red-600">{error}</p>}
            <button type="button" disabled={saving || tooLong} onClick={() => void save()} className="btn-primary ml-auto px-5 py-2.5 text-[14px]">
              {saving ? "Saving..." : "Save to calendar"}
            </button>
          </div>
        </div>
      ) : (
      <div className="grid gap-0 md:grid-cols-[1fr_300px]">
        <div className="border-b border-line p-4 md:border-b-0 md:border-r">
          <p className="mb-2 text-[13px] text-muted">Pick exported videos in the order you&apos;ll post them. {picked.length ? <b className="text-text">{picked.length} picked</b> : null}</p>
          {exports === null ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">{Array.from({ length: 10 }, (_, i) => <div key={i} className="aspect-[9/16] animate-pulse bg-raised" />)}</div>
          ) : !exports.length ? (
            <p className="py-10 text-center text-[14px] text-muted">No exported videos yet. Export a video first.</p>
          ) : (
            <div className="grid max-h-[60vh] grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 overflow-y-auto">
              {exports.map((e) => {
                const n = picked.indexOf(e.mediaId);
                const state = used.get(e.mediaId);
                return (
                  <button key={e.mediaId} type="button" onClick={() => toggle(e.mediaId)} className={`relative cursor-pointer border-2 text-left ${n >= 0 ? "border-accent" : "border-transparent hover:border-line-strong"}`}>
                    <ThumbImg src={e.src} className="block aspect-[9/16] w-full bg-raised object-cover" />
                    {n >= 0 && <span className="absolute left-1 top-1 flex h-6 min-w-6 items-center justify-center bg-accent px-1 text-[12px] font-bold text-white">{n + 1}</span>}
                    {state && <span className={`absolute right-1 top-1 px-1 text-[10px] font-bold text-white ${state === "posted" ? "bg-green-700" : "bg-ink/80"}`}>{state === "posted" ? "Posted" : "Planned"}</span>}
                    <span className="block truncate px-1 pt-1 text-[11.5px] font-semibold">{e.title}</span>
                    <span className="block px-1 pb-1 text-[10.5px] text-soft">{new Date(e.at).toLocaleDateString([], { month: "short", day: "numeric" })} · {Math.round(e.seconds)} s</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="space-y-3.5 p-4">
          {!picked.length && <p className="text-[13px] text-muted">Pick one video for a time, or several to spread through the days.</p>}
          {single && (
            <>
              <div className="border border-line bg-raised p-2 text-[12px]"><p className="truncate font-semibold">{byId.get(picked[0])?.title}</p><HookLine hook={byId.get(picked[0])?.hook} /></div>
              <label className="block text-[12.5px] font-semibold">When
                <input type="datetime-local" value={times[0] !== null ? localInput(times[0]!) : ""} onChange={(e) => { const t = fromLocalInput(e.target.value); setOwn((o) => ({ ...o, [picked[0]]: t })); }} className={`${field} mt-1`} />
              </label>
            </>
          )}
          {picked.length > 1 && (
            <>
              <label className="block text-[12.5px] font-semibold">Starting day<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${field} mt-1`} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[12.5px] font-semibold">Earliest<input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className={`${field} mt-1`} /></label>
                <label className="block text-[12.5px] font-semibold">Latest<input type="time" value={to} onChange={(e) => setTo(e.target.value)} className={`${field} mt-1`} /></label>
              </div>
              <p className="text-[11.5px] text-soft">Spread 1.5 to 2 hours apart. What doesn&apos;t fit goes to the next day.</p>
              <div className="max-h-[260px] space-y-1.5 overflow-y-auto border border-line bg-raised p-2 text-[12px]">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-soft">Change any time if you want.</p>
                  <button type="button" onClick={() => { setOwn({}); setSeed(Math.floor(Math.random() * 2 ** 31)); }} className="cursor-pointer text-[11px] font-semibold text-accent hover:underline">Shuffle times</button>
                </div>
                {picked.map((id, i) => (
                  <div key={id}>
                    <p className="truncate font-semibold">{i + 1}. {byId.get(id)?.title}</p>
                    <HookLine hook={byId.get(id)?.hook} />
                    <div className="mt-0.5 flex items-center gap-1">
                      <input type="datetime-local" aria-label={`Time for ${byId.get(id)?.title ?? "video"}`} value={times[i] !== null ? localInput(times[i]!) : ""}
                        onChange={(e) => { const t = fromLocalInput(e.target.value); setOwn((o) => ({ ...o, [id]: t })); }}
                        className={`min-w-0 flex-1 border bg-panel px-1.5 py-1 text-[12px] ${times[i] === null ? "border-red-400" : "border-line-strong"}`} />
                      {Object.hasOwn(own, id) && <button type="button" onClick={() => setOwn((o) => without(o, id))} className="cursor-pointer px-1 text-[11px] font-semibold text-accent hover:underline">Auto</button>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {picked.length > 0 && <div><p className="mb-1 text-[12.5px] font-semibold">Platforms</p><Targets value={targets} onChange={setTargets} /></div>}
          {picked.length > 0 && <p className="text-[11.5px] text-soft">Times in {zone}.</p>}
          {!app.domain && picked.length > 0 && <p className="text-[11.5px] text-soft">Tip: add your app under Your app &amp; captions, so captions get your link and hashtags.</p>}
          {error && <p role="alert" className="text-[13px] font-semibold text-red-600">{error}</p>}
          <button type="button" disabled={!picked.length || !targets.length || saving || missing} onClick={review} className="btn-primary w-full px-4 py-2.5 text-[14px]">
            Next
          </button>
        </div>
      </div>
      )}
    </Dialog>
  );
}

type MarkDraft = { posted: boolean; url: string; views: string };

/**
 * One post: download the video, copy each caption, post it yourself, then tick Posted with the link (and views).
 * Time, platforms and captions can change any time.
 */
function PostDialog({ post, templates, app, onStale, onClose, onSaved }: { post: Post; templates: Templates; app: AppProfile; onStale: () => void; onClose: () => void; onSaved: (p: Post | null) => void }) {
  const t = Date.parse(post.at);
  const [when, setWhen] = useState(localInput(t));
  const [targets, setTargets] = useState<Target[]>(post.targets);
  // One platform at a time (founder 2026-11-26: four stacked boxes "looks shit").
  const [tab, setTab] = useState<Target>(post.targets[0] ?? "instagram");
  const active = targets.includes(tab) ? tab : targets[0];
  const [captions, setCaptions] = useState<Post["captions"]>({ ...post.captions });
  const [marks, setMarks] = useState<Record<Target, MarkDraft>>(() => Object.fromEntries(TARGETS.map((x) => {
    const r = post.result[x];
    return [x, { posted: Boolean(r?.postedAt), url: r?.url ?? "", views: typeof r?.views === "number" ? String(r.views) : "" }];
  })) as Record<Target, MarkDraft>);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const download = fileDownload(`/api/media/${post.mediaId}`, post.title || "video");
  const tooLong = targets.some((x) => (captions[x] ?? "").length > CAPTION_MAX);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Unchanged day and time keep the exact moment (a clock-change hour would otherwise shift it). Codex 2026-11-26.
      const sameWhen = when === localInput(t);
      const body = {
        at: sameWhen ? post.at : new Date(fromLocalInput(when)!).toISOString(), targets, rev: post.updatedAt,
        captions: Object.fromEntries(targets.map((x) => [x, captions[x] ?? ""])),
        marks: Object.fromEntries(targets.map((x) => [x, { posted: marks[x].posted, url: marks[x].url, views: marks[x].views }])),
      };
      const out = await call<{ post: Post }>(`/api/posts/${post.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onSaved(out.post);
    } catch (e) {
      // Changed elsewhere: the calendar reloads, so opening it again shows the latest copy.
      if ((e as { status?: number }).status === 409) onStale();
      setError((e as Error).message);
      setSaving(false);
    }
  }
  async function remove() {
    if (!window.confirm("Remove it from the calendar? Nothing changes on the platforms.")) return;
    setSaving(true);
    try { await call(`/api/posts/${post.id}${post.updatedAt ? `?rev=${encodeURIComponent(post.updatedAt)}` : ""}`, { method: "DELETE" }); onSaved(null); }
    catch (e) { if ((e as { status?: number }).status === 409) onStale(); setError((e as Error).message); setSaving(false); }
  }
  const setMark = (x: Target, m: Partial<MarkDraft>) => setMarks((all) => ({ ...all, [x]: { ...all[x], ...m } }));
  // A platform added later starts from its caption format (Codex 2026-11-26: it was blank).
  const pickTargets = (next: Target[]) => {
    setCaptions((c) => ({ ...Object.fromEntries(next.filter((x) => !c[x]).map((x) => [x, captionFor(x, templates[x], post.hook, app)])), ...c }));
    setTargets(next);
  };

  return (
    <Dialog title={post.title || "Untitled video"} onClose={onClose} wide>
      {/* Locked while saving, so nothing typed meanwhile is lost when it closes (Codex 2026-11-26). */}
      <fieldset disabled={saving} className="min-w-0 border-0 p-0">
        <div className="flex flex-col gap-6 p-6 md:flex-row">
          <div className="shrink-0 space-y-3 md:w-[200px]">
            <video src={`/api/media/${post.mediaId}`} poster={`/api/media/${post.mediaId}/thumb`} preload="none" controls playsInline className="aspect-[9/16] w-full bg-ink object-cover" />
            {download && <a href={download.href} download={download.file} className="flex w-full items-center justify-center gap-1.5 border border-line-strong py-2 text-[13px] font-semibold hover:bg-raised"><Download className="h-4 w-4" />Download video</a>}
            <label className="block text-[12.5px] font-semibold">When
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={`${field} mt-1 px-2 text-[13px]`} />
            </label>
            <div><p className="mb-1 text-[12.5px] font-semibold">Platforms</p><Targets value={targets} onChange={pickTargets} /></div>
          </div>
          <div className="min-w-0 flex-1">
            {active ? (
              <>
                <div role="tablist" aria-label="Platform" className="mb-4 flex flex-wrap gap-1 border-b border-line">
                  {TARGETS.filter((x) => targets.includes(x)).map((x) => (
                    <button key={x} type="button" role="tab" aria-selected={active === x} onClick={() => setTab(x)}
                      className={`-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold ${active === x ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}>
                      <NetworkLogo t={x} />{SHORT[x]}{marks[x].posted && <CircleCheck aria-label="posted" className="h-3.5 w-3.5 fill-green-600 text-white" />}
                    </button>
                  ))}
                </div>
                <CaptionBox t={active} rows={9} value={captions[active] ?? ""} onChange={(v) => setCaptions((c) => ({ ...c, [active]: v }))} />
                <div className="mt-4 space-y-2.5 border border-line bg-raised/50 p-3">
                  <label className="flex cursor-pointer items-center gap-2 text-[13.5px] font-semibold">
                    <input type="checkbox" checked={marks[active].posted} onChange={(e) => setMark(active, { posted: e.target.checked })} className="h-4 w-4" />I posted it on {NAMES[active]}
                  </label>
                  {marks[active].posted && (
                    <div className="grid gap-2 sm:grid-cols-[1fr_130px]">
                      <input type="url" aria-label={`${NAMES[active]} post link`} placeholder="Post link (optional)" value={marks[active].url} onChange={(e) => setMark(active, { url: e.target.value })} className={`${field} text-[13px]`} />
                      <input inputMode="numeric" aria-label={`${NAMES[active]} views`} placeholder="Views" value={marks[active].views} onChange={(e) => setMark(active, { views: e.target.value })} className={`${field} text-[13px]`} />
                    </div>
                  )}
                  {marks[active].posted && post.result[active]?.url && <a href={post.result[active]!.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline">Open the post<ExternalLink className="h-3.5 w-3.5" /></a>}
                </div>
              </>
            ) : <p className="py-10 text-center text-[14px] text-muted">Pick at least one platform.</p>}
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-line px-6 py-3">
          <button type="button" disabled={saving} onClick={() => void remove()} className="flex cursor-pointer items-center gap-1 px-2 py-2 text-[13px] font-semibold text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4" />Remove</button>
          {error && <p role="alert" className="text-[13px] font-semibold text-red-600">{error}</p>}
          <button type="button" disabled={saving || !targets.length || tooLong || fromLocalInput(when) === null} onClick={() => void save()} className="btn-primary ml-auto px-5 py-2 text-[14px]">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}Save</button>
        </div>
      </fieldset>
    </Dialog>
  );
}

/**
 * Your app & captions: paste the app's link once and Analyze (AI, paid plans) to get its hashtags, or type them; then
 * the caption format per platform, with {hook}, {domain} and {hashtags} filled in for every video.
 */
function SetupDialog({ templates, app, rev, onClose, onSaved, onStale }: { templates: Templates; app: AppProfile; rev: string; onClose: () => void; onSaved: (t: Templates, a: AppProfile, rev: string) => void; onStale: () => void }) {
  const [currentRev, setCurrentRev] = useState(rev);
  const [value, setValue] = useState<Templates>(templates);
  const [url, setUrl] = useState(app.url || app.domain);
  const [tags, setTags] = useState(app.hashtags.join(" "));
  const [current, setCurrent] = useState<AppProfile>(app);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState(false);
  const [busy, setBusy] = useState<"analyze" | "save" | null>(null);

  async function analyze() {
    setBusy("analyze");
    setError(null);
    setPlans(false);
    try {
      const out = await call<{ app: AppProfile; rev: string }>("/api/posts/app", { method: "POST", body: JSON.stringify({ url, rev: currentRev }) });
      setCurrent(out.app);
      setUrl(out.app.url);
      setTags(out.app.hashtags.join(" "));
      setCurrentRev(out.rev);
      onSaved(templates, out.app, out.rev);
    } catch (e) {
      if ((e as { status?: number }).status === 409) onStale();
      setError((e as Error).message);
      setPlans(Boolean((e as { plans?: boolean }).plans));
    }
    setBusy(null);
  }
  async function save() {
    setBusy("save");
    setError(null);
    try {
      const out = await call<{ templates: Templates; app: AppProfile; rev: string }>("/api/posts/templates", { method: "PUT", body: JSON.stringify({ templates: value, url, hashtags: tags, rev: currentRev }) });
      onSaved(out.templates, out.app, out.rev);
      onClose();
    } catch (e) {
      // Saved elsewhere: the page reloads the latest; this form keeps what was typed.
      if ((e as { status?: number }).status === 409) onStale();
      setError((e as Error).message);
      setBusy(null);
    }
  }
  // Hashtags as chips (founder 2026-11-26: the box hid most of them behind a scrollbar). Kept as one string for Save.
  const list = tagList(tags);
  const preview: AppProfile = { ...current, hashtags: list };
  const [draft, setDraft] = useState("");
  const addTags = (raw: string) => { const next = tagList(`${tags} ${raw}`); if (next.length !== list.length) setTags(next.join(" ")); setDraft(""); };
  const removeTag = (i: number) => setTags(list.filter((_, j) => j !== i).join(" "));
  // One platform at a time (founder 2026-11-26: four boxes at once was "too congested").
  const [tab, setTab] = useState<Target>("instagram");
  const heading = "text-[12px] font-bold uppercase tracking-wide text-soft";
  // The placeholders insert at the cursor, so nobody types braces by hand.
  const box = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = box.current, text = value[tab];
    const at0 = el ? el.selectionStart : text.length, at1 = el ? el.selectionEnd : text.length;
    setValue({ ...value, [tab]: text.slice(0, at0) + token + text.slice(at1) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at0 + token.length, at0 + token.length); });
  };

  return (
    <Dialog title="Your app & captions" onClose={onClose} medium>
      <fieldset disabled={busy !== null} className="min-w-0 border-0 p-0">
        <section className="space-y-3 border-b border-line px-6 py-5">
          <h3 className={heading}>Your app</h3>
          <div className="flex gap-2">
            <input aria-label="Your app's link" value={url} disabled={busy === "analyze"} onChange={(e) => setUrl(e.target.value)} placeholder="yourapp.com" className={`${field} min-w-0 flex-1`} />
            <button type="button" disabled={busy !== null || !url.trim()} onClick={() => void analyze()} className="btn-primary shrink-0 px-4 py-2 text-[14px]">
              {busy === "analyze" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{current.analyzedAt ? "Analyze again" : "Analyze"}
            </button>
          </div>
          <p className="text-[12px] text-soft">{current.name ? <>Analyzed <b className="text-text">{current.name}</b>.</> : "Mavya reads your site once and picks hashtags for your niche."}</p>
          <div>
            <p className="text-[13px] font-semibold">Hashtags</p>
            <div className={`mt-1 flex flex-wrap items-center gap-1.5 border border-line-strong bg-panel p-2 ${busy === "analyze" ? "opacity-60" : ""}`}>
              {list.map((h, i) => (
                <span key={h} className="flex items-center gap-1 bg-raised py-0.5 pl-2 pr-1 text-[12.5px] font-semibold">
                  {h}
                  <button type="button" aria-label={`Remove ${h}`} onClick={() => removeTag(i)} className="cursor-pointer opacity-70 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
                </span>
              ))}
              <input aria-label="Add hashtags" value={draft} disabled={busy === "analyze"} placeholder={list.length ? "Add" : "#appmarketing #indiehacker"}
                onChange={(e) => { const v = e.target.value; if (/[\s,]$/.test(v)) addTags(v); else setDraft(v); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTags(draft); } else if (e.key === "Backspace" && !draft && list.length) removeTag(list.length - 1); }}
                // Pasted on separate lines: each one stays its own tag (Codex 2026-11-26).
                onPaste={(e) => { e.preventDefault(); addTags(`${draft} ${e.clipboardData.getData("text")}`); }}
                onBlur={() => draft && addTags(draft)}
                className="min-w-[110px] flex-1 bg-transparent px-1 py-0.5 text-[13px] outline-none" />
            </div>
            <p className="mt-1.5 text-[12px] text-soft">Order matters: the first {HASHTAGS.youtube} go on every platform, the first {HASHTAGS.instagram} on Instagram and TikTok.</p>
          </div>
        </section>
        <section className="space-y-3 px-6 py-5">
          <h3 className={heading}>Captions</h3>
          <div className="flex items-end border-b border-line">
            <div role="tablist" aria-label="Platform" className="flex gap-1">
              {TARGETS.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={`-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === t ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}>
                  <NetworkLogo t={t} />{NAMES[t]}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setValue({ ...value, [tab]: DEFAULT_TEMPLATES[tab] })} className="ml-auto cursor-pointer whitespace-nowrap pb-2 text-[12px] font-semibold text-muted hover:text-accent">Reset to default</button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1 text-[12px] font-semibold text-soft">Format</p>
              {/* Grows with its text: no scrollbar inside the box. */}
              <textarea ref={box} aria-label={`${NAMES[tab]} caption format`} value={value[tab]} onChange={(e) => setValue({ ...value, [tab]: e.target.value })} className={`${field} min-h-[180px] resize-none text-[13px] leading-relaxed [field-sizing:content]`} />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-soft">
                Add:
                {([["{hook}", "Hook"], ["{domain}", "Link"], ["{hashtags}", "Hashtags"]] as const).map(([k, label]) => <button key={k} type="button" onClick={() => insert(k)} className="cursor-pointer border border-line-strong px-2 py-0.5 font-semibold text-text hover:border-accent hover:text-accent">+ {label}</button>)}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[12px] font-semibold text-soft">Preview</p>
              <p className="min-h-[180px] whitespace-pre-wrap break-words bg-raised px-3 py-2 text-[13px] leading-relaxed">{captionFor(tab, value[tab], "my app had 0 users… then i found this 😳", preview)}</p>
            </div>
          </div>
        </section>
        <div className="flex items-center gap-3 border-t border-line px-6 py-3">
          {error && <p role="alert" className="text-[13px] font-semibold text-red-600">{error}{plans && <> <a href="/pricing" className="underline">See plans</a></>}</p>}
          <button type="button" disabled={busy !== null} onClick={() => void save()} className="btn-primary ml-auto px-5 py-2 text-[14px]">Save</button>
        </div>
      </fieldset>
    </Dialog>
  );
}
