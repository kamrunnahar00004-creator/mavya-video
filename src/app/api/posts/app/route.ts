import { claimAnalysis, saveAnalysis } from "@/lib/server/scheduled-posts";
import { noStore, postsUser, unavailable } from "@/lib/server/posts-route";
import { GeminiError, geminiJSON } from "@/lib/server/gemini";
import { adminUser, subscriptionOf } from "@/lib/server/usage";
import { domainOf, tagList } from "@/lib/scheduled-posts";

export const maxDuration = 120;

/**
 * The app analyzer (founder 2026-11-26): reads the user's app website once (Gemini opens the link itself) and finds
 * its hashtags, so every caption gets the app's domain and niche tags. AI, so paid or trial accounts only.
 */
const PROMPT = `Open this website and read it: {URL}

It is an app or software product. Its founder posts short videos (Instagram Reels, TikTok, YouTube Shorts, Facebook
Reels) to market it. Pick the hashtags those videos should use, from what the site actually says.

Rules:
- 10 hashtags, best first: the first 3 matter most (some platforms show only 3).
- Mix the app's own niche (what it does, who it is for) with 2 or 3 broader ones its buyers follow.
- Real, commonly used tags. Lower case, letters and digits only, no spaces.
- Never: other companies' brand names, follow/like-bait tags (followforfollow, like4like, viral, fyp, foryou),
  or anything adult, political or misleading.

Answer with only this JSON, no other text:
{ "name": "the product name", "hashtags": ["#tag1", "#tag2"] }
If the site cannot be opened or is not a software product, answer {"name": ""}.`;

/** Analyze: { url }. */
export async function POST(request: Request) {
  const user = await postsUser();
  if ("response" in user) return user.response;
  const body = (await request.json().catch(() => null)) as { url?: unknown; rev?: unknown } | null;
  if (typeof body?.rev !== "string") return Response.json({ error: "Close this and open it again." }, { status: 400 });
  const rev = body.rev;
  const raw = typeof body?.url === "string" ? body.url.trim().slice(0, 500) : "";
  const domain = domainOf(raw);
  if (!domain) return Response.json({ error: "Enter your app's website, e.g. yourapp.com" }, { status: 400 });
  const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  // Only the site's address and page: no query, credentials or port tricks reach the prompt.
  const url = `https://${parsed.hostname}${parsed.pathname}`;
  let token: string | null;
  try {
    // No free AI, ever (founder rule): a plan or the free trial.
    if (!(await adminUser(user.who)) && !(await subscriptionOf(user.who))) return Response.json({ error: "Choose a plan first.", plans: true }, { status: 402 });
    const claimed = await claimAnalysis(user.who, Date.now(), rev);
    if (claimed === "stale") return Response.json({ error: "Your app or captions changed somewhere else. Close this and open it again." }, { status: 409 });
    token = claimed;
    if (!token) return Response.json({ error: "You've analyzed 5 times today. Try tomorrow, or type your hashtags." }, { status: 429 });
  } catch (error) { return unavailable(error); }
  let found: { name?: unknown; hashtags?: unknown };
  try {
    found = await geminiJSON<{ name?: unknown; hashtags?: unknown }>(PROMPT.replace("{URL}", url), { urlContext: true, temperature: 0.2 });
  } catch (e) {
    console.error("app analyzer", e);
    return Response.json({ error: e instanceof GeminiError ? "Couldn't read that site. Try again." : "Something went wrong." }, { status: 502 });
  }
  const name = typeof found?.name === "string" ? found.name.trim() : "";
  const hashtags = tagList(found?.hashtags);
  if (!name || !hashtags.length) return Response.json({ error: "Couldn't read an app on that site. Check the link." }, { status: 422 });
  try {
    const out = await saveAnalysis(user.who, token, url, { name, hashtags });
    return out ? Response.json(out, { headers: noStore }) : Response.json({ error: "Your app changed while this ran. Analyze again if you want." }, { status: 409 });
  }
  catch (error) { return unavailable(error); }
}
