"use client";

import { useState } from "react";
import { Check, Copy, Globe, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { Run, VideoScript } from "@/lib/types";

type AIResult = Pick<Run, "product" | "script">;

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

/**
 * The script for this product and hook, written from the library's analyzed viral hooks (Write my script is an
 * explicit click). The hook lines are one click from the hook text; the demo shots fill "Film your demo".
 */
export function ScriptCard({ runId, script, hookText, writing = false, onDone, onUseHookText }: { runId: string; script: VideoScript | null; hookText: string; /** The page is already writing it (started by Generate). */ writing?: boolean; onDone: (r: AIResult) => void; onUseHookText: (text: string) => void }) {
  const [own, setOwn] = useState(false);
  const busy = own || writing;
  const [error, setError] = useState<string | null>(null);
  const write = async () => {
    if (busy) return;
    setOwn(true);
    setError(null);
    const { run, error: e } = await writeScript(runId);
    setOwn(false);
    if (e || !run) return setError(e ?? "Something went wrong.");
    onDone(run);
  };

  if (!script) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-4">
        <p className="min-w-0 flex-1 text-[14.5px] font-bold">Hook text</p>
        <button type="button" onClick={() => void write()} disabled={busy} className="btn-primary px-4 py-2.5 text-[14px] disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "Writing..." : "Write my script"}
        </button>
        {error && <p role="alert" className="w-full text-[13px] font-semibold text-red-600">{error}</p>}
      </div>
    );
  }

  // Only the hook text options: the character's beats are copied from the original clip, nothing to act on here.
  const lines = [script.hookText, ...script.hookAlternatives].filter(Boolean);
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[14.5px] font-bold">Hook text</p>
        <button type="button" onClick={() => void write()} disabled={busy} className="-my-1 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Rewrite
        </button>
      </div>
      <div role="radiogroup" aria-label="Hook text" className="-mx-2 mt-2">
        {lines.map((line) => {
          const on = line === hookText;
          return (
            <button
              key={line}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onUseHookText(line)}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-[14.5px] transition-colors ${on ? "bg-accent-tint font-semibold text-text" : "text-muted hover:bg-raised hover:text-text"}`}
            >
              <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] ${on ? "border-accent bg-accent text-white" : "border-line-strong"}`}>{on && <Check className="h-3 w-3" strokeWidth={3} />}</span>
              {line}
            </button>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-600">{error}</p>}
    </div>
  );
}

const sec = (n: number) => String(Math.round(n * 10) / 10);

/** The demo as a timed script: from when to when, what to film, the text on screen. One click copies it all. */
export function DemoScript({ shots }: { shots: VideoScript["shots"] }) {
  const [copied, setCopied] = useState(false);
  const lines = shots.map((s, i) => {
    const from = shots.slice(0, i).reduce((sum, x) => sum + x.seconds, 0);
    return { from, to: from + s.seconds, film: s.hint || s.label, text: s.text };
  });
  const copy = () => {
    const text = lines.map((l) => `${sec(l.from)}-${sec(l.to)}s: ${l.film}${l.text ? `\nOn screen: "${l.text}"` : ""}`).join("\n\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }, () => undefined);
  };
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[14.5px] font-bold">Demo script</p>
        <button type="button" onClick={copy} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <ol className="mt-3 divide-y divide-line">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-4 py-2.5">
            <span className="w-14 shrink-0 pt-px text-[13px] font-bold tabular-nums text-soft">{sec(l.from)}-{sec(l.to)}s</span>
            <span className="min-w-0 text-[14px]">
              <span className="block font-semibold">{l.film}</span>
              {l.text && <span className="mt-0.5 block text-muted">&ldquo;{l.text}&rdquo;</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
