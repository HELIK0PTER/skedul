/**
 * The page-level line a release leaves behind (G4c). The Owner's own release from the payment block of the séance page
 * ends her pending purchase, so the revalidation that follows removes the block, its dialog and its status line before the
 * answer reaches them: a sentence set in a state of the block is lost. This store holds the sentence outside the block, in
 * one text that the always-mounted status region of the page reads (`ReleaseStatus`). Pure: no React, no DOM.
 */
export type LineStore = {
  get: () => string;
  set: (text: string) => void;
  /** Calls `listener` after each change; returns the function that stops it. */
  subscribe: (listener: () => void) => () => void;
};

export function createLineStore(): LineStore {
  let line = "";
  const listeners = new Set<() => void>();
  return {
    get: () => line,
    // The same line is not a change: a live region announces nothing for a text that did not change, so a caller that
    // wants a sentence heard again sets an empty line first (the `announce(null)` rule of CancelBookingButton, G3b).
    set(text) {
      if (text === line) return;
      line = text;
      // A copy: a listener that stops itself while being told must not make another one miss the change.
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
