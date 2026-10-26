import { referenceThumbnails } from "@/lib/server/store";
import { currentUser, signInFirst } from "@/lib/server/who";
/** Each image fragment selects a small tile; the whole page shares one cached response/query. */
export async function GET(request: Request) {
  const who = await currentUser();
  if (!who) return signInFirst();
  const params = new URL(request.url).searchParams;
  const raw = params.get("ids") ?? "";
  const ids = raw.split(",");
  const segment = Number(params.get("segment") ?? 0);
  if (raw.length > 900 || ids.length > 24 || !ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) || !Number.isInteger(segment) || segment < 0 || segment > 200) return new Response(null, {status:400});
  try {
    const rows = await referenceThumbnails(ids, segment, who);
    const byId = new Map(rows.map(row => [row.id, row.thumb]));
    const images = ids.map((id, index) => {
      const image = byId.get(id);
      // Never embed SVG, external URLs, arbitrary XML or untrusted attributes.
      if (!image || image.length > 4_000_000 || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return "";
      return `<image x="0" y="${index * 320}" width="180" height="320" preserveAspectRatio="xMidYMid slice" href="${image}"/>`;
    }).join("");
    return new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="320" viewBox="0 0 180 320">${images}</svg>`, {headers:{
      "Content-Type":"image/svg+xml", "Cache-Control":"private, max-age=300", "Vary":"Cookie", "X-Content-Type-Options":"nosniff",
      "Content-Security-Policy":"default-src 'none'; img-src data:; style-src 'none'; sandbox"
    }});
  } catch { return new Response(null, {status:503}); }
}
