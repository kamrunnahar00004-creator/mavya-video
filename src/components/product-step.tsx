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

const sec = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const sentence = (steps: string[]) => {
  const s = steps.map((x, i) => (i ? x.charAt(0).toLowerCase() + x.slice(1) : x).replace(/[.\s]+$/, "")).join(", then ");
  return s ? `${s}.` : "";
};

/**
 * The demo script, said plainly like a chat message: shot by shot, when it plays, what to do and the text that goes on
 * screen. How to hold the phone lives in the demo step's "How to film". Copy gives the same as plain text.
 */
export function DemoScript({ shots }: { shots: VideoScript["shots"] }) {
  const [copied, setCopied] = useState(false);
  const lines = shots.map((s, i) => {
    const from = shots.slice(0, i).reduce((sum, x) => sum + x.seconds, 0);
    return { time: `${sec(from)} - ${sec(from + s.seconds)}s`, what: sentence(s.steps.length ? s.steps : [s.hint || s.label]), captions: s.text.split(/\s+\/\s+/).map((t) => t.trim()).filter(Boolean) };
  });
  const total = Math.round(shots.reduce((sum, s) => sum + s.seconds, 0));
  const copy = () => {
    const text = lines.map((l) => `${l.time}: ${l.what}${l.captions.length ? ` On screen: ${l.captions.map((c) => `"${c}"`).join(", ")}` : ""}`).join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }, () => undefined);
  };
  return (
    <div className="flex gap-3">
      <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-raised px-4 py-3.5 text-[14.5px] leading-relaxed text-text">
        <p>Your demo is {lines.length} shots, about {total} seconds. Film them in this order:</p>
        <ol className="mt-3 space-y-3">
          {lines.map((l, i) => (
            <li key={i}>
              <span className="mr-1.5 font-bold tabular-nums">{l.time}</span>
              {l.what}
              {l.captions.length > 0 && (
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
                  On screen:
                  {l.captions.map((c, j) => (
                    <span key={j} className="rounded bg-ink px-1.5 py-0.5 font-semibold text-white">{c}</span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ol>
        <button type="button" onClick={copy} className="mt-3 -ml-1.5 flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] font-bold text-accent hover:bg-accent-tint">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy script"}
        </button>
      </div>
    </div>
  );
}
