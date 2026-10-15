import { connection } from "next/server";
import { createReference, listReferences, mediaInfo } from "@/lib/server/store";
import { HOOK_STYLES, NICHES } from "@/lib/taxonomy";
import type { Platform } from "@/lib/types";

const PLATFORMS = new Set<Platform>(["tiktok", "instagram", "youtube", "other"]);
const pick = <T extends readonly string[]>(list: T, v: unknown) => (typeof v === "string" && (list as readonly string[]).includes(v) ? v : undefined);

export async function GET(request: Request) {
  await connection();
  const refs = await listReferences();
  const view = new URL(request.url).searchParams.get("view");
  if (view === "covers") return Response.json(refs.map((r) => ({ id: r.id, thumbUrl: r.analysis?.segments[0]?.thumb ?? r.thumbUrl })));
  if (view === "studio") {
    // Curation history and model explanations never appear in the studio.
    const keys = ["id", "title", "platform", "sourceUrl", "views", "mediaId", "mime", "createdAt", "analysis", "owner", "niche", "hookStyle", "thumbUrl", "author", "likes", "comments", "caption", "summary", "recipe", "postedAt", "pending", "review", "followers"] as const;
    return Response.json(refs.map((r) => ({ ...Object.fromEntries(keys.map((k) => [k, r[k]])), ai: r.ai ? { style: r.ai.style } : undefined })));
  }
  return Response.json(refs);
}

/** Add a video file as a reference. `owner: "curated"` puts it in the hook library (curator only). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const mediaId = typeof body?.mediaId === "string" ? body.mediaId : "";
  const info = await mediaInfo(mediaId);
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
  });
  return Response.json(ref, { status: 201 });
}
