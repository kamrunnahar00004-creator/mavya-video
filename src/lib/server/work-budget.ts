import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
const deadlines = new AsyncLocalStorage<AbortSignal>();
export const workSignal = (ms: number) => deadlines.getStore() ? AbortSignal.any([deadlines.getStore()!, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
export const checkBudget = () => deadlines.getStore()?.throwIfAborted();
export const withWorkBudget = <T>(work: () => Promise<T>, ms = 210_000) => deadlines.run(workSignal(ms), work);
