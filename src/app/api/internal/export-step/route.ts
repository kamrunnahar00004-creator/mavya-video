import { internalOk, renderStep } from "@/lib/server/fast-export";

export const maxDuration = 300;

/** Fast export lane: render one piece of an export job (called by /api/internal/export-run, never by browsers). */
export async function POST(request: Request) {
  if (!internalOk(request)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { job?: unknown; i?: unknown } | null;
  if (typeof body?.job !== "string" || !/^[0-9a-f-]{36}$/i.test(body.job) || !Number.isInteger(body.i) || (body.i as number) < 0) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    const timing = await renderStep(body.job, body.i as number);
    return timing ? Response.json(timing) : Response.json({ error: "Gone" }, { status: 409 });
  } catch (error) {
    console.error("export step", body.job, body.i, error);
    return Response.json({ error: "Step failed" }, { status: 500 });
  }
}
