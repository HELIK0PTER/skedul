"use client";

import { useEffect, useRef, useState } from "react";

/**
 * After a refusal (a rule broken on the client, or the answer of the server) the keyboard and screen reader user lands
 * on the problem: the first control marked `aria-invalid` inside the form (its message sits under it), else the error
 * box above the buttons (`<FormError ref={errorBox} tabIndex={-1} />`). The focus moves in an effect, after the render
 * that shows the message, so the control is already marked.
 */
export function useRefusalFocus() {
  const root = useRef<HTMLFormElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const [refusals, setRefusals] = useState(0);

  useEffect(() => {
    if (refusals === 0) return;
    const invalid = root.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (invalid ?? errorBox.current)?.focus();
  }, [refusals]);

  return { root, errorBox, refused: () => setRefusals((n) => n + 1) };
}
