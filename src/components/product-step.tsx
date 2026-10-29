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

const sec = (n: number) => String(Math.round(n * 10) / 10);
const sentence = (s: string) => {
  const t = s.trim().replace(/[.\s]+$/, "");
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : "";
};

/**
 * The whole script in the format founders write by hand: a title, the hook (what the creator does, its text), then
 * each demo action with its seconds and its on-screen text. Copy gives the same as plain text.
 */
export function DemoScript({ name, script }: { name: string; script: VideoScript }) {
  const [copied, setCopied] = useState(false);
  const hookEnd = Math.max(0, ...script.hookBeats.map((b) => b.end));
  const hookDoes = script.hookBeats.map((b) => sentence(b.action)).filter(Boolean).join(" ");
  const actions = script.shots.map((s, i) => {
    const from = hookEnd + script.shots.slice(0, i).reduce((sum, x) => sum + x.seconds, 0);
    return { label: `Action ${i + 1} (${sec(from)}-${sec(from + s.seconds)}s)`, does: sentence(s.hint || s.steps.map((x, j) => (j ? x.charAt(0).toLowerCase() + x.slice(1) : x)).join(", then ") || s.label), text: s.text };
  });
  const total = Math.round(hookEnd + script.shots.reduce((sum, s) => sum + s.seconds, 0));
  const title = `${name} (about ${total}s)`;
  const hookLabel = `Hook (0-${sec(hookEnd)}s)`;
  const copy = () => {
    const text = [
      title,
      hookEnd ? `${hookLabel}: ${hookDoes}${script.hookText ? ` Text: "${script.hookText}"` : ""}` : "",
      ...actions.map((a) => `${a.label}: ${a.does}${a.text ? ` Text: "${a.text}"` : ""}`),
    ].filter(Boolean).join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }, () => undefined);
  };
  return (
    <section aria-label="Script" className="rounded-xl bg-raised px-4 py-3.5 text-[14px] leading-relaxed text-text">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-[16px] font-bold">{title}</h3>
        <button type="button" onClick={copy} aria-label="Copy script" title="Copy script" className="-my-1 rounded-lg p-1.5 text-muted hover:bg-panel hover:text-text">
          {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      {hookEnd > 0 && (
        <p className="mt-1.5">
          <strong>{hookLabel}:</strong> {hookDoes}
          {script.hookText && <> Text: &ldquo;{script.hookText}&rdquo;</>}
        </p>
      )}
      <ul className="mt-1.5 list-disc space-y-1 pl-5 marker:text-soft">
        {actions.map((a, i) => (
          <li key={i}>
            <strong>{a.label}:</strong> {a.does}
            {a.text && <> Text: &ldquo;{a.text}&rdquo;</>}
          </li>
        ))}
      </ul>
    </section>
  );
}
