"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Hover text for every icon button (founder 2026-11-27: "for every symbol have a hover over text, or else not
 * intuitive"). One listener for the whole app: when the mouse rests on (or the keyboard focuses) a button or link that
 * shows only an icon, a small black label with its name appears, the same look as the "+" tip in step 1. The name is
 * the element's aria-label, data-tip or title (title moves to data-tip so the browser's own slow tooltip never doubles
 * it). Buttons that already draw their own tip, or sit in [data-no-tip], are left alone. Touch has no hover: skipped.
 */
type Tip = { text: string; x: number; y: number; below: boolean };
const TARGET = 'button, a[href], [role="button"], [role="tab"], summary';

/** The name to show for an icon-only control, or null when it has visible text or its own tip. */
export function tipFor(el: Element): string | null {
  if (el.closest("[data-no-tip]")) return null;
  // Already has its own tip, inside it or right next to it.
  if (el.querySelector('[role="tooltip"]') || el.parentElement?.querySelector(':scope > [role="tooltip"]')) return null;
  const html = el as HTMLElement;
  // A title becomes the tip (it was the hover text already); one set on purpose in data-tip is never overwritten.
  if (html.title) {
    if (!html.dataset.tip) html.dataset.tip = html.title;
    html.removeAttribute("title");
  }
  const name = (html.dataset.tip || el.getAttribute("aria-label") || "").trim();
  if (!name) return null;
  // Icon-only: no visible words of its own; screen-reader-only text does not count (a data-tip always shows).
  let words = (html.innerText ?? el.textContent ?? "").trim();
  for (const hidden of Array.from(el.querySelectorAll?.(".sr-only") ?? [])) words = words.replace((hidden.textContent ?? "").trim(), "").trim();
  return html.dataset.tip || !words ? name : null;
}

export function HoverTips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<Element | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  // Kept on screen: centred on the button, moved in when it would cross the window's edge (measured, not guessed).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const half = el.offsetWidth / 2;
    el.style.left = `${Math.min(window.innerWidth - half - 8, Math.max(half + 8, tip.x))}px`;
  }, [tip]);

  useEffect(() => {
    const hide = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      current.current = null;
      setTip(null);
    };
    const show = (el: Element, delay: number) => {
      const text = tipFor(el);
      if (!text) return hide();
      if (current.current === el) return;
      hide();
      current.current = el;
      timer.current = setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 40;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
      }, delay);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as Element | null)?.closest?.(TARGET);
      if (el) show(el, 250);
      else if (current.current) hide();
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.(TARGET);
      if (el && el.matches(":focus-visible")) show(el, 0);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    // Leaving the button for nothing (out of the window) hides it; so does the button disappearing (Codex 2026-11-27).
    const out = (e: PointerEvent) => {
      const to = e.relatedTarget as Node | null;
      if (current.current && (!to || !current.current.contains(to))) hide();
    };
    const gone = setInterval(() => { if (current.current && !current.current.isConnected) hide(); }, 400);
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      hide();
      clearInterval(gone);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <span
      ref={box}
      aria-hidden
      className="pointer-events-none fixed z-[1000] max-w-[240px] rounded-md bg-ink px-2 py-1 text-center text-[12px] font-semibold leading-snug text-white shadow-[0_4px_12px_-4px_rgba(0,0,0,0.4)]"
      style={{
        left: tip.x,
        top: tip.y,
        transform: `translate(-50%, ${tip.below ? "0" : "-100%"})`,
      }}
    >
      {tip.text}
    </span>
  );
}
