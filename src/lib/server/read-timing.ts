import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

type Phase = "auth" | "account" | "sql" | "r2";
type Sample = { durations: Record<Phase, number>; active?: Phase };
const reads = new AsyncLocalStorage<Sample>();

/** Request-local durations only. Nested operations belong to their enclosing phase, without double-counting. */
export async function readPhase<T>(phase: Phase, work: () => Promise<T>): Promise<T> {
  const sample = reads.getStore();
  if (!sample || sample.active) return work();
  const started = performance.now();
  try { return await reads.run({ ...sample, active: phase }, work); }
  finally { sample.durations[phase] += performance.now() - started; }
}

/** Only the selected read handlers opt in. No identities, query text, caching or authorization changes. */
export async function readResponse(work: () => Promise<Response>): Promise<Response> {
  const sample: Sample = { durations: { auth: 0, account: 0, sql: 0, r2: 0 } };
  return reads.run(sample, async () => {
    const response = await work();
    response.headers.set("Server-Timing", Object.entries(sample.durations).map(([phase, ms]) => `${phase};dur=${ms.toFixed(2)}`).join(", "));
    return response;
  });
}
