"use client";

import Link from "next/link";
import { useState } from "react";

import { OtpDialog } from "@/components/auth/otp-dialog";
import { Button } from "@/components/ui/button";
import { INLINE_LINK_CLASS } from "@/components/ui/link-class";
import type { VisitorState } from "@/lib/public/identity";
import { COPY } from "@/lib/public/messages";
import { canOfferCodeSignIn } from "@/lib/public/sign-in-flow";
import { PLANNING_HEADING_ID } from "@/lib/public-anchors";

/**
 * Where the sign-in dialog hands the focus once the visitor is signed in. The page refreshes right after the dialog
 * closes and replaces this bar (by the Owner's wallet, or by the verified link row), so the target cannot be in the bar:
 * it is the « Planning » heading, which every state of the page renders and the refresh leaves in place (WCAG 2.4.3).
 * A module-level function, so that its identity is stable, as `Dialog` asks. `OtpDialog` asks for it after a sign-in
 * only: a dialog closed without one gives the focus back to « J'ai déjà des tickets ».
 */
function planningHeading(): HTMLElement | null {
  return document.getElementById(PLANNING_HEADING_ID);
}

/**
 * What /[slug] offers a visitor who is not the Owner, by state (contract § 3.23, Decision 61):
 * anonymous -> « J'ai déjà des tickets » (the sign-in dialog) and, when a personal-link cookie is present, a
 * « Mon espace » link (the cookie never gives a wallet here); verified -> a « Mon espace » link; unverified and
 * impersonating -> nothing (an admin has no client identity; an unverified user gets the « Confirmez votre adresse »
 * banner, which the page mounts once outside this bar, so that it survives the refresh that follows a confirmation and
 * « Adresse confirmée. » is announced). The code form exists for an anonymous visitor only (risk 7): it would purge the
 * password of an unverified account.
 */
export function VisitorBar({
  state,
  slug,
  returnTo,
  googleEnabled,
  hasGuestSpace,
}: {
  state: VisitorState;
  slug: string;
  returnTo: string;
  googleEnabled: boolean;
  hasGuestSpace: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (state === "impersonating") return null;
  if (state === "unverified") return null;

  if (state === "verified") {
    return (
      <div className="mb-6 flex justify-end text-sm">
        <Link href={`/${slug}/espace`} className={INLINE_LINK_CLASS}>
          {COPY.MY_SPACE}
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0 text-sm text-zinc-600">{COPY.HAVE_TICKETS_HINT}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
        <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
          {COPY.HAVE_TICKETS}
        </Button>
        {hasGuestSpace && (
          <Button asChild variant="ghost" className="w-full sm:w-auto">
            <Link href={`/${slug}/espace`}>{COPY.MY_SPACE}</Link>
          </Button>
        )}
      </div>
      {canOfferCodeSignIn(state) && (
        <OtpDialog
          open={open}
          onClose={() => setOpen(false)}
          returnTo={returnTo}
          googleEnabled={googleEnabled}
          returnFocusTo={planningHeading}
        />
      )}
    </div>
  );
}
