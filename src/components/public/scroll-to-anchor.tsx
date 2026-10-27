"use client";

import { useEffect } from "react";

import { scrollToHashedAnchor } from "@/lib/public-anchors";

/**
 * Scrolls to `anchor` once, when the block that carries it has mounted and the URL hash names it. It renders nothing.
 * The public page streams behind loading.tsx, so neither the router (it scrolls to the skeleton and forgets the hash) nor
 * the browser's fragment scroll (it can run before the streamed block is revealed) reaches the block by itself; an
 * effect runs once the block is in the document, on a client navigation and on a fresh load alike. Mounted INSIDE the
 * block: a page without it (no offer on sale) has no anchor and nothing to scroll to.
 *
 * The scroll answers the link that was followed, not the entry in the history: once it has happened the fragment is
 * dropped from the URL of the current entry (`replaceState`, no new entry), so a Back or Forward traversal to this entry,
 * or a reload, that mounts the Boutique again does not pull the visitor to it a second time. `history.state` is handed
 * back as it is: it holds the router's own state.
 */
export function ScrollToAnchor({ anchor }: { anchor: string }) {
  useEffect(() => {
    if (!scrollToHashedAnchor(anchor, window.location.hash, document)) return;
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }, [anchor]);
  return null;
}
