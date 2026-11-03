import { after } from "next/server";
import { internalOk, laneFailed, runFastExport } from "@/lib/server/fast-export";

export const maxDuration = 300;

/**
 * Fast export lane: run a whole export job on Vercel (started by advanceExport, never by browsers). It answers at
 * once and works after the answer, so the short call that starts it can never cut it off.
 */
export async function POST(request: Request) {
  if (!internalOk(request)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { job?: unknown } | null;
  if (typeof body?.job !== "string" || !/^[0-9a-f-]{36}$/i.test(body.job)) return Response.json({ error: "Bad request" }, { status: 400 });
  const job = body.job;
  after(async () => {
    const started = Date.now();
    try {
      await runFastExport(job);
      console.log("fast export", job, `${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (error) {
      console.error("fast export", job, error);
      await laneFailed(job).catch(() => undefined);
    }
  });
  return Response.json({ ok: true }, { status: 202 });
}
