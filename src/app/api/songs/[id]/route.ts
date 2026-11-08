import { boundedFetch } from "@/lib/server/bounded-fetch";
import { saveMedia } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";

/** Plays a song's 30-second clip: Deezer clip links expire about 15 minutes after the catalog hands them out, longer
 *  than the song list stays cached, so each play asks Deezer for a fresh link and redirects to it. */
export async function GET(_request: Request, ctx: RouteContext<"/api/songs/[id]">) {
  const { id } = await ctx.params;
  if (!/^\d{1,15}$/.test(id)) return new Response(null, { status: 404 });
  try {
    const track = (await (await boundedFetch(`https://api.deezer.com/track/${id}`, { headers: { "Accept-Language": "en" }, cache: "no-store" })).json()) as { preview?: string };
    if (!track.preview?.startsWith("https://")) return new Response(null, { status: 404 });
    return new Response(null, { status: 302, headers: { Location: track.preview, "Cache-Control": "private, max-age=300" } });
  } catch {
    return new Response(null, { status: 502 });
  }
}

/** Saves a song's 30-second clip into the user's files (Deezer clip links expire after a few hours), so the run keeps playing it. */
export async function POST(_request: Request, ctx: RouteContext<"/api/songs/[id]">) {
  const { id } = await ctx.params;
  if (!/^\d{1,15}$/.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const who = await currentUser();
  if (!who) return signInFirst();
  try {
    const track = (await (await boundedFetch(`https://api.deezer.com/track/${id}`, { headers: { "Accept-Language": "en" }, cache: "no-store" })).json()) as {
      title?: string;
      preview?: string;
      artist?: { name: string };
    };
    if (!track.preview || !track.preview.startsWith("https://")) return Response.json({ error: "This song has no clip" }, { status: 404 });
    const audio = await boundedFetch(track.preview, {}, 10 * 1024 * 1024, 15_000);
    if (!audio.ok) throw new Error("download failed");
    const name = `${track.title ?? "Song"} · ${track.artist?.name ?? ""}`.slice(0, 120);
    // Saved as an asset named without a file extension: My files lists it under Music as a song, with its name, even
    // after the video that used it is deleted (founder 2026-11-09).
    const file = new File([await audio.arrayBuffer()], name, { type: "audio/mpeg" });
    const { mediaId } = await saveMedia(file, true, who);
    return Response.json({ mediaId, name });
  } catch {
    return Response.json({ error: "Could not get this song" }, { status: 502 });
  }
}
