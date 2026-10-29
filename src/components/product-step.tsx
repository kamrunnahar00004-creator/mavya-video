"use client";

import { useState } from "react";
import { Check, Copy, Globe, Loader2, Sparkles } from "lucide-react";
import type { Run, VideoScript } from "@/lib/types";


async function post(url: string, body?: unknown): Promise<{ run?: Run; error?: string; status?: number }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const data = (await res.json().catch(() => null)) as (Run & { error?: string }) | null;
    if (!res.ok || !data) return { error: data?.error ?? "Something went wrong. Try again.", status: res.status };
    return { run: data };
  } catch {
    return { error: "Couldn't reach Mavya. Check your connection." };
  }
}

/** Read the site into a brief. A 409 means the run moved under the request (before migration 0017): try once more. */
export async function readProduct(runId: string, url: string): Promise<{ run?: Run; error?: string }> {
  const first = await post(`/api/runs/${runId}/product`, { url });
  return first.status === 409 ? post(`/api/runs/${runId}/product`, { url }) : first;
}

/** Three new hook lines for this product (Regenerate on the hook text), avoiding the ones already seen. */
export async function newHookLines(runId: string, avoid: string[]): Promise<{ run?: Run; error?: string }> {
  const first = await post(`/api/runs/${runId}/hook-text`, { avoid });
  return first.status === 409 ? post(`/api/runs/${runId}/hook-text`, { avoid }) : first;
}

/** Write the script and demo shot plan for this product and hook. Same single retry on 409. */
export async function writeScript(runId: string): Promise<{ run?: Run; error?: string }> {
  const first = await post(`/api/runs/${runId}/script`);
  return first.status === 409 ? post(`/api/runs/${runId}/script`) : first;
}

/**
 * Step 1 "Your product": the website goes in (paste or Analyze, both explicit; it runs Gemini). The page reads it in
 * the background and moves on at once; `reading` is that request, `error` its failure (the step reopens with it).
 */
export function ProductStep({ product, reading, error, failedUrl, onAnalyze }: { product: Run["product"] | null; reading: boolean; error: string | null; failedUrl?: string; onAnalyze: (url: string) => void }) {
  const [url, setUrl] = useState(failedUrl ?? product?.url ?? "");
  const [editing, setEditing] = useState(false);

  const analyze = (value = url) => {
    if (!value.trim() || reading) return;
    setEditing(false);
    onAnalyze(value.trim());
  };

  const brief = product?.brief;
  if (brief && !editing && !reading && !error) {
    return (
      // The rest of the brief (audience, wow moment, features) is kept for the script and demo plan, not shown.
      <div className="flex items-center gap-4 rounded-2xl border border-line bg-panel p-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent">
          <Globe className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">{brief.name}</p>
          <p className="truncate text-[13.5px] text-muted">{brief.oneLiner}</p>
        </div>
        <button type="button" onClick={() => setEditing(true)} className="rounded-lg px-3 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint">
          Change
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        analyze();
      }}
      className="rounded-2xl border border-line bg-panel p-4"
    >
      <label htmlFor="product-url" className="text-[13.5px] font-semibold">
        Your app or website
      </label>
      <div className="mt-2 flex flex-wrap gap-2.5">
        <input
          id="product-url"
          type="text"
          inputMode="url"
          autoComplete="url"
          value={url}
          disabled={reading}
          onChange={(e) => setUrl(e.target.value)}
          onPaste={(e) => {
            // Pasting a whole link is the action: read it right away, no extra click.
            const pasted = e.clipboardData.getData("text").trim();
            if (!url.trim() && /^(https?:\/\/)?[^\s/]+\.[^\s]{2,}$/i.test(pasted)) {
              e.preventDefault();
              setUrl(pasted);
              analyze(pasted);
            }
          }}
          placeholder="yourapp.com"
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-panel px-3 py-2.5 text-[14.5px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
        />
        <button type="submit" disabled={!url.trim() || reading} className="btn-primary px-4 py-2.5 text-[14px] disabled:opacity-50">
          {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Analyze
        </button>
        {editing && (
          <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 text-[14px] font-semibold text-muted hover:text-text">
            Cancel
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-600">{error}</p>}
    </form>
  );
}

const clock = (n: number) => {
  const s = Math.round(n);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const sentence = (s: string) => {
  const t = s.trim().replace(/[.\s]+$/, "");
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : "";
};
const captionsOf = (text: string) => text.split(/\s+\/\s+/).map((t) => t.trim()).filter(Boolean);

/**
 * The script as one flat timeline: start time, the hook or the action number, what to do, then the on-screen text
 * (each caption its own quote). No nesting, no labels repeated per row, nothing cut off.
 */
export function DemoScript({ script }: { script: VideoScript }) {
  const [copied, setCopied] = useState(false);
  const hookEnd = Math.max(0, ...script.hookBeats.map((b) => b.end));
  const rows = [
    ...(hookEnd > 0 ? [{ at: 0, mark: "Hook", does: script.hookBeats.map((b) => sentence(b.action)).filter(Boolean).join(" "), captions: script.hookText ? [script.hookText] : [] }] : []),
    ...script.shots.map((s, i) => ({
      at: hookEnd + script.shots.slice(0, i).reduce((sum, x) => sum + x.seconds, 0),
      mark: String(i + 1),
      does: sentence(s.hint || s.steps.map((x, j) => (j ? x.charAt(0).toLowerCase() + x.slice(1) : x)).join(", then ") || s.label),
      captions: captionsOf(s.text),
    })),
  ];
  const total = Math.round(hookEnd + script.shots.reduce((sum, s) => sum + s.seconds, 0));
  const copy = () => {
    const text = [`Script (${total}s)`, ...rows.map((r) => `${clock(r.at)}  ${r.mark === "Hook" ? "Hook" : `Action ${r.mark}`}: ${r.does}${r.captions.length ? `\n      On screen: ${r.captions.map((c) => `"${c}"`).join("  ")}` : ""}`)].join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }, () => undefined);
  };
  return (
    <section aria-label="Script" className="pt-1">
      <div className="flex items-center gap-2 pb-1">
        <h3 className="min-w-0 flex-1 text-[13px] font-semibold text-soft">Script · {total}s</h3>
        <button type="button" onClick={copy} aria-label="Copy script" title="Copy script" className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-text">
          {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <ol className="divide-y divide-line border-y border-line">
        {rows.map((r, i) => {
          const hook = r.mark === "Hook";
          return (
            <li key={i} className="grid grid-cols-[40px_44px_minmax(0,1fr)] items-baseline gap-x-2 py-3">
              <span className="text-[13px] tabular-nums text-soft">{clock(r.at)}</span>
              {/* Only where a part starts: HOOK, then DEMO on its first action. No shot numbers (the captions are numbered). */}
              {hook || r.mark === "1" ? (
                <span className={`w-fit rounded px-1.5 py-px text-[10.5px] font-bold uppercase tracking-wide ${hook ? "bg-accent-tint text-accent" : "bg-raised text-muted"}`}>{hook ? "Hook" : "Demo"}</span>
              ) : (
                <span aria-hidden />
              )}
              <div className="min-w-0">
                <p className="text-[14.5px] leading-snug text-text">{r.does}</p>
                {r.captions.length > 0 && (
                  <p className="mt-1.5 flex gap-2.5 text-[13.5px] leading-snug">
                    <span className="shrink-0 text-soft">On screen</span>
                    <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 italic text-muted">
                      {r.captions.map((c, j) => <span key={j}>&ldquo;{c}&rdquo;</span>)}
                    </span>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
