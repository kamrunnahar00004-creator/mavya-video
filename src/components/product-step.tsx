"use client";

import { useState } from "react";
import { Check, Copy, Globe, Loader2, RefreshCw, Smartphone, Sparkles } from "lucide-react";
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

const sec = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/**
 * The demo, shot by shot, as clear as a shooting script: the time range, the shot, how to hold the phone (Camera), what
 * to do in order (Steps) and the text that appears (On screen, one dark chip per caption). Copy gives the same as text.
 */
export function DemoScript({ shots }: { shots: VideoScript["shots"] }) {
  const [copied, setCopied] = useState(false);
  const lines = shots.map((s, i) => {
    const from = shots.slice(0, i).reduce((sum, x) => sum + x.seconds, 0);
    return {
      time: `${sec(from)} - ${sec(from + s.seconds)}s`,
      title: s.label || s.hint,
      camera: s.camera,
      steps: s.steps.length ? s.steps : s.hint ? [s.hint] : [],
      captions: s.text.split(/\s+\/\s+/).map((t) => t.trim()).filter(Boolean),
    };
  });
  const total = shots.reduce((sum, s) => sum + s.seconds, 0);
  const copy = () => {
    const text = lines
      .map((l) => [
        `${l.time}  ${l.title}`,
        l.camera && `Camera: ${l.camera}`,
        l.steps.length && `Steps: ${l.steps.map((step, i) => `${i + 1}. ${step}`).join("  ")}`,
        l.captions.length && `On screen: ${l.captions.map((c) => `"${c}"`).join(", ")}`,
      ].filter(Boolean).join("\n"))
      .join("\n\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }, () => undefined);
  };
  return (
    <section aria-label="Demo script" className="rounded-2xl border border-line bg-panel">
      <div className="flex items-center gap-3 px-4 pb-1 pt-3.5">
        <h3 className="text-[15px] font-bold">Demo script</h3>
        <span className="text-[13px] tabular-nums text-soft">{lines.length} shots · {sec(total)}s</span>
        <button type="button" onClick={copy} className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-bold text-accent hover:bg-accent-tint">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {/* A storyboard: the frame shows the shot's on-screen text as it will look; beside it what to do and how to film. */}
      <ol className="px-4 pb-2">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-4 border-t border-line py-3.5 first:border-t-0">
            <div aria-label={l.captions.length ? `On screen: ${l.captions.join(", ")}` : undefined} className="flex h-[136px] w-[77px] shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl bg-ink px-2 text-center">
              {l.captions.map((c, j) => (
                <span key={j} className="text-[11px] font-bold leading-tight text-white [overflow-wrap:anywhere]">{c}</span>
              ))}
            </div>
            <div className="min-w-0 pt-0.5">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[12.5px] font-bold tabular-nums text-accent">{l.time}</span>
                <span className="text-[15px] font-bold">{l.title}</span>
              </p>
              {l.steps.length > 0 && <p className="mt-1.5 text-[14px] leading-snug text-text">{l.steps.join(" → ")}</p>}
              {l.camera && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-snug text-muted">
                  <Smartphone className="mt-[3px] h-3.5 w-3.5 shrink-0" />
                  {l.camera}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
