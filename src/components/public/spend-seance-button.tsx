"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { OtpDialog } from "@/components/auth/otp-dialog";
import { FormError } from "@/components/dashboard/form-error";
import { upcomingHeading, useSpaceStatus } from "@/components/public/space-status";
import { Button } from "@/components/ui/button";
import { callOrFail } from "@/lib/pro-messages";
import type { VisitorState } from "@/lib/public/identity";
import { COPY } from "@/lib/public/messages";
import { canOfferCodeSignIn } from "@/lib/public/sign-in-flow";
import { SPEND_DONE, SPEND_LABEL, SPEND_LINK_LABEL, spendControlOf } from "@/lib/public/space-view";
import type { SpendableSeance } from "@/lib/public/spendable";
import { bookWithHeldTicketAction } from "@/server/public";

/**
 * One row of « Utiliser vos tickets » (L1386-1387). What it offers is decided by spendControlOf: a link to the séance
 * page when the event asks questions; « Réserver avec 1 ticket » for the Owner, posted with the ISO start the server
 * rendered and no answers; for an anonymous visitor holding only a personal link the same label opens the sign-in
 * dialog with an EMPTY address (Decision 7: the cookie can be planted by someone else, the code proves the address);
 * a disabled button described by « Confirmez votre email pour utiliser vos tickets. » for an unverified one; nothing
 * while an admin impersonates. A success is announced in the shared status line and the focus goes to the section
 * heading (this row leaves the list when the page revalidates).
 */
export function SpendSeanceButton({
  slug,
  seance,
  canSpend,
  visitorState,
  googleEnabled,
  returnTo,
}: {
  slug: string;
  seance: SpendableSeance;
  canSpend: boolean;
  visitorState: VisitorState;
  googleEnabled: boolean;
  returnTo: string;
}) {
  const announce = useSpaceStatus();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const hintId = useId();
  const control = spendControlOf({ needsAnswers: seance.needsAnswers, canSpend, visitorState });

  function book() {
    setError(null);
    announce(null);
    startTransition(async () => {
      const res = await callOrFail(() => bookWithHeldTicketAction({ slug, occurrenceId: seance.occurrenceId, seenStartsAt: seance.startsAt, answers: [] }));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      announce(SPEND_DONE);
      upcomingHeading()?.focus();
    });
  }

  if (control === "none") return null;
  if (control === "link") {
    return (
      <Button asChild variant="secondary" size="sm">
        <Link href={`/${slug}/seance/${seance.occurrenceId}`}>{SPEND_LINK_LABEL}</Link>
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      {control === "disabled" ? (
        <>
          <Button type="button" size="sm" disabled aria-describedby={hintId}>
            {SPEND_LABEL}
          </Button>
          <p id={hintId} className="text-xs text-zinc-600 sm:text-right">
            {COPY.CONFIRM_EMAIL_TO_SPEND}
          </p>
        </>
      ) : (
        <Button type="button" size="sm" disabled={pending} onClick={control === "book" ? book : () => setSignInOpen(true)}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {pending ? COPY.PENDING_BOOK : SPEND_LABEL}
        </Button>
      )}
      <FormError message={error} />
      {control === "signin" && canOfferCodeSignIn(visitorState) && (
        <OtpDialog open={signInOpen} onClose={() => setSignInOpen(false)} returnTo={returnTo} googleEnabled={googleEnabled} />
      )}
    </div>
  );
}
