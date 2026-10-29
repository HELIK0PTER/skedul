import { FlaskConical } from "lucide-react";

import { COPY } from "@/lib/public/messages";

/**
 * « Paiements en mode test »: rendered above every purchase control (Boutique, the buy block of the séance page, the
 * offer page) whenever paymentMode() is not "live". The condition is the key prefix at run time, so the banner goes
 * away with live keys without a code change (Decision 15, spec L1794).
 */
export function TestPaymentsBanner({ mode }: { mode: "mock" | "test" }) {
  return (
    <div role="note" className="flex items-start gap-3 rounded-2xl border border-border bg-muted p-4 text-sm">
      <FlaskConical className="mt-0.5 size-5 shrink-0 text-zinc-600" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold text-foreground">{COPY.PAYMENTS_TEST_TITLE}</p>
        <p className="text-zinc-600">{mode === "mock" ? COPY.PAYMENTS_TEST_MOCK : COPY.PAYMENTS_TEST_STRIPE}</p>
      </div>
    </div>
  );
}
