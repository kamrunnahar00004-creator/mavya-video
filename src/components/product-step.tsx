"use client";

import { useState } from "react";
import { Check, Globe, Loader2, RefreshCw, Sparkles } from "lucide-react";
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
      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent">
            <Globe className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold">{brief.name}</p>
            <p className="text-[13.5px] text-muted">{brief.oneLiner}</p>
          </div>
          <button type="button" onClick={() => setEditing(true)} className="rounded-lg px-3 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint">
            Change
          </button>
        </div>
        <dl className="mt-4 grid gap-3 border-t border-line pt-4 text-[13.5px] sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-soft">For</dt>
            <dd className="mt-0.5">{brief.audience}</dd>
          </div>
          <div>
            <dt className="font-semibold text-soft">Wow moment</dt>
            <dd className="mt-0.5">{brief.wowMoment}</dd>
          </div>
        </dl>
        {brief.features.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {brief.features.map((f) => (
              <span key={f} className="rounded-md bg-raised px-2 py-1 text-[12.5px] font-semibold text-muted">
                {f}
              </span>
            ))}
          </div>
        )}
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
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-4">
        <p className="min-w-0 flex-1 text-[14.5px] font-bold">Your script</p>
        <button type="button" onClick={() => void write()} disabled={busy} className="btn-primary px-4 py-2.5 text-[14px] disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "Writing..." : "Write my script"}
        </button>
        {error && <p role="alert" className="w-full text-[13px] font-semibold text-red-600">{error}</p>}
      </div>
    );
  }

  const lines = [script.hookText, ...script.hookAlternatives].filter(Boolean);
  return (
    <div className="mt-3 rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[14.5px] font-bold">Your script</p>
        <button type="button" onClick={() => void write()} disabled={busy} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Rewrite
        </button>
      </div>
      <p className="mt-3 text-[12.5px] font-semibold text-soft">Hook text</p>
      <div className="mt-1.5 space-y-1.5">
        {lines.map((line) => {
          const on = line === hookText;
          return (
            <button
              key={line}
              type="button"
              onClick={() => onUseHookText(line)}
              aria-pressed={on}
              className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-[14px] font-semibold ${on ? "border-accent bg-accent-tint" : "border-line hover:border-ink"}`}
            >
              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? "border-accent bg-accent text-white" : "border-line-strong"}`}>{on && <Check className="h-3 w-3" strokeWidth={3} />}</span>
              {line}
            </button>
          );
        })}
      </div>
      {script.hookBeats.length > 0 && (
        <>
          <p className="mt-4 text-[12.5px] font-semibold text-soft">In the hook</p>
          <ol className="mt-1.5 space-y-1 text-[13.5px] text-muted">
            {script.hookBeats.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-16 shrink-0 tabular-nums text-soft">{b.start.toFixed(1)}-{b.end.toFixed(1)}s</span>
                {b.action}
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="mt-4 text-[12.5px] font-semibold text-soft">Demo, {script.shots.length} shots</p>
      <ol className="mt-1.5 space-y-1.5 text-[13.5px]">
        {script.shots.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-5 shrink-0 font-bold text-soft">{i + 1}</span>
            <span className="min-w-0">
              <span className="font-semibold">{s.label}</span> <span className="text-soft">({s.seconds}s)</span>
              <span className="block text-muted">{s.hint}</span>
            </span>
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-600">{error}</p>}
    </div>
  );
}
