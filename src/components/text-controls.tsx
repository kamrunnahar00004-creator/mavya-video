"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Plus, RefreshCw, Smile, Trash2 } from "lucide-react";


import { FONT_CHOICES, fontCss, fontLabel, loadFonts } from "@/lib/studio-data";




import { STYLE_GROUPS, STYLE_PRESETS, autoSecond, stylePreset } from "@/lib/text-styles";

import { type TextLayer } from "@/lib/types";

export function TextRow({ t, placeholder, onPatch, onAdd, onRemove, onApplyAll, onRegenerate }: { t: TextLayer; placeholder: string; onPatch: (p: Partial<TextLayer>) => void; onAdd: () => void; onRemove: () => void; onApplyAll?: () => void; /** The hook's line: a new one for this product. */ onRegenerate?: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const textInput = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-2xl border border-line bg-panel">
      <div className="flex items-center gap-1 p-1.5 pl-3">
        <input
          ref={textInput}
          value={t.text}
          maxLength={160}
          onChange={(e) => onPatch({ text: e.target.value })}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent py-2 text-[14px] font-normal outline-none placeholder:text-soft"
        />
        {onRegenerate && (
          <span className="group/regen relative">
            <button
              type="button"
              aria-label="Regenerate"
              disabled={regenerating}
              onClick={async () => {
                setRegenerating(true);
                try { await onRegenerate(); } finally { setRegenerating(false); }
              }}
              className="rounded-lg p-2 text-muted hover:bg-raised hover:text-text disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${regenerating ? "motion-safe:animate-spin" : ""}`} />
            </button>
            <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[12px] font-semibold text-white opacity-0 transition-opacity group-hover/regen:opacity-100 group-focus-within/regen:opacity-100">
              Regenerate
            </span>
          </span>
        )}
        <EmojiMenu
          onPick={(emoji) => {
            const el = textInput.current;
            const at = el?.selectionStart ?? t.text.length;
            const end = el?.selectionEnd ?? at;
            onPatch({ text: (t.text.slice(0, at) + emoji + t.text.slice(end)).slice(0, 160) });
            requestAnimationFrame(() => {
              el?.focus();
              el?.setSelectionRange(at + emoji.length, at + emoji.length);
            });
          }}
        />
        <button type="button" aria-label="Text style" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="rounded-lg p-2 text-muted hover:bg-raised hover:text-text">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
        <button type="button" aria-label="Add text" title="Add text" onClick={onAdd} className="rounded-lg p-2 text-muted hover:bg-raised hover:text-accent">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Delete text" title="Delete text" onClick={onRemove} className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2 border-t border-line p-2">
          <FontMenu value={t.font} onChange={(font) => onPatch({ font })} />
          <Menu title="Text color" label={<span className="block h-5 w-5 rounded-full border border-line-strong" style={{ background: t.color }} />}>
            {(close) => <ColorGrid value={t.color} onPick={(c, done) => { onPatch({ color: c }); if (done) close(); }} />}
          </Menu>
          <Menu label={stylePreset(t.style).label}>
            {(close) => (
              <div className="max-h-[360px] w-[344px] overflow-y-auto p-2">
                {STYLE_GROUPS.map((g) => (
                  <div key={g} className="mb-3 last:mb-0">
                    <div className="px-1 pb-1.5 text-[11.5px] font-semibold text-soft">{g}</div>
                    <div className="grid grid-cols-4 gap-2">
                      {STYLE_PRESETS.filter((p) => p.group === g).map((p) => {
                        // Previews use fixed, high-contrast demo colors so every outline / box / glow is visible.
                        const look = p.look("#ffffff", t.second ?? "#7b4cfa");
                        const on = t.style === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            title={p.label}
                            onClick={() => {
                              onPatch({ style: p.id });
                              close();
                            }}
                            className="group flex flex-col items-center gap-1"
                          >
                            <span className={`flex h-12 w-full items-center justify-center overflow-hidden rounded-lg bg-[linear-gradient(135deg,#6b7280,#9ca3af)] ${on ? "ring-2 ring-accent ring-offset-1" : "group-hover:ring-1 group-hover:ring-line-strong"}`}>
                              <span className="text-[18px] font-extrabold leading-none" style={{ fontFamily: fontCss(t.font), ...look.text, ...(look.box ?? {}) }}>
                                Aa
                              </span>
                            </span>
                            <span className={`w-full truncate text-center text-[11px] ${on ? "font-bold text-accent" : "font-medium text-muted"}`}>{p.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Menu>
          {stylePreset(t.style).second && (
            <Menu title={stylePreset(t.style).second} label={<span className="block h-5 w-5 rounded-full border border-line-strong" style={{ background: t.second ?? autoSecond(t.color) }} />}>
              {(close) => <ColorGrid value={t.second ?? autoSecond(t.color)} onPick={(c, done) => { onPatch({ second: c }); if (done) close(); }} />}
            </Menu>
          )}
          {onApplyAll && (
            <button
              type="button"
              title="Give every text in the video this look and position"
              onClick={() => {
                onApplyAll();
                setApplied(true);
                setTimeout(() => setApplied(false), 1800);
              }}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-line-strong bg-panel px-3 py-1.5 text-[13px] font-semibold text-text hover:border-accent hover:text-accent"
            >
              {applied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
              {applied ? "Applied" : "Apply to all"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
const SWATCHES = ["#ffffff", "#000000", "#facc15", "#f97316", "#ef4444", "#ec4899", "#a78bfa", "#8b5cf6", "#38bdf8", "#22c55e", "#94a3b8", "#fde68a"];
function ColorGrid({ value, onPick }: { value: string; onPick: (c: string, done: boolean) => void }) {
  return (
    <div className="w-[196px] p-2">
      <div className="grid grid-cols-6 gap-1.5">
        {SWATCHES.map((c) => (
          <button key={c} type="button" aria-label={c} onClick={() => onPick(c, true)} className={`h-7 w-7 rounded-full border ${value.toLowerCase() === c ? "border-ink ring-2 ring-accent ring-offset-1" : "border-line-strong"}`} style={{ background: c }} />
        ))}
      </div>
      <label className="mt-2 flex cursor-pointer items-center justify-between rounded-lg px-1.5 py-1 text-[12.5px] font-semibold text-muted hover:bg-raised">
        Custom
        <input type="color" value={value} onChange={(e) => onPick(e.target.value, false)} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
      </label>
    </div>
  );
}
const EMOJIS = ("😭 💀 🤯 😂 🤣 😳 🥹 😩 🫠 😮‍💨 😏 🤭 🫢 😱 🙄 😤 🥲 😍 🤩 😎 🤔 🫣 😬 😅 🙃 😇 🤑 🤡 👀 🔥 ✨ 💸 💰 💯 🚀 📈 📉 ✅ ❌ ⚠️ 🚨 💡 🎯 🧠 💻 📱 🖥️ ⌨️ 🤖 ⚡ 💎 🏆 🎉 🙌 👏 🙏 💪 👇 👆 👉 🫵 🤝 ❤️ 💔 💜 🖤 🤍 💅 🧃 ☕ 🍿 📌 📝 🗓️ ⏰ 🎬 🎥 📸 🛒 🏠 🌙 ☀️")
  .split(" ");
function EmojiMenu({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Emoji" aria-expanded={open} onClick={() => { const r = ref.current?.getBoundingClientRect(); setUp(Boolean(r && window.innerHeight - r.bottom < 340 && r.top > 340)); setOpen((o) => !o); }} className="rounded-lg p-2 text-muted hover:bg-raised hover:text-text">
        <Smile className="h-4 w-4" />
      </button>
      {open && (
        <div className={`fade-in absolute right-0 z-30 grid w-[284px] ${up ? "bottom-full mb-1" : "top-full mt-1"} grid-cols-8 gap-0.5 rounded-xl border border-line bg-panel p-2 shadow-[0_8px_24px_rgba(15,23,42,0.14)]`}>
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => onPick(e)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[19px] hover:bg-raised">
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function Menu({ label, title, children }: { label: React.ReactNode; title?: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        title={title}
        aria-label={title}
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          setUp(Boolean(r && window.innerHeight - r.bottom < 380 && r.top > 380));
          setOpen((o) => !o);
        }}
        className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px] font-semibold hover:border-line-strong"
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5 text-soft" />
      </button>
      {open && <div className={`fade-in absolute left-0 z-30 rounded-xl border border-line bg-panel shadow-[0_8px_24px_rgba(15,23,42,0.14)] ${up ? "bottom-full mb-1" : "top-full mt-1"}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}
const FONT_PREVIEW_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ";
function FontMenu({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const [q, setQ] = useState("");
  const list = FONT_CHOICES.filter((f) => f.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Menu label={<span style={{ fontFamily: fontCss(value) }}>{fontLabel(value)}</span>}>
      {(close) => {
        loadFonts(FONT_CHOICES.map((f) => f.id), FONT_PREVIEW_CHARS);
        return (
          <div className="w-[240px]">
            <div className="border-b border-line p-2">
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fonts" className="w-full rounded-lg bg-raised px-2.5 py-1.5 text-[13px] outline-none placeholder:text-soft" />
            </div>
            <div className="max-h-[280px] overflow-y-auto p-1">
              {list.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    loadFonts([f.id]);
                    onChange(f.id);
                    close();
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[15px] hover:bg-raised"
                  style={{ fontFamily: fontCss(f.id) }}
                >
                  {f.label}
                  {value === f.id && <Check className="h-4 w-4 text-accent" />}
                </button>
              ))}
              {list.length === 0 && <div className="px-2.5 py-3 text-[13px] text-soft">No fonts match</div>}
            </div>
          </div>
        );
      }}
    </Menu>
  );
}