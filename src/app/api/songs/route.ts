/** Real songs for step 5: Deezer's public catalog (trending, top chart, or a search), each with a 30-second clip of the song. */
export type Song = { id: number; title: string; artist: string; cover: string; preview: string; duration: number };

type DeezerTrack = { id: number; title: string; preview: string; duration: number; artist: { name: string }; album: { cover_medium: string } };

/** "Trending" = songs trending on TikTok / Reels, merged from playlists that Deezer editors and record labels keep up to date. */
const TRENDING_PLAYLISTS = [
  4403076402, // TikTok Hits World (Deezer editors)
  1318342457, // Viral Hits 2026, Trending TikTok Sounds (Filtr US)
  2252152846, // Top Trending 2026, Viral TikTok Songs (uDiscover)
  7191822984, // TikTok songs you can't get out of your head 2026 (Filtr)
  10920666262, // Viral Hits 2026, Trending TikTok Songs (Digster)
  1189431431, // TikTok Viral (Digster)
];

const headers = { "Accept-Language": "en" };

async function tracks(url: string): Promise<DeezerTrack[]> {
  const res = await fetch(url, { headers, next: { revalidate: 3600 } });
  const data = (await res.json()) as { data?: DeezerTrack[] };
  return data.data ?? [];
}

const toSong = (t: DeezerTrack): Song => ({ id: t.id, title: t.title, artist: t.artist.name, cover: t.album.cover_medium, preview: t.preview, duration: t.duration });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim().slice(0, 80);
  try {
    let list: DeezerTrack[];
    if (q) list = await tracks(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=40`);
    else if (params.get("list") === "top") list = await tracks("https://api.deezer.com/chart/0/tracks?limit=100");
    else {
      // Interleave the playlists (each one's top songs first), without repeats.
      const lists = await Promise.all(TRENDING_PLAYLISTS.map((id) => tracks(`https://api.deezer.com/playlist/${id}/tracks?limit=100`).catch(() => [])));
      const seen = new Set<string>();
      list = [];
      for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) {
        for (const l of lists) {
          const t = l[i];
          if (!t) continue;
          const key = `${t.title.toLowerCase().replace(/\s*\(.*?\)\s*/g, "")}|${t.artist.name.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          list.push(t);
        }
      }
    }
    return Response.json(list.filter((t) => t.preview).map(toSong));
  } catch {
    return Response.json({ error: "Songs are not available right now" }, { status: 502 });
  }
}
