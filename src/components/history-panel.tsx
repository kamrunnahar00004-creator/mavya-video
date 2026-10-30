"use client";
import { MediaVideo } from "@/components/media-video";

import { useEffect, useId, useRef, useState } from "react";
import { fetchPage } from "@/lib/list-client";
import { speedOf } from "@/lib/adjust";
import { claimPlayback, usePlaybackClaims } from "@/components/run-preview";
import { Check, Download, Film, FolderOpen, Loader2, MoreVertical, Music, Pause, Pencil, Play, Trash2, X } from "lucide-react";
import { characterById } from "@/lib/characters";
import { clipSrc, demoClips, partsOf } from "@/lib/edit";
import { AVATAR_TONES } from "@/lib/client";
import { fmtDate, fmtTime, type Asset, type DemoClip, type Reference, type Run, type SoundPiece } from "@/lib/types";
import { AvatarPlaceholder } from "@/components/frames";
import { HookPreview, embedUrl } from "@/components/source-picker";

type Face = NonNullable<Run["hook"]["face"]>;
type Generated = NonNullable<Run["hook"]["generated"]>;
type Tab = "hooks" | "characters" | "generated" | "demos" | "music" | "exports";
type Sort = "new" | "old";

const TABS: { id: Tab; label: string }[] = [
  { id: "generated", label: "Generated hooks" },
  { id: "characters", label: "Characters" },
  { id: "demos", label: "Demos" },
  { id: "music", label: "Music" },
  { id: "hooks", label: "Hooks" },
  { id: "exports", label: "Exported" },
];

/** What the popup plays: clips back to back (a demo), each from `start` to `end` in its file. */
type Playing = { clips: { src: string; start: number; end?: number }[]; sound?: boolean; onUse?: () => void; useLabel?: string };

/** Filters per tab (the first one is "All"). */
const FILTERS: Record<Tab, { id: string; label: string }[]> = {
  hooks: [{ id: "all", label: "All" }, { id: "library", label: "Library" }, { id: "upload", label: "Uploaded" }],
  characters: [{ id: "all", label: "All" }, { id: "character", label: "Characters" }, { id: "photo", label: "Photos" }],
  generated: [],
  demos: [],
  music: [{ id: "all", label: "All" }, { id: "song", label: "Songs" }, { id: "upload", label: "Uploads" }, { id: "hook", label: "Hook sounds" }],
  exports: [],
};

/** One thing in the history: when, from which video, which filter it belongs to, and the thing itself. */
type Entry<T> = { key: string; at: string; runId?: string; runTitle?: string; kind: string; value: T };

const title = (r: Run) => (r.title === "Untitled run" ? "Untitled video" : r.title);

/**
 * "My files": the history of everything ever used or made, across all videos, newest first: hooks (library or
 * uploaded), characters and photos, generated hooks (every version), demos as they were cut, music, exports.
 * Use replaces that part of the open video (an old generated hook also brings its hook and character).
 */
export function HistoryPanel({ run, refs, refreshKey, initialTab, onClose, onUseHook, onUseFace, onUseGenerated, onUseDemo, onUseSound }: {
  run: Run;
  refs: Reference[];
  refreshKey?: number;
  /** The tab it opens on (default Hooks). */
  initialTab?: Tab;
  onClose: () => void;
  onUseHook: (r: Reference) => void;
  onUseFace: (f: Face) => void;
  /** `from`: the video it was made in (its hook and character come along). */
  onUseGenerated: (g: Generated, from: Run) => void;
  /** `from`: the video the demo is in (its texts come along). */
  onUseDemo: (clips: DemoClip[], from: Run) => void;
  onUseSound: (p: SoundPiece) => void;
}) {
  const [cursors, setCursors] = useState<(string | null)[]>([]);
  const [historyRefs, setHistoryRefs] = useState<Reference[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tab, setTab] = useState<Tab>(initialTab ?? "generated");
  // Nothing plays in the grid: a click opens it in a popup (a library hook opens its detail popup).
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [hookView, setHookView] = useState<{ r: Reference; onUse?: () => void } | null>(null);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<Sort>("new");
  const [prefs, setPrefs] = useState<{ names: Record<string, string>; hidden: string[] }>({ names: {}, hidden: [] });
  useEffect(() => {
    let alive = true;
    void fetch("/api/file-prefs").then((r) => (r.ok ? r.json() : null)).then((p) => { if (alive && p?.names) setPrefs(p); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchPage<Run>("/api/runs"), fetchPage<Asset>("/api/assets"), fetchPage<Reference>("/api/references?view=studio")])
      .then(([rs, as, hs]) => {
        if (!alive) return;
        setRuns(rs.items); setAssets(as.items); setHistoryRefs(hs.items);
        setCursors([rs.next, as.next, hs.next]); setListError(null);
      })
      .catch(() => { if (alive) setListError("List is unavailable. Try again."); });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const [rs, as, hs] = await Promise.all([
        cursors[0] ? fetchPage<Run>("/api/runs", cursors[0]) : null,
        cursors[1] ? fetchPage<Asset>("/api/assets", cursors[1]) : null,
        cursors[2] ? fetchPage<Reference>("/api/references?view=studio", cursors[2]) : null
      ]);
      if (rs) setRuns(old => [...(old ?? []), ...rs.items]);
      if (as) setAssets(old => [...old, ...as.items]);
      if (hs) setHistoryRefs(old => [...old, ...hs.items]);
      setCursors([rs?.next ?? null, as?.next ?? null, hs?.next ?? null]); setListError(null);
    } catch { setListError("List is unavailable. Try again."); }
    finally { setLoadingMore(false); }
  }
  const availableRefs = [...new Map([...historyRefs, ...refs].map(r => [r.id, r])).values()];
  // The open video as it is now (its saved copy may be a moment behind).
  const all = runs ? [run, ...runs.filter((r) => r.id !== run.id)] : [run];
  const from = (r: Run) => ({ runId: r.id, runTitle: title(r) });

  const hooks: Entry<Reference>[] = [];
  const seenHook = new Set<string>();
  for (const r of [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const ref = availableRefs.find((x) => x.id === r.sourceRefId);
    if (!ref || seenHook.has(ref.id)) continue;
    seenHook.add(ref.id);
    hooks.push({ key: `hook:${ref.id}`, at: r.updatedAt, ...from(r), kind: ref.owner === "user" ? "upload" : "library", value: ref });
  }
  for (const ref of availableRefs) if (ref.owner === "user" && ref.mediaId && !seenHook.has(ref.id)) hooks.push({ key: `hook:${ref.id}`, at: ref.createdAt, kind: "upload", value: ref });

  const faces: Entry<Face>[] = [];
  const seenFace = new Set<string>();
  const faceKey = (f: Face) => (f.kind === "photo" ? `photo:${f.mediaId}` : f.kind === "ai" ? `ai:${f.index}` : f.kind === "character" ? `character:${f.id}` : `described:${f.text}`);
  for (const r of [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const f = r.hook.face;
    if (!f || seenFace.has(faceKey(f))) continue;
    seenFace.add(faceKey(f));
    faces.push({ key: `face:${faceKey(f)}`, at: r.updatedAt, ...from(r), kind: f.kind === "photo" ? "photo" : "character", value: f });
  }
  for (const a of assets) {
    if (a.kind !== "image" || seenFace.has(`photo:${a.mediaId}`)) continue;
    seenFace.add(`photo:${a.mediaId}`);
    faces.push({ key: `face:photo:${a.mediaId}`, at: a.createdAt, kind: "photo", value: { kind: "photo", mediaId: a.mediaId } });
  }

  // Reusing something in another video never lists it twice: each file once, under the video it was first made in.
  const oldestFirst = [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Each generated hook once (picking one in another video does not make a copy).
  const generated: Entry<{ g: Generated; run: Run }>[] = [];
  const seenGen = new Set<string>();
  for (const r of oldestFirst) {
    for (const g of [...(r.hook.versions ?? []), ...(r.hook.generated ? [r.hook.generated] : [])]) {
      if (seenGen.has(g.src)) continue;
      seenGen.add(g.src);
      generated.push({ key: `generated:${g.src}`, at: g.at, ...from(r), kind: "all", value: { g, run: r } });
    }
  }

  // One demo per set of clips (the same files in the same order = the same demo), as they were cut.
  const demoKey = (clips: DemoClip[]) => clips.map((c) => clipSrc(c)).join("|");
  const demos: Entry<{ clips: DemoClip[]; run: Run }>[] = [];
  const seenDemo = new Set<string>();
  for (const r of oldestFirst) {
    const clips = demoClips(r).filter((c) => clipSrc(c));
    if (!clips.length || seenDemo.has(demoKey(clips))) continue;
    seenDemo.add(demoKey(clips));
    demos.push({ key: `demo:${demoKey(clips)}`, at: r.updatedAt, ...from(r), kind: "all", value: { clips, run: r } });
  }
  const demoNow = demoKey(demoClips(run).filter((c) => clipSrc(c)));
  const soundsNow = new Set((run.sounds ?? (run.sound ? [run.sound] : [])).map((p) => p.src));

  const music: Entry<SoundPiece>[] = [];
  const seenSound = new Set<string>();
  for (const r of oldestFirst) {
    for (const p of r.sounds ?? (r.sound ? [{ id: "main", at: 0, row: 0, ...r.sound }] : [])) {
      if (seenSound.has(p.src)) continue;
      seenSound.add(p.src);
      music.push({ key: `music:${p.src}`, at: r.updatedAt, ...from(r), kind: p.kind, value: p });
    }
  }

  const exports: Entry<NonNullable<Run["exports"]>[number]>[] = [];
  for (const r of all) for (const x of r.exports ?? []) exports.push({ key: `export:${x.src}`, at: x.at, ...from(r), kind: "all", value: x });

  // Removed from My files (Delete in the ⋮ menu) are left out everywhere here.
  const shown = <T,>(list: Entry<T>[]) => list.filter((x) => !prefs.hidden.includes(x.key));
  const pick = <T,>(list: Entry<T>[]) =>
    shown(list)
      .filter((x) => filter === "all" || (filter === "this" ? x.runId === run.id : x.kind === filter))
      .sort((a, b) => (sort === "new" ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)));
  const counts: Record<Tab, number> = { hooks: shown(hooks).length, characters: shown(faces).length, generated: shown(generated).length, demos: shown(demos).length, music: shown(music).length, exports: shown(exports).length };
  // The seller's name for an item, else its default; Rename / Delete save at once (the list updates first).
  const nameOf = (key: string, fallback: string) => prefs.names[key] ?? fallback;
  const changePref = (key: string, change: { name?: string; hidden?: boolean }) => {
    setPrefs((p) => {
      const names = { ...p.names };
      if (change.name !== undefined) { if (change.name.trim()) names[key] = change.name.trim().slice(0, 80); else delete names[key]; }
      return { names, hidden: change.hidden ? [...p.hidden, key] : p.hidden };
    });
    void fetch("/api/file-prefs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, ...change }) })
      .then((r) => { if (!r.ok) throw Error(); })
      .catch(() => setListError("Couldn't save. Try again."));
  };
  const actions = (key: string, fallback: string) => ({ name: nameOf(key, fallback), onRename: (name: string) => changePref(key, { name }), onDelete: () => changePref(key, { hidden: true }) });

  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-[12.5px] font-semibold ${on ? "border-ink bg-ink text-white" : "border-line text-muted hover:border-line-strong hover:text-text"}`;
  const meta = (x: Entry<unknown>) => (
    <div className="mt-1 truncate text-[11.5px] text-soft" title={x.runTitle}>
      {x.runTitle ? `${x.runTitle} · ` : ""}
      {fmtDate(x.at)}
    </div>
  );
  const empty = (text: string) => <p className="px-1 py-6 text-center text-[13px] text-soft">{text}</p>;

  let body: React.ReactNode;
  if (!runs) body = <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-soft" />;
  else if (tab === "hooks") {
    const list = pick(hooks);
    body = list.length ? (
      <Grid>
        {list.map((x) => {
          const r = x.value;
          const thumb = r.analysis?.segments[0]?.thumb ?? r.thumbUrl;
          const use = run.sourceRefId === r.id ? undefined : () => onUseHook(r);
          const open = r.mediaId ? () => setPlaying({ clips: [{ src: `/api/media/${r.mediaId}`, start: 0 }], sound: true, onUse: use, useLabel: "Use this hook" }) : embedUrl(r) ? () => setHookView({ r, onUse: use }) : undefined;
          return (
            <Card key={x.key} onOpen={open} onUse={() => onUseHook(r)} inUse={!use} {...actions(x.key, r.author ? `@${r.author}` : r.title)} meta={meta(x)}>
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : r.mediaId ? <Still src={`/api/media/${r.mediaId}`} /> : null}
              <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10.5px] font-bold text-white">{x.kind === "upload" ? "Uploaded" : "Library"}</span>
            </Card>
          );
        })}
      </Grid>
    ) : empty("Hooks you use show here");
  } else if (tab === "characters") {
    const list = pick(faces);
    body = list.length ? (
      <Grid>
        {list.map((x) => {
          const f = x.value;
          const name = f.kind === "character" ? (characterById(f.id)?.name ?? "Character") : f.kind === "photo" ? "Your photo" : f.kind === "ai" ? `AI face ${f.index + 1}` : f.text;
          return (
            <Card key={x.key} square onUse={() => onUseFace(f)} inUse={Boolean(run.hook.face && `face:${faceKey(run.hook.face)}` === x.key)} {...actions(x.key, name)} meta={meta(x)}>
              {f.kind === "character" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={characterById(f.id)?.thumb ?? `/characters/${f.id}.jpg`} alt="" className="h-full w-full object-cover" />
              ) : f.kind === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/${f.mediaId}`} alt="" className="h-full w-full object-cover" />
              ) : f.kind === "ai" ? (
                <AvatarPlaceholder tones={AVATAR_TONES[f.index]} />
              ) : (
                <span className="flex h-full items-center justify-center p-2 text-center text-[12px] font-semibold text-muted">{f.text}</span>
              )}
            </Card>
          );
        })}
      </Grid>
    ) : empty("Characters and photos you use show here");
  } else if (tab === "generated") {
    const list = pick(generated);
    body = list.length ? (
      <Grid>
        {list.map((x) => {
          const inUse = run.hook.generated?.src === x.value.g.src;
          const use = () => onUseGenerated(x.value.g, x.value.run);
          return (
            <Card key={x.key} onOpen={() => setPlaying({ clips: [{ src: x.value.g.src, start: 0 }], sound: true, onUse: inUse ? undefined : use })} onUse={use} inUse={inUse} {...actions(x.key, `Hook · ${fmtTime(x.value.g.seconds)}`)} meta={meta(x)}>
              <Still src={x.value.g.src} />
            </Card>
          );
        })}
      </Grid>
    ) : empty("Hooks you generate show here, every version");
  } else if (tab === "demos") {
    const list = pick(demos);
    body = list.length ? (
      <Grid>
        {list.map((x) => {
          const clips = x.value.clips;
          const first = partsOf({ start: clips[0].start ?? 0, end: clips[0].end ?? clips[0].seconds ?? 3, parts: clips[0].parts });
          const len = clips.reduce((t, c) => t + partsOf({ start: c.start ?? 0, end: c.end ?? c.seconds ?? 3, parts: c.parts }).reduce((a, p) => a + (p.end - p.start), 0) / speedOf(c.adjust), 0);
          const inUse = demoKey(clips) === demoNow;
          const use = () => onUseDemo(clips, x.value.run);
          // The popup plays the demo as it was cut: each clip's kept pieces, back to back.
          const pieces = clips.flatMap((c) => partsOf({ start: c.start ?? 0, end: c.end ?? c.seconds ?? 3, parts: c.parts }).map((p) => ({ src: clipSrc(c) ?? "", start: p.start, end: p.end })));
          return (
            <Card key={x.key} onOpen={() => setPlaying({ clips: pieces, sound: true, onUse: inUse ? undefined : use })} onUse={use} inUse={inUse} {...actions(x.key, `${clips.length} ${clips.length === 1 ? "clip" : "clips"} · ${fmtTime(len)}`)} meta={meta(x)}>
              {/* A frame just inside the kept part: at exactly 0s a metadata-only video often shows nothing. */}
              <Still src={clipSrc(clips[0]) ?? ""} at={Math.min(first[0].start + 0.5, (first[0].start + first[0].end) / 2)} />
            </Card>
          );
        })}
      </Grid>
    ) : empty("Demo clips you cut show here");
  } else if (tab === "music") {
    const list = pick(music);
    body = list.length ? (
      <div className="space-y-1">
        {list.map((x) => (
          <SoundRow key={x.key} p={x.value} meta={meta(x)} onUse={() => onUseSound(x.value)} inUse={soundsNow.has(x.value.src)} {...actions(x.key, x.value.name)} />
        ))}
      </div>
    ) : empty("Songs and sounds you use show here");
  } else {
    const list = pick(exports);
    body = list.length ? (
      <Grid>
        {list.map((x) => (
          <Card
            key={x.key}
            onOpen={() => setPlaying({ clips: [{ src: x.value.src, start: 0 }], sound: true })}
            download={x.value.src}
            {...actions(x.key, `${x.runTitle} · ${fmtTime(x.value.seconds)}`)}
            meta={meta(x)}
          >
            <Still src={x.value.src} />
          </Card>
        ))}
      </Grid>
    ) : empty("Videos you export show here");
  }

  return (
    <div className="card flex h-full w-[500px] max-w-[calc(100vw-24px)] flex-col overflow-hidden">
      {listError && <p role="alert" className="px-5 py-2 text-red-500">{listError}</p>}
      {cursors.some(Boolean) && <button type="button" className="btn-secondary m-3 px-4 py-2" disabled={loadingMore} onClick={() => void loadMore()}>Load more</button>}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-[15px] font-bold">
          <FolderOpen className="h-[18px] w-[18px] text-muted" />
          My files
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-text" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex gap-3.5 overflow-x-auto border-b border-line px-4 text-[13px] font-semibold [scrollbar-width:none]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setFilter("all");
            }}
            className={`-mb-px flex shrink-0 items-center gap-1 border-b-2 py-2.5 ${tab === t.id ? "border-ink text-text" : "border-transparent text-soft hover:text-text"}`}
          >
            {t.label}
            {runs && counts[t.id] > 0 && <span className="text-[11.5px] font-semibold text-soft">{counts[t.id]}</span>}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 px-4 py-2.5">
        {FILTERS[tab].length > 1 && FILTERS[tab].map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)} className={chip(filter === f.id)}>
            {f.label}
          </button>
        ))}
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" className="ml-auto rounded-lg border border-line bg-panel px-2 py-1 text-[12.5px] font-semibold text-muted outline-none focus:border-accent">
          <option value="new">Newest</option>
          <option value="old">Oldest</option>
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{body}</div>
      {playing && <PlayPopup p={playing} onClose={() => setPlaying(null)} />}
      {hookView && <HookPreview r={hookView.r} onClose={() => setHookView(null)} onUse={hookView.onUse ? () => { hookView.onUse?.(); setHookView(null); } : undefined} />}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-3">{children}</div>;
}

type ItemActions = { name: string; onRename: (name: string) => void; onDelete: () => void; onUse?: () => void; inUse?: boolean; download?: string };

/** The ⋮ menu on an item: Use (unless it is in use), Download (exports), Rename, Delete (removes it from My files). */
function ItemMenu({ onUse, inUse, download, onRename, onDelete, dark = true }: Omit<ItemActions, "name" | "onRename"> & { onRename: () => void; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const item = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] font-semibold hover:bg-raised";
  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div ref={box} className="relative">
      <button type="button" aria-label="More" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`flex h-7 w-7 items-center justify-center rounded-full ${dark ? "bg-black/55 text-white hover:bg-black/70" : "text-muted hover:bg-raised hover:text-text"}`}>
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-20 w-36 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-[0_8px_24px_rgba(0,0,0,0.14)]">
          {onUse && !inUse && <button type="button" role="menuitem" onClick={run(onUse)} className={item}>Use</button>}
          {download && <a role="menuitem" href={download} download onClick={() => setOpen(false)} className={item}><Download className="h-3.5 w-3.5" />Download</a>}
          <button type="button" role="menuitem" onClick={run(onRename)} className={item}><Pencil className="h-3.5 w-3.5" />Rename</button>
          <button type="button" role="menuitem" onClick={run(onDelete)} className={`${item} text-red-600`}><Trash2 className="h-3.5 w-3.5" />Delete</button>
        </div>
      )}
    </div>
  );
}

/** The item's name; Rename turns it into a field (Enter or leaving it saves, Esc cancels, empty = back to the default). */
function NameLine({ name, editing, onDone }: { name: string; editing: boolean; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(name);
  const done = useRef(false);
  const finish = (v: string | null) => { if (done.current) return; done.current = true; onDone(v); };
  if (!editing) return <div className="truncate text-[12.5px] font-semibold" title={name}>{name}</div>;
  return (
    <input
      autoFocus
      value={draft}
      maxLength={80}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(draft);
        if (e.key === "Escape") { e.stopPropagation(); finish(null); }
      }}
      aria-label="Name"
      className="w-full rounded-md border border-accent bg-panel px-1.5 py-0.5 text-[12.5px] font-semibold outline-none"
    />
  );
}

/** A history item: the picture (9:16, or square for faces; `onOpen` plays it in a popup), a green check when this video uses it, ⋮ for Use / Rename / Delete. */
function Card({ children, meta, name, onRename, onDelete, onUse, inUse = false, download, onOpen, square = false }: ItemActions & { children: React.ReactNode; meta: React.ReactNode; onOpen?: () => void; square?: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const box = `relative block w-full overflow-hidden rounded-xl border bg-raised ${inUse ? "border-emerald-500" : "border-line"} ${square ? "aspect-square" : "aspect-[9/16]"}`;
  return (
    <div className="min-w-0">
      <div className="relative">
        {onOpen ? (
          <button type="button" onClick={onOpen} aria-label="Play" className={`${box} group`}>
            {children}
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
              </span>
            </span>
          </button>
        ) : (
          <div className={box}>{children}</div>
        )}
        {inUse && (
          <span title="In use" aria-label="In use" className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
        <div className="absolute right-1 top-1">
          <ItemMenu onUse={onUse} inUse={inUse} download={download} onRename={() => setRenaming(true)} onDelete={onDelete} />
        </div>
      </div>
      <div className="mt-1.5 px-0.5">
        <NameLine key={`${name}|${renaming}`} name={name} editing={renaming} onDone={(n) => { setRenaming(false); if (n !== null && n.trim() !== name) onRename(n); }} />
        {meta}
      </div>
    </div>
  );
}

/** A still frame, never playing; it loads only once scrolled into view (a long list stays light). */
function Still({ src, at = 0.5 }: { src: string; at?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setNear(true); }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return (
    <span ref={box} className="pointer-events-none absolute inset-0">
      {near && <MediaVideo src={`${src}#t=${at}`} muted playsInline preload="metadata" className="h-full w-full object-cover" />}
    </span>
  );
}

/** The popup: plays the video (a demo: its pieces back to back) once, with Use under it. Esc or a click outside closes. */
function PlayPopup({ p, onClose }: { p: Playing; onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [i, setI] = useState(0);
  const who = useId();
  const [, setOn] = useState(true);
  usePlaybackClaims(who, (on) => { setOn(on); if (!on) ref.current?.pause(); });
  useEffect(() => { claimPlayback(who); }, [who]);
  useEffect(() => {
    // Esc closes only the popup, not My files under it.
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  const clip = p.clips[i];
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-6" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="fade-in flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="relative aspect-[9/16] h-[min(80vh,820px)] overflow-hidden rounded-2xl bg-black shadow-[0_24px_64px_rgba(0,0,0,0.35)]">
          {clip && (
            <video
              ref={ref}
              key={`${i}|${clip.src}`}
              src={clip.src}
              autoPlay
              playsInline
              controls={p.clips.length === 1}
              muted={!p.sound}
              onLoadedMetadata={(e) => { e.currentTarget.currentTime = clip.start; }}
              onTimeUpdate={(e) => { if (clip.end !== undefined && e.currentTarget.currentTime >= clip.end - 0.05) { if (i < p.clips.length - 1) setI(i + 1); else e.currentTarget.pause(); } }}
              onEnded={() => { if (i < p.clips.length - 1) setI(i + 1); }}
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div className="flex items-center gap-3">
          {p.onUse && (
            <button type="button" onClick={() => { p.onUse?.(); onClose(); }} className="btn-primary px-5 py-2.5 text-[14px]">
              {p.useLabel ?? "Use"}
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg bg-white/90 px-4 py-2.5 text-[14px] font-bold text-ink hover:bg-white">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** A sound in the history: play / pause, name (green check when this video uses it), ⋮ for Use / Rename / Delete. */
function SoundRow({ p, meta, name, onUse, inUse = false, onRename, onDelete }: ItemActions & { p: SoundPiece; meta: React.ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const who = useId();
  usePlaybackClaims(who, setPlaying);
  useEffect(() => { if (!playing) audio.current?.pause(); }, [playing]);
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-raised">
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => {
          const a = audio.current;
          if (!a) return;
          if (playing) a.pause();
          else { claimPlayback(who); void a.play().catch(() => setPlaying(false)); }
        }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-soundtrack-tint text-soundtrack"
      >
        {playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
      </button>
      <audio ref={audio} src={p.src} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13.5px] font-semibold">
          {inUse ? (
            <span title="In use" aria-label="In use" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-2.5 w-2.5" strokeWidth={3} /></span>
          ) : p.kind === "hook" ? <Film className="h-3.5 w-3.5 shrink-0 text-soft" /> : <Music className="h-3.5 w-3.5 shrink-0 text-soft" />}
          <div className="min-w-0 flex-1">
            <NameLine key={`${name}|${renaming}`} name={name} editing={renaming} onDone={(n) => { setRenaming(false); if (n !== null && n.trim() !== name) onRename(n); }} />
          </div>
        </div>
        {meta}
      </div>
      <ItemMenu dark={false} onUse={onUse} inUse={inUse} onRename={() => setRenaming(true)} onDelete={onDelete} />
    </div>
  );
}
