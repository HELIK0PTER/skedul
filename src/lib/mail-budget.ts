/**
 * Budget of the client e-mails a pro's actions send (final review SEC-1). Every
 * action of the back-office can mail addresses the pro typed, and one edit
 * fans out to every registrant, all through the sender that also carries the
 * sign-in codes: without a cap a throwaway pro account is a mail relay and can
 * use up the Resend quota. One counter per pro on the `throttle` table, one
 * fixed 24 h window; past the budget the mail is dropped (the action itself
 * has already succeeded and never fails because of it). No server-only, no
 * env: the DB tests run this module as it is.
 */
import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db/atomic";
import { professional, user } from "@/lib/db/schema";
import type { EffectPlan, OutgoingEmail } from "@/lib/notify-core";
import { hitThrottle, proMailThrottleKey } from "@/lib/throttle";

/** E-mails per pro and per window: a pro whose own address is not verified yet gets the small one. */
export const PRO_MAIL_BUDGET = { unverified: 50, verified: 2000, windowSec: 86_400 } as const;

export type MailBudget = { unverified: number; verified: number; windowSec: number };

/** One server-log line when a plan was cut: the pro id and counts only, never an address. */
export function mailBudgetLogLine(professionalId: string, dropped: number): string {
  return `[notify] mail budget reached for pro ${professionalId}: ${dropped} e-mail(s) not sent`;
}

/**
 * Spends the budget of the pro for one e-mails plan and says which mails may
 * leave: the first ones of the plan, as many as the budget still allows (one
 * atomic statement counts them all, so concurrent runs share the budget
 * exactly). Dropped mails are counted too: a pro past the budget stays past
 * it until the window ends. A plan that names no pro sends nothing.
 */
export async function applyMailBudget(
  db: Db,
  plan: Extract<EffectPlan, { kind: "emails" }>,
  now: Date,
  budget: MailBudget = PRO_MAIL_BUDGET,
): Promise<{ send: OutgoingEmail[]; dropped: number }> {
  const count = plan.emails.length;
  if (count === 0) return { send: [], dropped: 0 };
  if (plan.professionalId === null) return { send: [], dropped: count };
  const [owner] = await db
    .select({ verified: user.emailVerified })
    .from(professional)
    .innerJoin(user, eq(user.id, professional.userId))
    .where(eq(professional.id, plan.professionalId));
  const limit = owner?.verified === true ? budget.verified : budget.unverified;
  const hits = await hitThrottle(db, proMailThrottleKey(plan.professionalId), count, budget.windowSec, now);
  const allowed = Math.max(0, Math.min(count, limit - (hits - count)));
  return { send: plan.emails.slice(0, allowed), dropped: count - allowed };
}

/**
 * Whose budget an effect run spends. Only the actions a pro takes in the
 * back-office ("pro", passed by runProAction) are counted: the mails of a
 * public purchase or booking (receipt, confirmation, notice to the pro, run
 * from the Stripe webhook or the mock checkout) are the pro's customers
 * getting what they paid for and are never dropped, however many came. There
 * is no default: every caller of runEffects says which one it is.
 */
export type EffectBudget = "pro" | "none";

/** The mails of an e-mails plan that may leave: the budget decides for "pro", every mail leaves (and nothing is counted) for "none". */
export async function mailsToSend(
  db: Db,
  plan: Extract<EffectPlan, { kind: "emails" }>,
  budget: EffectBudget,
  now: Date,
  limits: MailBudget = PRO_MAIL_BUDGET,
): Promise<{ send: OutgoingEmail[]; dropped: number }> {
  if (budget === "none") return { send: plan.emails, dropped: 0 };
  return applyMailBudget(db, plan, now, limits);
}
