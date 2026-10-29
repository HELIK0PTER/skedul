/**
 * The cancel core of the client espace (spec E5, L904-924) and the rule that says who acts there. A public core: it
 * parses the WHOLE input first, takes the identity from the server-built visitor (never from the input), spends a
 * `cancel` throttle hit before the engine call, then cancelByClient with the pro of the page. No `server-only`, no env,
 * no process db: src/server/client.ts is the thin wrapper.
 */
import { z } from "zod";

import { cancelByClient } from "@/lib/booking/cancel";
import type { Db } from "@/lib/db/atomic";
import type { ActionVisitor, PublicPro } from "@/lib/public/context";
import { customerEmailOf, visitorState } from "@/lib/public/identity";
import { fromEngineClient, fromParse, publicFail, publicOk, type PublicCoreResult } from "@/lib/public/result";
import { checkActionThrottle, type ThrottleSubject } from "@/lib/throttle";
import { ENGINE_ERROR_MESSAGES, idSchema } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";

/** Who acts in the espace: the Owner through the session (a user id to record), or a cookie customer (no user). */
export type SpaceActor = { customerId: string; actorUserId: string | null; via: "session" | "guest" };

/**
 * Who acts in this pro's espace, in this order: an impersonating session is nobody (the cookie is ignored too,
 * SEC-M6, Decision 19); the Owner; a verified session WITHOUT a record here is nobody (the cookie is ignored, L1370);
 * else the guest cookie customer (L1368, read and cancel only: the cookie can be planted, so it never spends).
 */
export function spaceActorOf(visitor: Pick<ActionVisitor, "session" | "owner" | "guestCustomerId">): SpaceActor | null {
  const state = visitorState(visitor.session);
  if (state === "impersonating") return null;
  if (visitor.owner) return { customerId: visitor.owner.customerId, actorUserId: visitor.owner.userId, via: "session" };
  if (state === "verified") return null;
  if (visitor.guestCustomerId) return { customerId: visitor.guestCustomerId, actorUserId: null, via: "guest" };
  return null;
}

/** The only field of a cancellation; strict, so a smuggled key (customerId, professionalId, slug) is refused whole (SEC-M15). */
export const cancelMyInputSchema = z.object({ bookingId: idSchema }).strict();

/**
 * E5, « Annuler » in the espace: parse; the actor (nobody → the not-found wording); the throttle subject (the Owner's
 * user id, or the cookie customer's own address: never the cookie, never a typed address); `checkActionThrottle`
 * `cancel` BEFORE the engine call (refused → `throttled`, nothing changes, SEC-I2); cancelByClient for the pro of the
 * page and the actor's customer, so a booking of another customer or of another pro is `not_found`.
 */
export async function cancelMyBookingCore(
  db: Db,
  pro: PublicPro,
  visitor: ActionVisitor,
  input: unknown,
  now: Date,
): Promise<PublicCoreResult> {
  const parsed = parseFr(cancelMyInputSchema, input);
  if (!parsed.ok) return fromParse(parsed);
  const vars = { businessName: pro.businessName };
  const notFound = () => fromEngineClient({ ok: false, code: "not_found" }, "cancel", vars);

  const actor = spaceActorOf(visitor);
  if (!actor) return notFound();

  let subject: ThrottleSubject;
  if (actor.via === "session" && actor.actorUserId !== null) {
    subject = { kind: "user", userId: actor.actorUserId };
  } else {
    const email = await customerEmailOf(db, pro.professionalId, actor.customerId);
    if (email === null) return notFound();
    subject = { kind: "email", email };
  }
  const allowed = await checkActionThrottle(
    db,
    { action: "cancel", professionalId: pro.professionalId, ipHash: visitor.ipHash, wideIpHash: visitor.wideIpHash, subject },
    now,
  );
  if (!allowed) return publicFail(ENGINE_ERROR_MESSAGES.throttled, { code: "throttled" });

  const res = await cancelByClient(
    db,
    {
      professionalId: pro.professionalId,
      customerId: actor.customerId,
      bookingId: parsed.data.bookingId,
      actorUserId: actor.actorUserId,
    },
    now,
  );
  if (!res.ok) return fromEngineClient(res, "cancel", vars);
  return publicOk({}, res.effects);
}
