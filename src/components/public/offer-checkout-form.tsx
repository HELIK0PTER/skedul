"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { useRefusalFocus } from "@/components/dashboard/use-refusal-focus";
import { IdentityFields } from "@/components/public/identity-fields";
import { TestPaymentsBanner } from "@/components/public/test-payments-banner";
import { Button } from "@/components/ui/button";
import type { IdentityInput } from "@/lib/public/identity-schema";
import type { VisitorState } from "@/lib/public/identity";
import { COPY } from "@/lib/public/messages";
import { identityErrors, identityToSend } from "@/lib/public/occurrence-form";
import { PUBLIC_UNEXPECTED } from "@/lib/public/result";
import { startShopPurchaseAction } from "@/server/public";

/**
 * The identity form of a shop purchase (E9, spec L1099-1104, contract § 3.23): « Prénom et nom », « Email », « Téléphone »,
 * then « Payer {prix} ». It posts the slug, the offer id, the typed identity and the honeypot, and leaves for the Checkout
 * URL the server answers with. The e-mail is read-only for a VERIFIED session only (the session address, never a cookie's);
 * everybody else types an address, which identifies a client row and authorises nothing (Decision 38).
 */
export function OfferCheckoutForm({
  slug,
  offerId,
  businessName,
  priceLabel,
  visitor,
  testMode,
}: {
  slug: string;
  offerId: string;
  businessName: string;
  priceLabel: string;
  visitor: { state: VisitorState; email: string | null; name: string | null };
  testMode: "mock" | "test" | null;
}) {
  const emailLocked = visitor.state === "verified" && visitor.email !== null;
  const [identity, setIdentity] = useState<IdentityInput>({
    name: visitor.name ?? "",
    email: emailLocked ? (visitor.email ?? "") : "",
    phone: "",
  });
  // The session can turn verified under this mounted form (a code accepted in the banner above, then a refresh of the
  // page): from then on the session's address replaces whatever was typed, in the field, in the check and in the call.
  const effective: IdentityInput = emailLocked && visitor.email !== null ? { ...identity, email: visitor.email } : identity;
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** The navigation to the Checkout page has started: the button stays disabled until the page unloads. */
  const [redirecting, setRedirecting] = useState(false);
  const [pending, startTransition] = useTransition();
  /** After a refusal: the focus goes to the first invalid field, else to the alert line (WCAG 3.3.1). */
  const { root, errorBox, refused } = useRefusalFocus();
  const busy = pending || redirecting;

  // Back from the Checkout page, the browser may restore this page from its back/forward cache with the button still
  // « Redirection vers le paiement… » and disabled: a restored page leaves that state.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    // What the server's parse would refuse is said at once, under its field, without a call.
    const local = identityErrors(effective);
    setErrors(local);
    if (Object.keys(local).length > 0) {
      refused();
      return;
    }
    startTransition(async () => {
      try {
        const res = await startShopPurchaseAction({ slug, offerId, identity: identityToSend(effective), website });
        if (!res.ok) {
          const fields = res.fieldErrors ?? {};
          setErrors(fields);
          // A refusal that belongs to an identity field is shown under that field; any other one is the form's own line.
          if (!Object.keys(fields).some((key) => key.startsWith("identity."))) setFormError(res.error);
          refused();
          return;
        }
        setRedirecting(true);
        window.location.assign(res.checkoutUrl);
      } catch {
        setFormError(PUBLIC_UNEXPECTED);
        refused();
      }
    });
  }

  return (
    <form ref={root} method="post" onSubmit={onSubmit} noValidate className="space-y-5">
      {testMode && <TestPaymentsBanner mode={testMode} />}
      <IdentityFields
        idPrefix="offer"
        value={effective}
        onChange={setIdentity}
        emailLocked={emailLocked}
        errors={errors}
        businessName={businessName}
        website={website}
        onWebsite={setWebsite}
      />
      {/* Always mounted, so that a screen reader announces a failure when it appears. */}
      <FormError alwaysMounted message={formError} ref={errorBox} tabIndex={-1} />
      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={busy}>
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {busy ? COPY.PENDING_PAY : `Payer ${priceLabel}`}
      </Button>
    </form>
  );
}
