"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { isTrackedPath } from "@/lib/analytics";

/** One beacon per public page view — no cookie, no storage (see /api/track). */
export function PageViewTracker() {
  const pathname = usePathname();
  const isFirstView = useRef(true);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    // Dedupes React Strict Mode's double effect run in development.
    if (!pathname || lastPath.current === pathname) return;
    lastPath.current = pathname;

    const first = isFirstView.current;
    isFirstView.current = false;
    if (!isTrackedPath(pathname)) return;

    const payload = JSON.stringify({
      path: pathname,
      first,
      ...(first
        ? {
            referrer: document.referrer || undefined,
            source:
              new URLSearchParams(window.location.search).get("utm_source") ??
              undefined,
          }
        : {}),
    });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/track", payload);
    else void fetch("/api/track", { method: "POST", body: payload, keepalive: true });
  }, [pathname]);

  return null;
}
