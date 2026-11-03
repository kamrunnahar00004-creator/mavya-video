import { internalOk, laneFailed, runFastExport } from "@/lib/server/fast-export";

export const maxDuration = 300;

/** Fast export lane: run a whole export job on Vercel (started by advanceExport, never by browsers). */
export async function POST(request: Request) {
  if (!internalOk(request)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { job?: unknown } | null;
  if (typeof body?.job !== "string" || !/^[0-9a-f-]{36}$/i.test(body.job)) return Response.json({ error: "Bad request" }, { status: 400 });
  const started = Date.now();
  try {
    await runFastExport(body.job);
    console.log("fast export", body.job, `${((Date.now() - started) / 1000).toFixed(1)}s`);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("fast export", body.job, error);
    await laneFailed(body.job).catch(() => undefined);
    return Response.json({ error: "Export failed" }, { status: 500 });
  }
}
