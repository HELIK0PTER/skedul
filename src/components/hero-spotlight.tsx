"use client";

import { useEffect, useRef } from "react";

/**
 * Interactive violet spotlight for the hero background. A soft glow + a
 * cursor-revealed dot grid follow the pointer over the hero section.
 * Renders an absolute, pointer-events-none layer; the pointer listener is
 * attached to the parent section so it tracks across the whole hero.
 * Falls back to a centered position when there's no pointer (touch).
 * Styling + `prefers-reduced-motion` handling live in globals.css.
 */
export function HeroSpotlight() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    let raf = 0;
    function onMove(e: PointerEvent) {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rect = parent!.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        el!.style.setProperty("--x", `${x}%`);
        el!.style.setProperty("--y", `${y}%`);
      });
    }

    parent.addEventListener("pointermove", onMove);
    return () => {
      parent.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="hero-spotlight pointer-events-none absolute inset-0"
    />
  );
}
