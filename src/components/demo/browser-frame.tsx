"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

export const FRAME_W = 960;
export const FRAME_H = 840;

interface BrowserFrameProps {
  url: string;
  /** Réf du conteneur 960×840 mis à l'échelle — repère de coordonnées du curseur. */
  contentRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

export function BrowserFrame({ url, contentRef, children }: BrowserFrameProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(entry.contentRect.width / FRAME_W, 1));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-(--shadow-card)">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
        </span>
        <span
          key={url}
          className="demo-url flex-1 truncate rounded-full bg-muted px-3 py-1 text-center font-mono text-xs text-muted-foreground"
        >
          {url}
        </span>
        <span className="w-8" />
      </div>
      <div ref={outerRef}>
        <div className="relative overflow-hidden" style={{ height: FRAME_H * scale }}>
          <div
            ref={contentRef}
            inert
            className="absolute left-0 top-0 overflow-hidden bg-background"
            style={{
              width: FRAME_W,
              height: FRAME_H,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
