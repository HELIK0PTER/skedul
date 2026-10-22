import "server-only";

import type { Effect } from "@/lib/booking/types";
import { syncOccurrence } from "@/lib/calendar-sync";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { mailsToSend, type EffectBudget } from "@/lib/mail-budget";
import { planEffect, type OutgoingEmail } from "@/lib/notify-core";
import { runEffectsWith } from "@/lib/notify-run";
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

/**
 * Runs effects after commit, best effort: the tested runEffectsWith (src/lib/notify-run.ts) with the real
 * dependencies. Duplicates dropped and Google syncs last, each effect planned from a fresh read, then executed.
 * Never throws: a failing effect logs « [notify] <type> failed: <message> » (no address, token or session id) and
 * the next one still runs. E-mails leave one by one, paced under Resend's 2 requests per second (sendPaced), so a
 * séance of 100 registrants takes about a minute. Scheduled with after() by runProAction (budget "pro": the pro's
 * e-mail budget, final review SEC-1) and by runPublicAction, runClientAction, the Stripe webhook and the mock
 * checkout (budget "none": the client gets what they asked or paid for, bounded by the throttle keys, Decision 74).
 * `budget` has no default.
 */
export async function runEffects(effects: readonly Effect[], budget: EffectBudget): Promise<void> {
  await runEffectsWith(
    {
      plan: (effect) => planEffect(db, effect, { appUrl: env.APP_URL, guestKey: guestKey(), now: new Date() }),
      mailsToSend: (plan, mailBudget) => mailsToSend(db, plan, mailBudget, new Date()),
      sendEmail: sendPaced,
      syncOccurrence: async (occurrenceId) => {
        await syncOccurrence(occurrenceId);
      },
      expireCheckout: async (checkoutSessionId) => {
        await expireCheckoutSession(checkoutSessionId);
      },
      log: (line) => console.error(line),
      warn: (line) => console.warn(line),
    },
    effects,
    budget,
  );
}
