import { GeminiError, geminiJSON } from "@/lib/server/gemini";
import { getRun, updateRun } from "@/lib/server/store";
import type { ProductBrief } from "@/lib/types";

/**
 * Step 1 "Your product": read the user's own website (Gemini opens the URL itself) and write a product brief:
 * what it is, who it is for, the features, the wow moment and the screens to show. Runs only on the Analyze click.
 * DELETE clears it.
 */
const PROMPT = `Open this website and read it: {URL}

It is a software product (an app, a website, a SaaS or an AI tool). Its founder will film a short-form marketing video:
a hook, then a demo of the product on their laptop or phone screen. Write the brief they need, from what the site
actually says. Never invent features, prices, numbers or customers that are not on the site.

Answer with only this JSON, no other text:
{
  "name": "the product name",
  "oneLiner": "what it does, in under 12 words, plain words",
  "audience": "who it is for, specific",
  "problem": "the pain it removes, in the user's words",
  "features": ["3 to 6 concrete things you can do with it"],
  "wowMoment": "the single most impressive thing to show on screen, a visible result",
  "demoFlow": ["3 to 6 screens to show in the demo, in order, each one short, ending on the wow moment"]
}
If the site cannot be opened or is not a software product, answer {"name": ""}.`;

export async function POST(request: Request, ctx: RouteContext<"/api/runs/[id]/product">) {
  const { id } = await ctx.params;
  const run = await getRun(id);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  let raw = typeof body?.url === "string" ? body.url.trim() : "";
  if (raw && !/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".") || raw.length > 500) throw new Error();
  } catch {
    return Response.json({ error: "Enter your website, e.g. yourapp.com" }, { status: 400 });
  }

  let brief: ProductBrief;
  try {
    brief = await geminiJSON<ProductBrief>(PROMPT.replace("{URL}", url.toString()), { urlContext: true, temperature: 0.2 });
  } catch (e) {
    console.error("product brief", e);
    return Response.json({ error: e instanceof GeminiError ? "Couldn't read that site. Try again." : "Something went wrong." }, { status: 502 });
  }
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, n).map((x) => x.trim().slice(0, 200)) : []);
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const clean: ProductBrief = {
    name: str(brief?.name, 80),
    oneLiner: str(brief?.oneLiner, 160),
    audience: str(brief?.audience, 200),
    problem: str(brief?.problem, 300),
    features: list(brief?.features, 6),
    wowMoment: str(brief?.wowMoment, 300),
    demoFlow: list(brief?.demoFlow, 6),
  };
  if (!clean.name) return Response.json({ error: "Couldn't read a product on that site. Check the link." }, { status: 422 });
  // A new product makes the old script stale.
  const updated = await updateRun(id, { product: { url: url.toString(), brief: clean, at: new Date().toISOString() }, script: null });
  return Response.json(updated);
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/runs/[id]/product">) {
  const { id } = await ctx.params;
  const updated = await updateRun(id, { product: null, script: null });
  return updated ? Response.json(updated) : Response.json({ error: "Not found" }, { status: 404 });
}
