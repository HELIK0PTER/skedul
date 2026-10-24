"use client";

import { useEffect } from "react";

import { scrollToHashedAnchor } from "@/lib/public-anchors";

/**
 * Scrolls to `anchor` once, when the block that carries it has mounted and the URL hash names it. It renders nothing.
 * The public page streams behind loading.tsx, so neither the router (it scrolls to the skeleton and forgets the hash) nor
 * the browser's fragment scroll (it can run before the streamed block is revealed) reaches the block by itself; an
 * effect runs once the block is in the document, on a client navigation and on a fresh load alike. Mounted INSIDE the
 * block: a page without it (no offer on sale) has no anchor and nothing to scroll to.
 */
export function ScrollToAnchor({ anchor }: { anchor: string }) {
  useEffect(() => {
    scrollToHashedAnchor(anchor, window.location.hash, document);
  }, [anchor]);
  return null;
}
