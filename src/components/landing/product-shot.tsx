import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import styles from "./landing.module.css";

interface ProductShotProps {
  /** What the shot shows, for assistive tech: the UI inside is decorative. */
  label: string;
  /** Size of the app canvas, in CSS px, before it is scaled to the figure. */
  width?: number;
  height?: number;
  /** Visible canvas height; crops the bottom. Defaults to the full height. */
  crop?: number;
  /** Canvas px hidden on the left (e.g. a sidebar). */
  cropLeft?: number;
  /** Above 1, zooms in so the right part of the canvas runs off the figure. */
  overscan?: number;
  /** Flush right edge, for a shot that runs into the viewport edge. */
  bleed?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A real piece of the app (the demo screens), rendered at its native size
 * and scaled down to the figure width in pure CSS, so there is no layout
 * shift and no measuring script. No fake browser chrome: just a hairline
 * frame around the product itself.
 */
export function ProductShot({
  label,
  width = 960,
  height = 840,
  crop,
  cropLeft = 0,
  overscan = 1,
  bleed = false,
  className,
  children,
}: ProductShotProps) {
  return (
    <figure
      role="img"
      aria-label={label}
      className={cn(styles.shot, bleed && styles.shotBleed, className)}
      style={
        {
          "--shot-w": width,
          "--shot-h": crop ?? height,
          "--shot-x": cropLeft,
          "--shot-overscan": overscan,
        } as CSSProperties
      }
    >
      <div
        aria-hidden
        inert
        className={styles.shotCanvas}
        style={{ width, height }}
      >
        {children}
      </div>
    </figure>
  );
}
