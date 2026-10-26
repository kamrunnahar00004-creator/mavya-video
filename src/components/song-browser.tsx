"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, Pause, Play, X } from "lucide-react";





import type { Song } from "@/app/api/songs/route";




import { claimPlayback, usePlaybackClaims } from "@/components/run-preview";
export function SongBrowser({ busyId, onClose, onUse }: { busyId: number | null; onClose: () => void; onUse: (song: Song) => void }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"viral" | "top">("viral");
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const who = useId();
  const stop = useCallback(() => {
    const a = audio.current;
    if (a) { a.pause(); a.onended = null; a.removeAttribute("src"); a.load(); audio.current = null; }
    setPlaying(null);
  }, []);
  usePlaybackClaims(who, stop);
  useEffect(() => () => audio.current?.pause(), []);
  // Top songs on open; search 350ms after typing stops.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(
      () => {
        fetch(`/api/songs${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : tab === "top" ? "?list=top" : ""}`)
          .then(async (r) => {
            const data = (await r.json()) as Song[] | { error: string };
            if (!alive) return;
            if (Array.isArray(data)) {
              setSongs(data);
              setError(null);
            } else setError(data.error);
          })
          .catch(() => alive && setError("Songs are not available right now"));
      },
      q ? 350 : 0
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, tab]);
  function toggle(song: Song) {
    const same = playing === song.id;
    stop();
    if (same) return;
    claimPlayback(who);
    const a = new Audio(song.preview);
    a.onended = () => { if (audio.current === a) stop(); };
    audio.current = a;
    void a.play().catch(() => { if (audio.current === a) stop(); });
    setPlaying(song.id);
  }
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-6" onClick={onClose}>
      <div className="fade-in flex h-[min(760px,90vh)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_24px_64px_rgba(15,23,42,0.25)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-[18px] font-extrabold tracking-tight">Choose a song</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-soft hover:bg-raised hover:text-text" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 pb-2 pt-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search songs or artists"
            className="w-full rounded-lg border-[1.5px] border-line-strong bg-panel px-3 py-2 text-[14px] outline-none placeholder:text-soft focus:border-accent"
          />
          {q.trim() ? (
            <div className="mt-3 text-[13px] font-semibold text-soft">Results</div>
          ) : (
            <div className="mt-3 flex gap-5 border-b border-line text-[13.5px] font-semibold">
              {(
                [
                  ["viral", "Trending"],
                  ["top", "Top songs"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setSongs(null);
                    setTab(id);
                  }}
                  className={`-mb-px border-b-2 pb-2 ${tab === id ? "border-ink text-text" : "border-transparent text-soft hover:text-text"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
          {error && <p className="px-2 py-3 text-[13px] font-semibold text-red-600">{error}</p>}
          {!songs && !error && <Loader2 className="mx-auto mt-6 h-5 w-5 animate-spin text-soft" />}
          {songs?.length === 0 && <p className="px-2 py-3 text-[13px] text-soft">No songs found</p>}
          {songs?.map((song) => (
            <div key={song.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-raised">
              <button type="button" onClick={() => toggle(song)} aria-label={playing === song.id ? "Pause" : "Play"} className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-ink">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={song.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white">
                  {playing === song.id ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">{song.title}</div>
                <div className="truncate text-[13px] text-soft">{song.artist}</div>
              </div>
              <button type="button" disabled={busyId !== null} onClick={() => onUse(song)} className="flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-[13px] font-bold text-text hover:border-accent hover:text-accent disabled:opacity-60">
                {busyId === song.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Use
              </button>
            </div>
          ))}
        </div>
        <p className="border-t border-line px-5 py-2.5 text-[11.5px] leading-snug text-soft">
          Due to copyright, songs here are 30s previews. For the full song, upload your own mp3, or pick the song in Instagram or TikTok when you post.
        </p>
      </div>
    </div>
  );
}