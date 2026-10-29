/**
 * The executor of post-commit effects (LED:84, FR:SEC-1), pure: the plan reader, the mail budget, the sender, the
 * Google sync and the Stripe expiry come in as `deps`, so node:test runs every rule below with fakes.
 * src/server/notify.ts wires the real ones.
 *
 * Never throws: a failing effect logs « [notify] <type> failed: <message> » (no address, token or session id: only
 * logSafeMessage reaches a log) and the next effect still runs; an outer failure logs « [notify] run failed: … ».
 * `budget` has no default: "pro" (runProAction) spends the pro's e-mail budget, "none" (every P4 caller: client
 * actions, the Stripe webhook, the mock checkout) sends every mail and counts nothing (Decision 74).
 */
import type { Effect } from "@/lib/booking/types";
import { mailBudgetLogLine, type EffectBudget } from "@/lib/mail-budget";
import { dedupeEffects, logSafeMessage, type EffectPlan, type OutgoingEmail } from "@/lib/notify-core";

export type RunEffectsDeps = {
  /** planEffect(db, effect, { appUrl, guestKey, now: new Date() }) */
  plan: (effect: Effect) => Promise<EffectPlan>;
  /** mailsToSend(db, plan, budget, new Date()) of src/lib/mail-budget.ts: "pro" spends the pro's budget and may drop the tail of the plan, "none" sends every mail and counts nothing */
  mailsToSend: (
    plan: Extract<EffectPlan, { kind: "emails" }>,
    budget: EffectBudget,
  ) => Promise<{ send: OutgoingEmail[]; dropped: number }>;
  /** notify.ts sendPaced (the Resend pacing stays there) */
  sendEmail: (mail: OutgoingEmail) => Promise<void>;
  syncOccurrence: (occurrenceId: string) => Promise<void>;
  expireCheckout: (checkoutSessionId: string) => Promise<void>;
  /** console.error */
  log: (line: string) => void;
  /** console.warn: the budget line */
  warn: (line: string) => void;
};

async function execute(deps: RunEffectsDeps, plan: EffectPlan, budget: EffectBudget): Promise<void> {
  switch (plan.kind) {
    case "emails": {
      // Final review SEC-1: the mails of a pro's action spend the pro's budget; past it they are dropped, with one line and no address.
      const { send, dropped } = await deps.mailsToSend(plan, budget);
      if (dropped > 0 && plan.professionalId !== null) {
        deps.warn(logSafeMessage({ message: mailBudgetLogLine(plan.professionalId, dropped) }));
      }
      for (const mail of send) await deps.sendEmail(mail);
      return;
    }
    case "google":
      await deps.syncOccurrence(plan.occurrenceId);
      return;
    case "stripe":
      await deps.expireCheckout(plan.checkoutSessionId);
      return;
    default: {
      const unreachable: never = plan;
      throw new Error(`Unhandled plan: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * Runs effects after commit, best effort: duplicates dropped and Google syncs last (dedupeEffects), each effect
 * planned from a fresh read, then executed. An « emails » plan goes through deps.mailsToSend(plan, budget) and, when
 * dropped > 0 and plan.professionalId is not null, warns one line (pro id and count) before sending the rest.
 */
export async function runEffectsWith(deps: RunEffectsDeps, effects: readonly Effect[], budget: EffectBudget): Promise<void> {
  try {
    for (const effect of dedupeEffects(effects)) {
      try {
        await execute(deps, await deps.plan(effect), budget);
      } catch (err) {
        deps.log(`[notify] ${effect.type} failed: ${logSafeMessage(err)}`);
      }
    }
  } catch (err) {
    deps.log(`[notify] run failed: ${logSafeMessage(err)}`);
  }
}
