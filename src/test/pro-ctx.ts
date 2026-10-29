import type { ProCtx } from "../lib/back-office/result";
import type { TestPro } from "./db";

/** The ProCtx of a test pro (its user acts): what requireProContext() builds from a session. */
export function proCtx(pro: TestPro): ProCtx {
  return {
    professionalId: pro.proId,
    actorUserId: pro.userId,
    timezone: pro.tz,
    currency: pro.currency,
    slug: pro.slug,
  };
}
