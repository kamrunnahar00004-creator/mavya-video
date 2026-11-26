// Hook review shortlist (founder 2026-11-26): generated hooks that passed the background eval and got a thumbs up,
// not yet in the cache (src/lib/hook-cache.ts). Claude runs it when the founder asks for hooks to review; the ones
// the founder confirms are added to APPROVED_HOOK_CLIPS. Read-only.
//   node --env-file=.env.local scripts/hook-shortlist.mjs [--all]   (--all: every scored hook, not just the shortlist)
import { readFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase env missing");
const approved = new Set([...readFileSync("src/lib/hook-cache.ts", "utf8").matchAll(/"([0-9a-f-]{36})"/g)].map((m) => m[1]));
const all = process.argv.includes("--all");
const h = { apikey: key, Authorization: `Bearer ${key}` };
// Filtered in the query (passed, thumbs up, not cached yet), then read page by page: nothing is cut off (Codex 2026-11-26).
const base = `generations?select=id,created_at,rating,eval,result,input->>sourceRefId,face:input->hook->face->>id&eval=not.is.null${all ? "" : `&rating=eq.1&eval->>pass=eq.true&id=not.in.(${[...approved].join(",")})`}&order=created_at.desc`;
const rows = [];
for (let offset = 0; ; offset += 500) {
  const res = await fetch(`${url}/rest/v1/${base}&limit=500&offset=${offset}`, { headers: h });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const page = await res.json();
  rows.push(...page);
  if (page.length < 500) break;
}
const refs = [...new Set(rows.map((r) => r.sourceRefId).filter(Boolean))];
const lib = refs.length ? await (await fetch(`${url}/rest/v1/library?select=id,title:data->>title,author:data->>author&id=in.(${refs.join(",")})`, { headers: h })).json() : [];
const byId = new Map(lib.map((l) => [l.id, l]));
if (!rows.length) console.log(all ? "No scored hooks yet." : "Shortlist is empty.");
for (const r of rows) {
  const l = byId.get(r.sourceRefId);
  const s = r.eval?.scores ? Object.entries(r.eval.scores).map(([k, v]) => `${k} ${v}`).join(", ") : `failed: ${r.eval?.failed}`;
  console.log(`${r.id}  ${r.created_at.slice(0, 16)}  ${r.face} + ${l ? `@${l.author ?? "?"} "${(l.title ?? "").slice(0, 50)}"` : r.sourceRefId}`);
  console.log(`   ${r.eval?.pass ? "PASS" : "fail"} (${s}) rating ${r.rating ?? "none"}${approved.has(r.id) ? " [cached]" : ""}  ${r.result?.src ?? ""}`);
  if (r.eval?.notes) console.log(`   ${r.eval.notes}`);
}
