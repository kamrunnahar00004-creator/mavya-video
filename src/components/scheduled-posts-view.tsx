"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, CircleCheck, CircleX, ExternalLink, LoaderCircle, Plus, RotateCcw, Timer, Trash2, X } from "lucide-react";
import { ThumbImg } from "@/components/thumb-img";
import { CAPTION_MAX, countdown, DEFAULT_TEMPLATES, draftCaptions, type Drafts, fillCaption, finalTimes, randomSlots, seeded, slotMoments, timeProblem, MAX_BATCH, TARGETS, type Post, type Target, type Templates } from "@/lib/scheduled-posts";

type ExportChoice = { mediaId: string; title: string; hook: string; at: string; seconds: number; src: string };

const DAY = 86_400_000;
const NAMES: Record<Target, string> = { instagram: "Instagram", facebook: "Facebook" };
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
/** "Now", read at the click. */
const nowIso = () => new Date().toISOString();
/** Checked at the click against the real clock, not the last tick (Codex 2026-11-15). */
const passedAt = (times: (number | null)[]) => { const now = Date.now(); return times.some((t) => timeProblem(t, now)) ? now : null; };
const without = (o: Record<string, number | null>, id: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== id));
/** A time as a datetime-local value (local), and back. */
const localInput = (t: number) => `${dateInput(t)}T${hhmm(new Date(t).getHours() * 60 + new Date(t).getMinutes())}`;
const fromLocalInput = (v: string) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** Local date (yyyy-mm-dd) + minutes after midnight, as a time. */
const at = (date: string, minutes: number) => { const [y, m, d] = date.split("-").map(Number); return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60).getTime(); };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? "Something went wrong. Try again.");
  return json as T;
}

/**
 * Scheduled posts (owner-only): a week calendar of exported videos that post to Instagram and Facebook by themselves.
 * Lists show still pictures (ThumbImg), never videos (founder 2026-11-09; 2026-11-15: the picker showed black tiles).
 */
export function ScheduledPostsView() {
  const [week, setWeek] = useState(() => weekStart(Date.now()));
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [adding, setAdding] = useState<number | null>(null);
  const [editing, setEditing] = useState<Post | null>(null);
  const [captions, setCaptions] = useState(false);
  const [templates, setTemplates] = useState<Templates>(DEFAULT_TEMPLATES);

  // The week's posts; a reply for a week no longer shown is dropped.
  const shown = useRef(week);
  const load = useCallback(() => call<{ posts: Post[] }>(`/api/posts?from=${new Date(week).toISOString()}&to=${new Date(addDays(week, 7)).toISOString()}`)
    .then((out) => { if (shown.current === week) { setPosts(out.posts); setError(null); } })
    .catch((e: Error) => { if (shown.current === week) { setError(e.message); setPosts((p) => p ?? []); } }), [week]);

  useEffect(() => { shown.current = week; void load(); }, [week, load]);
  const goWeek = (w: number) => { if (w !== week) { setPosts(null); setWeek(w); } };
  useEffect(() => { void call<{ templates: Templates }>("/api/posts/templates").then((o) => setTemplates(o.templates)).catch(() => undefined); }, []);
  // The page's clock moves every 15 s (which days have passed, what is about to post); each countdown ticks by itself
  // (Countdown), so the calendar is not redrawn every second (Codex 2026-11-15). The list refreshes every 15 s while
  // something is about to post or posting.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const busy = (posts ?? []).some((p) => p.state === "posting" || (p.state === "scheduled" && Date.parse(p.at) - now < 5 * 60_000));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [busy, load]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const byDay = (d: number) => (posts ?? []).filter((p) => sameDay(Date.parse(p.at), d)).sort((a, b) => a.at.localeCompare(b.at));
  const counts = { scheduled: 0, posting: 0, posted: 0, failed: 0 };
  for (const p of posts ?? []) counts[p.state]++;

  // Stable, so the memoised cards don't redraw when the page does.
  const retryRef = useCallback((p: Post) => {
    call<{ post: Post }>(`/api/posts/${p.id}`, { method: "PATCH", body: JSON.stringify({ retry: true }) })
      .then((out) => setPosts((all) => (all ?? []).map((x) => x.id === p.id ? out.post : x)))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-6 py-4">
        <h1 className="text-[20px] font-extrabold tracking-tight">Scheduled posts</h1>
        <div className="ml-2 flex items-center gap-1">
          <button type="button" aria-label="Previous week" onClick={() => goWeek(addDays(week, -7))} className="flex h-8 w-8 cursor-pointer items-center justify-center text-muted hover:bg-raised hover:text-text"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => goWeek(weekStart(Date.now()))} className="h-8 cursor-pointer px-2 text-[13px] font-semibold text-muted hover:bg-raised hover:text-text">This week</button>
          <button type="button" aria-label="Next week" onClick={() => goWeek(addDays(week, 7))} className="flex h-8 w-8 cursor-pointer items-center justify-center text-muted hover:bg-raised hover:text-text"><ChevronRight className="h-4 w-4" /></button>
          <span className="ml-2 text-[14px] font-semibold">{new Date(week).toLocaleDateString([], { month: "short", day: "numeric" })} to {new Date(addDays(week, 6)).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span>
        </div>
        <p className="text-[13px] text-soft">{counts.scheduled} scheduled · {counts.posted} posted{counts.failed ? ` · ${counts.failed} failed` : ""}</p>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setCaptions(true)} className="h-9 cursor-pointer border border-line-strong px-3 text-[13px] font-semibold hover:bg-raised">Captions</button>
          <button type="button" onClick={() => setAdding(Math.max(Date.now(), week))} className="btn-primary px-3 py-1.5 text-[13px]"><Plus className="h-4 w-4" />Schedule videos</button>
        </div>
      </header>
      {error && <p role="alert" className="border-b border-line bg-red-50 px-6 py-2 text-[13px] font-semibold text-red-700">{error}</p>}
      <div className="grid min-h-0 flex-1 grid-cols-7 divide-x divide-line overflow-y-auto">
        {days.map((d) => {
          const list = byDay(d);
          const past = addDays(d, 1) <= now;
          return (
            <section key={d} className={`flex min-w-0 flex-col ${sameDay(d, now) ? "bg-accent-tint" : ""}`}>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel/95 px-2 py-2">
                <span className="text-[12.5px] font-bold">{new Date(d).toLocaleDateString([], { weekday: "short", day: "numeric" })}</span>
                {!past && <button type="button" aria-label="Schedule on this day" onClick={() => setAdding(Math.max(d, Date.now()))} className="flex h-6 w-6 cursor-pointer items-center justify-center text-soft hover:bg-raised hover:text-text"><Plus className="h-3.5 w-3.5" /></button>}
              </div>
              <div className="space-y-1.5 p-1.5">
                {posts === null ? <div className="h-24 animate-pulse bg-raised" /> : list.map((p) => <PostCard key={p.id} post={p} onOpen={setEditing} onRetry={retryRef} />)}
                {posts !== null && !list.length && !past && <button type="button" onClick={() => setAdding(Math.max(d, Date.now()))} className="w-full cursor-pointer border border-dashed border-line-strong py-3 text-[12px] text-soft hover:bg-raised hover:text-text">+ Add</button>}
              </div>
            </section>
          );
        })}
      </div>
      {adding !== null && <ScheduleDialog day={adding} templates={templates} onClose={() => setAdding(null)} onDone={(made) => { setAdding(null); setPosts((all) => [...(all ?? []), ...made.filter((p) => Date.parse(p.at) >= week && Date.parse(p.at) < addDays(week, 7))]); }} />}
      {editing && <EditDialog post={editing} onClose={() => setEditing(null)} onSaved={(p) => { setEditing(null); setPosts((all) => p ? (all ?? []).map((x) => x.id === p.id ? p : x).filter((x) => Date.parse(x.at) >= week && Date.parse(x.at) < addDays(week, 7)) : (all ?? []).filter((x) => x.id !== editing.id)); }} />}
      {captions && <CaptionsDialog templates={templates} onClose={() => setCaptions(false)} onSaved={(t) => { setTemplates(t); setCaptions(false); }} />}
    </div>
  );
}

/** The time left before a post goes out, ticking every second on its own. */
function Countdown({ at }: { at: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return <>{countdown(Date.parse(at) - now)}</>;
}

function Status({ post }: { post: Post }) {
  if (post.state === "posted") return <span className="flex items-center gap-1 text-[11px] font-bold text-green-700"><CircleCheck className="h-3.5 w-3.5 fill-green-600 text-white" />Posted</span>;
  if (post.state === "failed") return <span className="flex items-center gap-1 text-[11.5px] font-bold text-red-700"><CircleX className="h-4 w-4" />Failed</span>;
  if (post.state === "posting") return <span className="flex items-center gap-1 text-[11.5px] font-bold text-accent"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Posting</span>;
  return <span className="flex items-center gap-1 text-[11.5px] font-semibold text-muted"><Timer className="h-3.5 w-3.5" /><Countdown at={post.at} /></span>;
}

const EDGE: Record<Post["state"], string> = { scheduled: "border-l-line-strong", posting: "border-l-accent", posted: "border-l-green-600", failed: "border-l-red-600" };

/**
 * One post on the calendar (founder 2026-11-15: "make it better"): picture, time, name, then one row of network logos
 * and the status. A logo is grey until that network has the post, then in colour and a link to it.
 */
const PostCard = memo(function PostCard({ post, onOpen, onRetry }: { post: Post; onOpen: (p: Post) => void; onRetry: (p: Post) => void }) {
  const waiting = TARGETS.map((t) => post.result[t]?.note).find(Boolean);
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
          <div className="mt-auto flex items-center gap-1 pt-1.5">
            {post.targets.map((t) => {
              const url = post.result[t]?.url;
              return url ? (
                <a key={t} href={url} target="_blank" rel="noreferrer" title={`Open on ${NAMES[t]}`} aria-label={`Open on ${NAMES[t]}`} className="transition-transform hover:scale-110"><NetworkLogo t={t} className="h-[18px] w-[18px]" /></a>
              ) : (
                <span key={t} title={`${NAMES[t]}: not posted yet`} className="opacity-40 grayscale"><NetworkLogo t={t} className="h-[18px] w-[18px]" /><span className="sr-only">{NAMES[t]}: not posted yet</span></span>
              );
            })}
            <span className="ml-auto"><Status post={post} /></span>
          </div>
        </div>
      </div>
      {waiting && post.state === "posting" && <p className="px-2 pb-1.5 text-[11px] text-muted">{waiting}</p>}
      {post.state === "failed" && (
        <div className="border-t border-line px-2 py-1.5">
          <p className="line-clamp-2 text-[11px] text-red-700" title={post.error ?? ""}>{post.error}</p>
          <button type="button" onClick={() => onRetry(post)} className="mt-1 flex cursor-pointer items-center gap-1 text-[11.5px] font-bold text-accent hover:underline"><RotateCcw className="h-3 w-3" />Retry</button>
        </div>
      )}
    </div>
  );
});

function Dialog({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1c2633]/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`relative flex max-h-full w-full flex-col bg-panel text-text shadow-[0_24px_64px_-16px_rgba(21,18,31,0.45)] ${wide ? "max-w-[980px]" : "max-w-[560px]"}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[17px] font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 cursor-pointer items-center justify-center text-soft hover:bg-raised hover:text-text"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/**
 * The hook words the caption will use (the video's on-screen hook text now; founder 2026-11-15 chose to see them
 * here rather than change the export). Any caption can still be changed by clicking the post on the calendar.
 */
function HookLine({ hook }: { hook?: string }) {
  return <p className="truncate text-[11px] text-muted" title={hook ?? ""}>Hook: {hook ? `“${hook}”` : <i>none, the caption skips the hook line</i>}</p>;
}

/** The Instagram and Facebook marks, in their own colours (they link to the posts on those apps). */
function NetworkLogo({ t, className = "h-4 w-4" }: { t: Target; className?: string }) {
  // Each logo its own gradient id: many on one page must not share one (Codex 2026-11-15).
  const grad = `ig-${useId().replace(/:/g, "")}`;
  if (t === "facebook") return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}><circle cx="12" cy="12" r="12" fill="#1877F2" /><path fill="#fff" d="M13.4 19.5v-6.3h2.1l.3-2.5h-2.4V9.2c0-.7.2-1.2 1.2-1.2h1.3V5.8c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3v1.8H8.7v2.5h2.1v6.3h2.6z" /></svg>
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

function Targets({ value, onChange }: { value: Target[]; onChange: (t: Target[]) => void }) {
  return (
    <div className="flex gap-4">
      {TARGETS.map((t) => (
        <label key={t} className="flex cursor-pointer items-center gap-1.5 text-[14px] font-semibold">
          <input type="checkbox" checked={value.includes(t)} onChange={(e) => onChange(e.target.checked ? TARGETS.filter((x) => x === t || value.includes(x)) : value.filter((x) => x !== t))} />
          <NetworkLogo t={t} />{NAMES[t]}
        </label>
      ))}
    </div>
  );
}

/**
 * Pick exported videos (founder 2026-11-15). One video: Now, or Schedule at one time. Several: random times through
 * the day, 1.5 to 2 hours apart and never on a round time (against spam filters), rolling over to the next days; any
 * one can be changed by hand. Times are the device's local time, shown with its time zone.
 */
function ScheduleDialog({ day, templates, onClose, onDone }: { day: number; templates: Templates; onClose: () => void; onDone: (posts: Post[]) => void }) {
  const [exports, setExports] = useState<ExportChoice[] | null>(null);
  const [used, setUsed] = useState<Map<string, Post["state"]>>(new Map());
  const [picked, setPicked] = useState<string[]>([]);
  const [date, setDate] = useState(dateInput(day));
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("22:00");
  const [mode, setMode] = useState<"now" | "schedule">("schedule");
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [targets, setTargets] = useState<Target[]>(["instagram", "facebook"]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [opened] = useState(() => Date.now());

  useEffect(() => {
    void call<{ exports: ExportChoice[] }>("/api/posts/exports").then((o) => setExports(o.exports)).catch((e) => { setExports([]); setError((e as Error).message); });
    // Which videos are already on the calendar (60 days back and ahead), to mark them.
    const t = Date.now();
    void call<{ posts: Post[] }>(`/api/posts?from=${new Date(t - 30 * DAY).toISOString()}&to=${new Date(t + 30 * DAY).toISOString()}`).then((o) => setUsed(new Map(o.posts.map((p) => [p.mediaId, p.state])))).catch(() => undefined);
  }, []);

  /** Random times in pick order (randomSlots), from `date`; a first day that is today starts a few minutes from now. */
  const spread = useMemo(() => {
    if (picked.length < 2) return [opened + 60 * 60_000 - ((opened + 60 * 60_000) % (5 * 60_000))];
    const start = at(date, 0);
    // Today: from the clock's own hour and minute (not time since midnight, which a clock change shifts).
    const o = new Date(opened);
    const today = dateInput(opened) === date ? o.getHours() * 60 + o.getMinutes() + 5 : 0;
    const minutes = randomSlots(picked.length, toMinutes(from), toMinutes(to), seeded(seed), today);
    const lo = toMinutes(from), hi = toMinutes(to);
    const clockMin = (t: number) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
    // Inside Earliest-Latest on the local clock; else the next window's start (today's if still before it).
    const fits = (t: number) => clockMin(t) >= lo && clockMin(t) <= hi;
    const nextStart = (t: number) => at(dateInput(clockMin(t) < lo ? t : addDays(t, 1)), lo + (Math.floor(t / 60_000) % 23));
    return slotMoments(minutes, (m) => at(dateInput(addDays(start, Math.floor(m / 1440))), m % 1440), opened + 5 * 60_000, fits, nextStart);
  }, [picked.length, from, to, date, opened, seed]);
  const single = picked.length === 1;
  const now = single && mode === "now";
  // Times set by hand for single videos; the rest follow the spread.
  const [own, setOwn] = useState<Record<string, number | null>>({});
  const times = finalTimes(picked, spread, own);
  // A clock for "has it passed": moves every 15 s while the dialog is open.
  const [clock, setClock] = useState(opened);
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const problems = now ? [] : times.map((t) => timeProblem(t, clock));
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const byId = new Map((exports ?? []).map((e) => [e.mediaId, e]));
  const toggle = (id: string) => {
    if (picked.includes(id)) setOwn((o) => without(o, id));
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_BATCH ? p : [...p, id]);
  };

  // The final review screen: every caption, editable, before anything is scheduled (founder 2026-11-15).
  const [drafts, setDrafts] = useState<Drafts>({});
  const [reviewing, setReviewing] = useState(false);
  function review() {
    if (!picked.length || !targets.length) return;
    const passed = now ? null : passedAt(times);
    if (passed !== null) { setClock(passed); setError("A time has passed. Pick a later one."); return; }
    setError(null);
    setDrafts((kept) => draftCaptions(picked, (id) => byId.get(id)?.hook ?? "", targets, templates, kept));
    setReviewing(true);
  }
  const tooLong = picked.some((id) => targets.some((t) => (drafts[id]?.[t] ?? "").length > CAPTION_MAX));

  async function save() {
    if (!picked.length || !targets.length || tooLong) return;
    // Checked again at the click, not at the last clock tick (Codex 2026-11-15).
    const passed = now ? null : passedAt(times);
    if (passed !== null) { setClock(passed); setReviewing(false); setError("A time has passed. Pick a later one."); return; }
    const postNow = now ? nowIso() : null;
    setSaving(true);
    setError(null);
    try {
      const items = picked.map((id, i) => {
        const e = byId.get(id)!;
        return { mediaId: id, at: postNow ?? new Date(times[i]!).toISOString(), targets, title: e.title, hook: e.hook, captions: Object.fromEntries(targets.map((t) => [t, drafts[id]?.[t] ?? fillCaption(templates[t], e.hook)])) };
      });
      const out = await call<{ posts: Post[] }>("/api/posts", { method: "POST", body: JSON.stringify({ items }) });
      onDone(out.posts);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Dialog title={reviewing ? "Check captions" : "Schedule videos"} onClose={onClose} wide>
      {reviewing ? (
        <div>
          <p className="border-b border-line px-5 py-3 text-[13px] text-muted">Last look before it goes out. Change any caption, then {now ? "post" : "schedule"}.</p>
          <div className="max-h-[62vh] divide-y divide-line overflow-y-auto">
            {picked.map((id, i) => (
              <div key={id} className="flex gap-4 px-5 py-4">
                <ThumbImg src={`/api/media/${id}`} className="aspect-[9/16] w-16 shrink-0 self-start bg-raised object-cover" />
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-[14px] font-bold">{byId.get(id)?.title}</p>
                    <p className="shrink-0 text-[12.5px] font-semibold text-muted">{now ? "Now" : times[i] ? new Date(times[i]!).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</p>
                  </div>
                  <div className={`grid gap-3 ${targets.length > 1 ? "md:grid-cols-2" : ""}`}>
                    {targets.map((t) => {
                      const text = drafts[id]?.[t] ?? "";
                      return (
                        <label key={t} className="block text-[12px] font-semibold">
                          <span className="flex items-center justify-between"><span className="flex items-center gap-1.5"><NetworkLogo t={t} className="h-3.5 w-3.5" />{NAMES[t]}</span><span className={text.length > CAPTION_MAX ? "text-red-600" : "font-normal text-soft"}>{text.length}/{CAPTION_MAX}</span></span>
                          <textarea rows={t === "instagram" ? 6 : 4} value={text} onChange={(e) => setDrafts((d) => ({ ...d, [id]: { ...d[id], [t]: e.target.value } }))} className={`${field} mt-1 resize-y text-[13px]`} />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 border-t border-line px-5 py-3">
            <button type="button" disabled={saving} onClick={() => setReviewing(false)} className="cursor-pointer px-3 py-2 text-[13.5px] font-semibold text-muted hover:bg-raised">Back</button>
            {error && <p role="alert" className="text-[13px] font-semibold text-red-600">{error}</p>}
            <button type="button" disabled={saving || tooLong} onClick={() => void save()} className="btn-primary ml-auto px-5 py-2.5 text-[14px]">
              {saving ? "Publishing..." : now ? "Publish now" : picked.length === 1 ? "Publish on schedule" : `Publish ${picked.length} on schedule`}
            </button>
          </div>
        </div>
      ) : (
      <div className="grid gap-0 md:grid-cols-[1fr_300px]">
        <div className="border-b border-line p-4 md:border-b-0 md:border-r">
          <p className="mb-2 text-[13px] text-muted">Pick exported videos in the order they should go out. {picked.length ? <b className="text-text">{picked.length} picked</b> : null}</p>
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
                    {state && <span className={`absolute right-1 top-1 px-1 text-[10px] font-bold text-white ${state === "posted" ? "bg-green-700" : state === "failed" ? "bg-red-700" : "bg-ink/80"}`}>{state === "posted" ? "Posted" : state === "failed" ? "Failed" : "Scheduled"}</span>}
                    <span className="block truncate px-1 pt-1 text-[11.5px] font-semibold">{e.title}</span>
                    <span className="block px-1 pb-1 text-[10.5px] text-soft">{new Date(e.at).toLocaleDateString([], { month: "short", day: "numeric" })} · {Math.round(e.seconds)} s</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="space-y-3.5 p-4">
          {!picked.length && <p className="text-[13px] text-muted">Pick one video to post now or at a time, or several to spread through the day.</p>}
          {single && (
            <>
              <div className="border border-line bg-raised p-2 text-[12px]"><p className="truncate font-semibold">{byId.get(picked[0])?.title}</p><HookLine hook={byId.get(picked[0])?.hook} /></div>
              <div className="grid grid-cols-2 gap-2">
                {(["now", "schedule"] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`cursor-pointer border-2 py-2 text-[14px] font-bold ${mode === m ? "border-ink bg-accent text-white" : "border-line-strong hover:bg-raised"}`}>{m === "now" ? "Now" : "Schedule"}</button>
                ))}
              </div>
              {mode === "schedule" && (
                <label className="block text-[12.5px] font-semibold">Post at
                  <input type="datetime-local" value={times[0] !== null ? localInput(times[0]!) : ""} min={localInput(opened)} onChange={(e) => { const t = fromLocalInput(e.target.value); setOwn((o) => ({ ...o, [picked[0]]: t })); }}
                    className={`${field} mt-1 ${problems[0] ? "border-red-400" : ""}`} />
                  {problems[0] && <span className="block text-[11px] font-semibold text-red-600">{problems[0]}</span>}
                </label>
              )}
            </>
          )}
          {picked.length > 1 && (
            <>
              <label className="block text-[12.5px] font-semibold">Starting day<input type="date" value={date} min={dateInput(opened)} onChange={(e) => setDate(e.target.value)} className={`${field} mt-1`} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[12.5px] font-semibold">Earliest<input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className={`${field} mt-1`} /></label>
                <label className="block text-[12.5px] font-semibold">Latest<input type="time" value={to} onChange={(e) => setTo(e.target.value)} className={`${field} mt-1`} /></label>
              </div>
              <p className="text-[11.5px] text-soft">Random times, 1.5 to 2 hours apart, so it doesn&apos;t look automated. What doesn&apos;t fit goes to the next day.</p>
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
                      <input type="datetime-local" aria-label={`Time for ${byId.get(id)?.title ?? "video"}`} value={times[i] !== null ? localInput(times[i]!) : ""} min={localInput(opened)}
                        onChange={(e) => { const t = fromLocalInput(e.target.value); setOwn((o) => ({ ...o, [id]: t })); }}
                        className={`min-w-0 flex-1 border bg-panel px-1.5 py-1 text-[12px] ${problems[i] ? "border-red-400" : "border-line-strong"}`} />
                      {Object.hasOwn(own, id) && <button type="button" onClick={() => setOwn((o) => without(o, id))} className="cursor-pointer px-1 text-[11px] font-semibold text-accent hover:underline">Auto</button>}
                    </div>
                    {problems[i] && <p className="text-[11px] font-semibold text-red-600">{problems[i]}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
          {picked.length > 0 && <div><p className="mb-1 text-[12.5px] font-semibold">Post to</p><Targets value={targets} onChange={setTargets} /></div>}
          {picked.length > 0 && !now && <p className="text-[11.5px] text-soft">Times in {zone}.</p>}
          <p className="text-[11.5px] text-soft">Captions come from your Captions templates with each video&apos;s hook filled in. Click a post on the calendar to change its caption or time.</p>
          {error && <p role="alert" className="text-[13px] font-semibold text-red-600">{error}</p>}
          <button type="button" disabled={!picked.length || !targets.length || saving || problems.some(Boolean)} onClick={review} className="btn-primary w-full px-4 py-2.5 text-[14px]">
            Next: check captions
          </button>
        </div>
      </div>
      )}
    </Dialog>
  );
}

/** One post: change its time, networks and captions before it goes out; see its links after. */
function EditDialog({ post, onClose, onSaved }: { post: Post; onClose: () => void; onSaved: (p: Post | null) => void }) {
  const t = Date.parse(post.at);
  const [date, setDate] = useState(dateInput(t));
  const [time, setTime] = useState(hhmm(new Date(t).getHours() * 60 + new Date(t).getMinutes()));
  const [targets, setTargets] = useState<Target[]>(post.targets);
  const [captions, setCaptions] = useState<Post["captions"]>({ instagram: post.captions.instagram ?? "", facebook: post.captions.facebook ?? "", ...post.captions });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editable = post.state === "scheduled";

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const out = await call<{ post: Post }>(`/api/posts/${post.id}`, { method: "PATCH", body: JSON.stringify({ at: new Date(at(date, toMinutes(time))).toISOString(), targets, captions }) });
      onSaved(out.post);
    } catch (e) { setError((e as Error).message); setSaving(false); }
  }
  async function remove() {
    if (!window.confirm(post.state === "posted" ? "Remove it from the calendar? It stays on Instagram and Facebook." : "Remove this scheduled post?")) return;
    setSaving(true);
    try { await call(`/api/posts/${post.id}`, { method: "DELETE" }); onSaved(null); }
    catch (e) { setError((e as Error).message); setSaving(false); }
  }

  const when = new Date(t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <Dialog title={post.title || "Untitled video"} onClose={onClose}>
      <div className="flex gap-5 p-5">
        <video src={`/api/media/${post.mediaId}`} poster={`/api/media/${post.mediaId}/thumb`} preload="none" controls playsInline className="aspect-[9/16] w-[150px] shrink-0 self-start bg-ink object-cover" />
        {editable ? (
          <div className="min-w-0 flex-1 space-y-3">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-muted"><Timer className="h-4 w-4" />Scheduled</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[12.5px] font-semibold">Day<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${field} mt-1`} /></label>
              <label className="block text-[12.5px] font-semibold">Time<input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${field} mt-1`} /></label>
            </div>
            <Targets value={targets} onChange={setTargets} />
            {TARGETS.filter((x) => targets.includes(x)).map((x) => (
              <label key={x} className="block text-[12.5px] font-semibold"><span className="flex items-center gap-1.5"><NetworkLogo t={x} />{NAMES[x]} caption</span>
                <textarea rows={x === "instagram" ? 6 : 3} value={captions[x] ?? ""} onChange={(e) => setCaptions({ ...captions, [x]: e.target.value })} className={`${field} mt-1 resize-y`} />
              </label>
            ))}
            {error && <p role="alert" className="text-[13px] font-semibold text-red-600">{error}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button type="button" disabled={saving || !targets.length} onClick={() => void save()} className="btn-primary px-4 py-2 text-[14px]">Save</button>
              <button type="button" disabled={saving} onClick={() => void remove()} className="ml-auto flex cursor-pointer items-center gap-1 px-2 py-2 text-[13px] font-semibold text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4" />Remove</button>
            </div>
          </div>
        ) : (
          // Gone out (or going): a summary, not greyed-out boxes.
          <div className="min-w-0 flex-1 space-y-4">
            <div>
              {post.state === "posted" && <p className="flex items-center gap-1.5 text-[15px] font-bold text-green-700"><CircleCheck className="h-5 w-5 fill-green-600 text-white" />Posted</p>}
              {post.state === "posting" && <p className="flex items-center gap-1.5 text-[15px] font-bold text-accent"><LoaderCircle className="h-4 w-4 animate-spin" />Posting now</p>}
              {post.state === "failed" && <p className="flex items-center gap-1.5 text-[15px] font-bold text-red-700"><CircleX className="h-5 w-5" />Failed</p>}
              <p className="mt-0.5 text-[13px] text-muted">{when}</p>
              {post.state === "failed" && <p className="mt-1 text-[12.5px] text-red-700">{post.error}</p>}
            </div>
            {post.targets.some((x) => post.result[x]?.url) && (
              <div className="flex flex-wrap gap-2">
                {post.targets.map((x) => post.result[x]?.url && (
                  <a key={x} href={post.result[x]!.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 border border-line-strong px-3 py-2 text-[13px] font-semibold hover:bg-raised">
                    <NetworkLogo t={x} className="h-5 w-5" />{NAMES[x]}<ExternalLink className="h-3.5 w-3.5 text-soft" />
                  </a>
                ))}
              </div>
            )}
            {post.targets.map((x) => (
              <div key={x}>
                <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted"><NetworkLogo t={x} className="h-3.5 w-3.5" />{NAMES[x]} caption</p>
                <p className="whitespace-pre-wrap break-words border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed">{post.captions[x] || <i className="text-soft">No caption</i>}</p>
              </div>
            ))}
            {error && <p role="alert" className="text-[13px] font-semibold text-red-600">{error}</p>}
            {post.state !== "posting" && (
              <button type="button" disabled={saving} onClick={() => void remove()} className="flex cursor-pointer items-center gap-1 px-0 py-1 text-[12.5px] font-semibold text-red-700 hover:underline"><Trash2 className="h-3.5 w-3.5" />Remove from calendar</button>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function CaptionsDialog({ templates, onClose, onSaved }: { templates: Templates; onClose: () => void; onSaved: (t: Templates) => void }) {
  const [value, setValue] = useState<Templates>(templates);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { await call("/api/posts/templates", { method: "PUT", body: JSON.stringify({ templates: value }) }); onSaved(value); }
    catch (e) { setError((e as Error).message); setSaving(false); }
  }
  return (
    <Dialog title="Captions" onClose={onClose}>
      <div className="space-y-3 p-5">
        <p className="flex items-center gap-1.5 text-[13px] text-muted"><CalendarClock className="h-4 w-4" />Used for new scheduled posts. <code className="bg-raised px-1">{"{hook}"}</code> becomes the video&apos;s hook words.</p>
        {TARGETS.map((t) => (
          <label key={t} className="block text-[12.5px] font-semibold">{NAMES[t]}
            <textarea rows={t === "instagram" ? 7 : 4} value={value[t]} onChange={(e) => setValue({ ...value, [t]: e.target.value })} className={`${field} mt-1 resize-y`} />
          </label>
        ))}
        {error && <p role="alert" className="text-[13px] font-semibold text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="button" disabled={saving} onClick={() => void save()} className="btn-primary px-4 py-2 text-[14px]">Save</button>
          <button type="button" onClick={() => setValue(DEFAULT_TEMPLATES)} className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-muted hover:bg-raised">Reset to default</button>
        </div>
      </div>
    </Dialog>
  );
}
