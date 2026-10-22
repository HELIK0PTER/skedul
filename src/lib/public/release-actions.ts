/**
 * E11 « Libérer ma place » (spec L1163-1168, contract Decisions 32, 33, 71).
 * From the payment return page a client gives a held seat back. The purchase
 * id comes from the input and nowhere else, is checked against the slug's pro
 * by purchaseByReference and, when an Owner is signed in, against the
 * Owner's customer (OUT:74, the precondition of releasePurchase). The core
 * never fulfils (the webhook is the fulfilment path) and never releases what
 * may be paid: it asks Stripe first and releases nothing it cannot prove
 * unpaid. No `server-only`, no env, no process db.
 */
import { z } from "zod";

import { releasePurchase } from "@/lib/booking/release";
import type { Effect } from "@/lib/booking/types";
import type { Db } from "@/lib/db/atomic";
import { throttleSubjectOf } from "@/lib/public/booking-actions";
import type { ActionVisitor, PublicDeps, PublicPro } from "@/lib/public/context";
import { customerEmailOf } from "@/lib/public/identity";
import { COPY } from "@/lib/public/messages";
import { purchaseByReference } from "@/lib/public/purchase-reads";
import { fromEngineClient, fromParse, publicFail, publicOk, type PublicCoreResult } from "@/lib/public/result";
import { checkActionThrottle } from "@/lib/throttle";
import { ENGINE_ERROR_MESSAGES, idSchema } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";

export type AbandonOutcome = "released" | "paid" | "processing" | "already_ended";

/** z.object({ purchaseId: idSchema }).strict() (SEC-M15). */
export const abandonInputSchema = z.object({ purchaseId: idSchema }).strict();

const outcome = (o: AbandonOutcome, effects: Effect[] = []) => publicOk<{ outcome: AbandonOutcome }>({ outcome: o }, effects);

/** E11 « Libérer ma place » (L1163-1168, OUT:74). */
export async function abandonCheckoutCore(
  db: Db,
  pro: PublicPro,
  visitor: ActionVisitor,
  input: unknown,
  deps: PublicDeps,
  now: Date,
): Promise<PublicCoreResult<{ outcome: AbandonOutcome }>> {
  const parsed = parseFr(abandonInputSchema, input);
  if (!parsed.ok) return fromParse(parsed);

  const vars = { businessName: pro.businessName };
  const notFound = () => fromEngineClient({ ok: false, code: "not_found" }, "release", vars);

  const ref = await purchaseByReference(db, pro.professionalId, parsed.data.purchaseId, now);
  if (!ref) return notFound();
  // A signed-in Owner can only release what is hers; a reference of another customer is ignored (OUT:74).
  if (visitor.owner && ref.customerId !== visitor.owner.customerId) return notFound();

  const email = await customerEmailOf(db, pro.professionalId, ref.customerId);
  if (email === null) return notFound();
  const allowed = await checkActionThrottle(
    db,
    {
      action: "release",
      professionalId: pro.professionalId,
      ipHash: visitor.ipHash,
      wideIpHash: visitor.wideIpHash,
      subject: throttleSubjectOf(visitor.session, email),
    },
    now,
  );
  if (!allowed) return publicFail(ENGINE_ERROR_MESSAGES.throttled, { code: "throttled" });

  if (ref.status === "paid") return outcome("paid");
  if (ref.status === "expired") return outcome("already_ended");
  // A pending purchase whose booking is confirmed has nothing left to give back (SEC-C1).
  if (ref.booking?.status === "confirmed") return outcome("already_ended");

  if (ref.checkoutSessionId !== null) {
    const closed = await deps.checkout.closeForRelease(ref.checkoutSessionId);
    if (closed === "paid") return outcome("paid");
    if (closed === "processing") return outcome("processing");
    if (closed === "failed") return publicFail(COPY.RELEASE_CHECK_FAILED);
    // "expired" | "already_expired" | "mock": the session can no longer be paid.
  } else if (ref.processing) {
    return outcome("processing");
  }

  const res = await releasePurchase(db, ref.purchaseId, now);
  if (!res.ok) return fromEngineClient(res, "release", vars);
  return outcome(res.released ? "released" : "already_ended", res.effects);
}
