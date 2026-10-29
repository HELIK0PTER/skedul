"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * One step of a week navigation (« Semaine précédente », « Semaine suivante ») of the public pages (P6 A44). It is the
 * same link at every week, so a keyboard user who walks to the first or to the horizon week keeps the focus on it: React
 * keeps a DOM node only while the element type at its place stays the same, and the disabled button that used to replace
 * the link at an end was a new node that dropped the focus on the page. At an end `href` is null: the link keeps
 * `fallbackHref` (the shown week, so a middle click opens the same page), says aria-disabled, takes no pointer and does
 * nothing on Enter. It stays in the tab order, as an aria-disabled control does.
 */
export function WeekStepLink({
  href,
  fallbackHref,
  scroll,
  children,
}: {
  href: string | null;
  fallbackHref: string;
  scroll?: boolean;
  children: ReactNode;
}) {
  const disabled = href === null;
  return (
    <Button
      asChild
      variant="secondary"
      size="sm"
      className="flex-1 sm:flex-none aria-disabled:pointer-events-none aria-disabled:opacity-50"
    >
      <Link
        href={href ?? fallbackHref}
        scroll={scroll}
        prefetch={disabled ? false : undefined}
        aria-disabled={disabled || undefined}
        onClick={disabled ? (event) => event.preventDefault() : undefined}
      >
        {children}
      </Link>
    </Button>
  );
}
