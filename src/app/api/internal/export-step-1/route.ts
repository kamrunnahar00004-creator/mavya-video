// A copy of the piece route under its own name, so it deploys as its own function: Vercel packs simultaneous calls to
// one function onto one machine, and export pieces compete for its CPU (src/lib/server/fast-export.ts spreads them).
export { POST } from "../export-step/route";
export const maxDuration = 300;