import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { INLINE_LINK_CLASS } from "@/components/ui/link-class";
import type { CustomerSpace } from "@/lib/back-office/customer-space";
import { COPY } from "@/lib/public/messages";
import { BOUTIQUE_ANCHOR } from "@/lib/public-anchors";

/**
 * The balance of the Owner by ticket type (contract § 3.23). Rendered for an Owner only: the page decides, the wallet
 * of a customer resolved from a typed e-mail, a purchase reference or a guest cookie is never shown here. `full`
 * is the card of /[slug]; `compact` is the one line above the booking block of the séance page (nothing when empty).
 */
export function WalletPanel({
  slug,
  businessName,
  wallet,
  variant,
}: {
  slug: string;
  businessName: string;
  wallet: CustomerSpace["wallet"];
  variant: "full" | "compact";
}) {
  const spaceHref = `/${slug}/espace`;

  if (variant === "compact") {
    if (wallet.length === 0) return null;
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 wrap-anywhere">{`Vos tickets : ${wallet.map((w) => `${w.usable} × ${w.name}`).join(", ")}`}</p>
        <Link href={spaceHref} className={`${INLINE_LINK_CLASS} shrink-0`}>
          {COPY.MY_SPACE}
        </Link>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        {/* An h2: the card sits above the « Planning » h2 of the page, under the shell's h1. */}
        <h2 className="text-base leading-tight font-semibold">Vos tickets</h2>
        <Button asChild variant="secondary" size="sm" className="w-full sm:w-auto">
          <Link href={spaceHref}>{COPY.MY_SPACE}</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {wallet.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600">{COPY.NO_TICKET}</p>
            <Link href={`#${BOUTIQUE_ANCHOR}`} className={INLINE_LINK_CLASS}>
              {COPY.SEE_SHOP}
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {wallet.map((w) => (
              <li key={w.ticketTypeId} className="space-y-1 py-3 first:pt-0 last:pb-0">
                <p className="flex items-start gap-2 font-medium">
                  <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: w.color }} aria-hidden />
                  <span className="min-w-0 wrap-anywhere">{`${w.usable} × ${w.name}`}</span>
                </p>
                {w.expiries.map((text) => (
                  <p key={text} className="text-sm text-zinc-600">
                    {text}
                  </p>
                ))}
                {w.archived && (
                  <p className="text-xs text-zinc-600 wrap-anywhere">{`Ce type n'est plus proposé par ${businessName}.`}</p>
                )}
                {w.typeClass === "orphan" && <p className="text-xs text-zinc-600">{COPY.ORPHAN_TYPE}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
