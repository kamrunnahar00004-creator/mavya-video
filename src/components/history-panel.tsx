"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { buildFiles, faceKey, type Entry, type FileSources } from "@/lib/my-files";
import { loadFiles, peekFiles } from "@/lib/files-client";
import { ThumbImg } from "@/components/thumb-img";
import { claimPlayback, usePlaybackClaims } from "@/components/run-preview";
import { Check, CirclePlus, Download, Film, FolderOpen, Loader2, MoreVertical, Music, Pause, Play, Trash2, X } from "lucide-react";
import { characterById } from "@/lib/characters";
import { clipSrc, demoClips } from "@/lib/edit";
import { downloadHref, exportFileName } from "@/lib/export-name";
import { AVATAR_TONES } from "@/lib/client";
import { fmtDate, fmtTime, type Asset, type Reference, type Run, type SoundPiece } from "@/lib/types";
import { AvatarPlaceholder } from "@/components/frames";
import { HookPreview, embedUrl } from "@/components/source-picker";

type Face = NonNullable<Run["hook"]["face"]>;
type Generated = NonNullable<Run["hook"]["generated"]>;
type Tab = "hooks" | "characters" | "generated" | "demos" | "uploads" | "music" | "exports";
type Sort = "new" | "old";

const TABS: { id: Tab; label: string }[] = [
  { id: "generated", label: "Generated hooks" },
  { id: "characters", label: "Characters" },
  { id: "demos", label: "Demos" },
  { id: "uploads", label: "Uploaded" },
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
  uploads: [],
  music: [{ id: "all", label: "All" }, { id: "song", label: "Songs" }, { id: "upload", label: "Uploads" }, { id: "hook", label: "Hook sounds" }],
  exports: [],
};


/**
 * "My files": the history of everything ever used or made, across all videos, newest first: hooks (library or
 * uploaded), characters and photos, generated hooks (every version), demos as they were cut, music, exports.
 * Use replaces that part of the open video (an old generated hook also brings its hook and character).
 */
export function HistoryPanel({ run, refs, refreshKey, initialTab, onClose, onUseHook, onUseFace, onUseGenerated, onUseDemo, onUseUpload, onUseSound }: {
  /** An uploaded clip goes into this video's demo. */
  /** One upload, or several picked together (Select in the Uploaded tab). */
  onUseUpload: (a: Asset[]) => void;
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
  onUseDemo: (demo: { src: string; seconds: number }, from: Run) => void;
  onUseSound: (p: SoundPiece) => void;
}) {
  const [listError, setListError] = useState<string | null>(null);
  // The last list at once (read on hover of My files), then refreshed.
  const [sources, setSources] = useState<FileSources | null>(peekFiles);
  const opened = useRef(false);
  const [tab, setTab] = useState<Tab>(initialTab ?? "generated");
  // Nothing plays in the grid: a click opens it in a popup (a library hook opens its detail popup).
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [hookView, setHookView] = useState<{ r: Reference; onUse?: () => void } | null>(null);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<Sort>("new");
  const [prefs, setPrefs] = useState<{ names: Record<string, string>; hidden: string[] }>({ names: {}, hidden: [] });
  // Uploaded tab: Select turns the grid into checkboxes, for Use or Delete on many clips at once.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const stopSelecting = () => { setSelecting(false); setSelected([]); setConfirmDelete(false); };
  useEffect(() => {
    let alive = true;
    void fetch("/api/file-prefs").then((r) => (r.ok ? r.json() : null)).then((p) => { if (alive && p?.names) setPrefs(p); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  // Everything at once (founder 2026-11-09: only the first 24 uploads loaded, the rest behind a button above the header).
  useEffect(() => {
    let alive = true;
    // On opening, a read started by hovering My files is used; one that finished before is refreshed (the list may have
    // changed). A refresh (refreshKey: something was added) always reads afresh (Codex 2026-11-09).
    const fresh = opened.current ? true : Boolean(peekFiles());
    opened.current = true;
    loadFiles(fresh)
      .then((s) => { if (alive) { setSources(s); setListError(null); } })
      .catch(() => { if (alive) setListError("List is unavailable. Try again."); });
    return () => { alive = false; };
  }, [refreshKey]);

  const runs = sources?.runs ?? null;
  // Hook cards: the live library's (with their covers) over the saved ones.
  const files = useMemo(() => buildFiles({ ...(sources ?? { runs: [], generations: [], exports: [], assets: [] }), refs: [...new Map([...(sources?.refs ?? []), ...refs].map((r) => [r.id, r])).values()] }, run), [sources, refs, run]);
  const { hooks, faces, generated, demos, uploads, music, exports } = files;
  const demoNow = demoClips(run).length === 1 ? clipSrc(demoClips(run)[0]) : null;
  const soundsNow = new Set((run.sounds ?? (run.sound ? [run.sound] : [])).map((p) => p.src));
  const usedNow = new Set([...demoClips(run).map((c) => c.mediaId), run.hook.generated?.src.split("/").pop()]);

  // Removed from My files (Delete in the ⋮ menu) are left out everywhere here.
  const shown = <T,>(list: Entry<T>[]) => list.filter((x) => !prefs.hidden.includes(x.key));
  const pick = <T,>(list: Entry<T>[]) =>
    shown(list)
      .filter((x) => filter === "all" || (filter === "this" ? x.runId === run.id : x.kind === filter))
      .sort((a, b) => (sort === "new" ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)));
  const uploadList = pick(uploads);
  const counts: Record<Tab, number> = { hooks: shown(hooks).length, characters: shown(faces).length, generated: shown(generated).length, demos: shown(demos).length, uploads: shown(uploads).length, music: shown(music).length, exports: shown(exports).length };
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
  /** Delete for several items at once: one save for all of them. */
  const hideMany = (keys: string[]) => {
    setPrefs((p) => ({ names: p.names, hidden: [...new Set([...p.hidden, ...keys])] }));
    void fetch("/api/file-prefs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys, hidden: true }) })
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
          const { demo } = x.value;
          const inUse = demo.src === demoNow;
          const use = () => onUseDemo(demo, x.value.run);
          return (
            <Card key={x.key} onOpen={() => setPlaying({ clips: [{ src: demo.src, start: 0 }], sound: false, onUse: inUse ? undefined : use })} onUse={use} inUse={inUse} {...actions(x.key, `Demo · ${fmtTime(demo.seconds)}`)} meta={meta(x)}>
              <Still src={demo.src} at={Math.min(0.5, demo.seconds / 2)} />
            </Card>
          );
        })}
      </Grid>
    ) : empty("The demo part of every video you export shows here");
  } else if (tab === "uploads") {
    const list = uploadList;
    body = list.length ? (
      <Grid>
        {list.map((x) => {
          const src = `/api/media/${x.value.mediaId}`;
          const inUse = usedNow.has(x.value.mediaId);
          const use = () => onUseUpload([x.value]);
          const on = selected.includes(x.key);
          return (
            <Card key={x.key} onOpen={x.value.kind === "image" ? undefined : () => setPlaying({ clips: [{ src: `${src}?preview=1`, start: 0 }], sound: true, onUse: inUse ? undefined : use })} onUse={use} inUse={inUse} {...actions(x.key, x.value.name)} meta={meta(x)}
              selected={selecting ? on : undefined} onSelect={() => { setConfirmDelete(false); setSelected((k) => (on ? k.filter((y) => y !== x.key) : [...k, x.key])); }}>
              {x.value.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : <Still src={src} />}
            </Card>
          );
        })}
      </Grid>
    ) : empty("Clips you upload show here");
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
            download={downloadHref(x.value.src, exportFileName(x.hookText, x.value.at))}
            downloadName={exportFileName(x.hookText, x.value.at)}
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
    <div className="card flex h-full w-[600px] max-w-[calc(100vw-24px)] flex-col overflow-hidden">
      {listError && <p role="alert" className="px-5 py-2 text-red-500">{listError}</p>}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-[15px] font-bold">
          <FolderOpen className="h-[18px] w-[18px] text-muted" />
          My files
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-text" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex gap-3.5 overflow-x-auto border-b border-line px-4 text-[13px] font-semibold [scrollbar-width:thin]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setFilter("all");
              stopSelecting();
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
          <button key={f.id} type="button" onClick={() => { setFilter(f.id); stopSelecting(); }} className={chip(filter === f.id)}>
            {f.label}
          </button>
        ))}
        {tab === "uploads" && runs && uploadList.length > 0 && (
          <button type="button" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} className={`ml-auto ${chip(selecting)}`}>
            {selecting ? "Cancel" : "Select"}
          </button>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" className={`${tab === "uploads" && runs && uploadList.length > 0 ? "" : "ml-auto "}rounded-lg border border-line bg-panel px-2 py-1 text-[12.5px] font-semibold text-muted outline-none focus:border-accent`}>
          <option value="new">Newest</option>
          <option value="old">Oldest</option>
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{body}</div>
      {selecting && tab === "uploads" && (() => {
        const picked = uploadList.filter((x) => selected.includes(x.key));
        const usable = picked.filter((x) => !usedNow.has(x.value.mediaId));
        const all = picked.length === uploadList.length;
        return (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-[13px]">
            <span className="font-semibold">{picked.length} selected</span>
            <button type="button" onClick={() => { setConfirmDelete(false); setSelected(all ? [] : uploadList.map((x) => x.key)); }} className="font-semibold text-accent hover:underline">
              {all ? "Clear" : "Select all"}
            </button>
            <div className="ml-auto flex items-center gap-2">
              {confirmDelete ? (
                <>
                  <span className="text-muted">Delete {picked.length} from My files?</span>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="btn-secondary px-3 py-1.5">No</button>
                  <button type="button" onClick={() => { hideMany(picked.map((x) => x.key)); stopSelecting(); }} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700">Delete</button>
                </>
              ) : (
                <>
                  <button type="button" disabled={!picked.length} onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 font-semibold text-red-600 hover:border-red-300 disabled:opacity-40">
                    <Trash2 className="h-3.5 w-3.5" />Delete
                  </button>
                  <button type="button" disabled={!usable.length} title={picked.length && !usable.length ? "Already in this video" : undefined} onClick={() => { onUseUpload(usable.map((x) => x.value)); stopSelecting(); }} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 disabled:opacity-40">
                    <CirclePlus className="h-3.5 w-3.5" />Use{usable.length > 1 ? ` ${usable.length}` : ""}
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}
      {playing && <PlayPopup p={playing} onClose={() => setPlaying(null)} />}
      {hookView && <HookPreview r={hookView.r} onClose={() => setHookView(null)} onUse={hookView.onUse ? () => { hookView.onUse?.(); setHookView(null); } : undefined} />}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-3">{children}</div>;
}

type ItemActions = { name: string; onRename: (name: string) => void; onDelete: () => void; onUse?: () => void; inUse?: boolean; download?: string; /** The saved file's name, without ".mp4". */ downloadName?: string };

/** The ⋮ menu on an item: Use (unless it is in use), Download (exports), Delete (removes it from My files). Renaming is a click on the name. */
function ItemMenu({ onUse, inUse, download, downloadName, onDelete, dark = true }: Omit<ItemActions, "name" | "onRename"> & { dark?: boolean }) {
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
          {onUse && !inUse && <button type="button" role="menuitem" onClick={run(onUse)} className={item}><CirclePlus className="h-3.5 w-3.5" />Use</button>}
          {download && <a role="menuitem" href={download} download={downloadName ? `${downloadName}.mp4` : true} onClick={() => setOpen(false)} className={item}><Download className="h-3.5 w-3.5" />Download</a>}
          <button type="button" role="menuitem" onClick={run(onDelete)} className={`${item} text-red-600`}><Trash2 className="h-3.5 w-3.5" />Delete</button>
        </div>
      )}
    </div>
  );
}

/** The item's name; a click turns it into a field (Enter or leaving it saves, Esc cancels, empty = back to the default). */
function NameLine({ name, editing, onEdit, onDone }: { name: string; editing: boolean; onEdit: () => void; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(name);
  const done = useRef(false);
  const finish = (v: string | null) => { if (done.current) return; done.current = true; onDone(v); };
  if (!editing)
    return (
      <button type="button" onClick={onEdit} title="Rename" className="block w-full cursor-text truncate text-left text-[12.5px] font-semibold hover:underline hover:decoration-dotted hover:underline-offset-4">
        {name}
      </button>
    );
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
/** `selected` set (true/false) = Select mode: a click ticks the card instead of playing it, and the ⋮ menu hides. */
function Card({ children, meta, name, onRename, onDelete, onUse, inUse = false, download, downloadName, onOpen, square = false, selected, onSelect }: ItemActions & { children: React.ReactNode; meta: React.ReactNode; onOpen?: () => void; square?: boolean; selected?: boolean; onSelect?: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const selecting = selected !== undefined && !!onSelect;
  const open = selecting ? onSelect : onOpen;
  const box = `relative block w-full overflow-hidden rounded-xl border bg-raised ${inUse ? "border-emerald-500" : "border-line"} ${square ? "aspect-square" : "aspect-[9/16]"}`;
  return (
    <div className="min-w-0">
      <div className="relative">
        {open ? (
          <button type="button" onClick={open} aria-label={selecting ? "Select" : "Play"} aria-pressed={selecting ? selected : undefined} className={`${box} group ${selecting && selected ? "ring-2 ring-accent ring-offset-1" : ""}`}>
            {children}
            {selecting ? (
              <span className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? "border-accent bg-accent text-white" : "border-white bg-black/30"}`}>
                {selected && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
            ) : (
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
              </span>
            </span>
            )}
          </button>
        ) : (
          <div className={box}>{children}</div>
        )}
        {inUse && (
          <span title="In use" aria-label="In use" className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
        {!selecting && (
          <div className="absolute right-1 top-1">
            <ItemMenu onUse={onUse} inUse={inUse} download={download} downloadName={downloadName} onDelete={onDelete} />
          </div>
        )}
      </div>
      <div className="mt-1.5 px-0.5">
        <NameLine key={`${name}|${renaming}`} name={name} editing={renaming} onEdit={() => setRenaming(true)} onDone={(n) => { setRenaming(false); if (n !== null && n.trim() !== name) onRename(n); }} />
        {meta}
      </div>
    </div>
  );
}

/**
 * A still picture of the video (founder 2026-11-09: My files was slow and the screen went black): a small JPEG made
 * once on the server (/api/media/<id>/thumb), never a video. Every card used to decode the original (4K HDR phone
 * clips) in a <video>; an HDR video can switch a Windows screen's display mode. Loaded when scrolled near.
 */
function Still({ src }: { src: string; at?: number }) {
  return <ThumbImg src={src} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />;
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
            <NameLine key={`${name}|${renaming}`} name={name} editing={renaming} onEdit={() => setRenaming(true)} onDone={(n) => { setRenaming(false); if (n !== null && n.trim() !== name) onRename(n); }} />
          </div>
        </div>
        {meta}
      </div>
      <ItemMenu dark={false} onUse={onUse} inUse={inUse} onDelete={onDelete} />
    </div>
  );
}
