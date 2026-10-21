import "server-only";

import type { Effect } from "@/lib/booking/types";
import { syncOccurrence } from "@/lib/calendar-sync";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { mailBudgetLogLine, mailsToSend, type EffectBudget } from "@/lib/mail-budget";
import { dedupeEffects, logSafeMessage, planEffect, type EffectPlan, type OutgoingEmail } from "@/lib/notify-core";
import { expireCheckoutSession } from "@/lib/stripe";
import { guestKey } from "@/server/guest-key";

/** Resend allows 2 requests per second by default: with Resend on, e-mails leave one by one, at least 550 ms apart. */
const MAIL_GAP_MS = 550;

/** When the next e-mail may leave (epoch ms). Module level, so it paces every run of this server instance. */
let nextMailAt = 0;

async function sendPaced(mail: OutgoingEmail): Promise<void> {
  if (env.RESEND_ENABLED) {
    // The slot is reserved before the first await: two runs in flight queue behind each other.
    const slot = Math.max(Date.now(), nextMailAt);
    nextMailAt = slot + MAIL_GAP_MS;
    const wait = slot - Date.now();
    if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
  }
  await sendEmail(mail);
}

async function execute(plan: EffectPlan, budget: EffectBudget): Promise<void> {
  switch (plan.kind) {
    case "emails": {
      // Final review SEC-1: the mails of a pro's action spend the pro's budget; past it they are dropped, with one line and no address. The fulfilment of a public purchase is not a pro action and is not counted.
      const { send, dropped } = await mailsToSend(db, plan, budget, new Date());
      if (dropped > 0 && plan.professionalId !== null) {
        console.warn(logSafeMessage({ message: mailBudgetLogLine(plan.professionalId, dropped) }));
      }
      for (const mail of send) await sendPaced(mail);
      return;
    }
    case "google":
      await syncOccurrence(plan.occurrenceId);
      return;
    case "stripe":
      await expireCheckoutSession(plan.checkoutSessionId);
      return;
    case "deferred":
      console.warn(`[notify] ${plan.type} is wired in P4`);
      return;
    default: {
      const unreachable: never = plan;
      throw new Error(`Unhandled plan: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * Runs effects after commit, best effort: duplicates dropped and Google syncs
 * last (dedupeEffects), each effect planned from a fresh read (planEffect),
 * then executed (sendEmail, syncOccurrence, expireCheckoutSession). Never
 * throws: a failing effect logs « [notify] <type> failed: <message> » (no
 * address, token or session id) and the next one still runs. E-mails leave
 * one by one, paced under Resend's 2 requests per second (sendPaced), so a
 * séance of 100 registrants takes about a minute. Scheduled with after() by
 * runProAction, so it never delays the response. `budget` has no default:
 * "pro" (runProAction) spends the pro's e-mail budget, "none" (the
 * fulfilment of a public purchase or booking, P4) never drops a mail.
 */
export async function runEffects(effects: readonly Effect[], budget: EffectBudget): Promise<void> {
  try {
    for (const effect of dedupeEffects(effects)) {
      try {
        const plan = await planEffect(db, effect, { appUrl: env.APP_URL, guestKey: guestKey(), now: new Date() });
        await execute(plan, budget);
      } catch (err) {
        console.error(`[notify] ${effect.type} failed: ${logSafeMessage(err)}`);
      }
    }
  } catch (err) {
    console.error(`[notify] run failed: ${logSafeMessage(err)}`);
  }
}
