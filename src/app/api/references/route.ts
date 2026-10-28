import { listPage, pageResponse, listError } from "@/lib/server/list-pages";
import { connection } from "next/server";
import { createReference, mediaAccess } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";
import { HOOK_STYLES, NICHES } from "@/lib/taxonomy";
import type { Platform, Reference } from "@/lib/types";

const PLATFORMS = new Set<Platform>(["tiktok", "instagram", "youtube", "other"]);
const pick = <T extends readonly string[]>(list: T, v: unknown) => (typeof v === "string" && (list as readonly string[]).includes(v) ? v : undefined);

export async function GET(request: Request) {
  await connection();
  const who = await currentUser();
  if (!who) return signInFirst();
  try {
  const query = new URL(request.url).searchParams;
  if (query.get("view") === "catalog" && query.get("scope") !== "curated") return Response.json({ error: "Invalid catalog scope" }, { status: 400 });
  const page = await listPage("references", who, request);
  const refs = page.items as import("@/lib/types").Reference[];
  const view = new URL(request.url).searchParams.get("view");
  const respond = (items: unknown[]) => {
    const response = pageResponse(items, page.next);
    if (view !== "catalog" && new URL(request.url).searchParams.get("scope") === "curated") {
      // Session-bound browser cache, never put owned data into a shared CDN cache.
      response.headers.set("Cache-Control", "private, max-age=60, must-revalidate");
      response.headers.set("Vary", "Cookie");
    }
    return response;
  };
  if (view === "catalog") return respond(refs);
  if (view === "covers") return respond(refs.map((r) => ({ id: r.id, thumbUrl: r.analysis?.segments[0]?.thumb ?? r.thumbUrl })));
  if (view === "studio") {
    // Curation history and model explanations never appear in the studio.
    const keys = ["id", "title", "platform", "sourceUrl", "views", "mediaId", "mime", "createdAt", "analysis", "owner", "niche", "hookStyle", "thumbUrl", "author", "likes", "comments", "caption", "summary", "recipe", "postedAt", "pending", "review", "followers", "coverUrl"] as const;
    // The whole-library list carries only the recipe parts a card or a pick reads (85% of its size is the rest).
    const whole = new URL(request.url).searchParams.get("all") === "1";
    const short = (recipe: Reference["recipe"]) => recipe && { onScreenText: recipe.onScreenText?.slice(0, 1), hook: recipe.hook };
    return respond(refs.map((r) => ({ ...Object.fromEntries(keys.map((k) => [k, r[k]])), ai: r.ai ? { style: r.ai.style } : undefined, ...(whole ? { recipe: short(r.recipe), partial: true } : {}) })));
  }
  return respond(refs);
  } catch (error) { return listError(error); }
}

/** Add a video file as a reference. `owner: "curated"` puts it in the hook library (curator only). */
export async function POST(request: Request) {
  const who = await currentUser();
  if (!who) return signInFirst();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const mediaId = typeof body?.mediaId === "string" ? body.mediaId : "";
  const info = await mediaAccess(mediaId, who);
  if (!info || !info.mime.startsWith("video/")) return Response.json({ error: "Upload the video first" }, { status: 400 });

  const platform = PLATFORMS.has(body?.platform as Platform) ? (body?.platform as Platform) : "other";
  const views = typeof body?.views === "number" && Number.isFinite(body.views) && body.views >= 0 ? Math.round(body.views) : null;
  const ref = await createReference({
    title: (typeof body?.title === "string" && body.title.trim().slice(0, 120)) || "Untitled reference",
    platform,
    sourceUrl: typeof body?.sourceUrl === "string" ? body.sourceUrl.trim().slice(0, 500) : "",
    views,
    mediaId,
    mime: info.mime,
    // Only the curator's machine can add to the shared hook library; everyone else's uploads are their own.
    owner: body?.owner === "curated" && process.env.CURATOR === "1" ? "curated" : "user",
    niche: pick(NICHES, body?.niche),
    hookStyle: pick(HOOK_STYLES, body?.hookStyle),
  }, who);
  return Response.json(ref, { status: 201 });
}
