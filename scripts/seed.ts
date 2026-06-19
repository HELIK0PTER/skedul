import "./load-env";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { instantFromWallClock } from "@/lib/datetime";

const {
  user,
  professional,
  eventType,
  availabilityRule,
  pack,
  customer,
  packPurchase,
  booking,
} = schema;

// A seed-only auth instance WITHOUT the next-cookies plugin, so signUp works
// outside of an HTTP request context.
const seedAuth = betterAuth({
  appName: "Skedul",
  secret: process.env.BETTER_AUTH_SECRET!,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: { enabled: true, autoSignIn: false, minPasswordLength: 8 },
});

const TZ = "Europe/Paris";

async function createUser(name: string, email: string, password: string) {
  const res = await seedAuth.api.signUpEmail({
    body: { name, email, password },
  });
  return res.user.id;
}

async function wipe() {
  await db.execute(sql`
    TRUNCATE TABLE
      booking, pack_purchase, customer, pack, availability_rule,
      event_type, professional, "session", account, verification, "user"
    RESTART IDENTITY CASCADE
  `);
}

async function main() {
  console.info("🌱 Seeding Skedul (Neon: development branch)…");
  await wipe();

  /* ── Professional account ─────────────────────────────────────── */
  const proUserId = await createUser(
    "Camille Laurent",
    "pro@skedul.app",
    "password123",
  );
  await db.update(user).set({ role: "pro" }).where(eq(user.id, proUserId));

  const [pro] = await db
    .insert(professional)
    .values({
      userId: proUserId,
      slug: "studio-camille",
      businessName: "Studio Camille · Coaching & Yoga",
      headline: "Coaching de vie & yoga privé à Paris",
      bio: "J'accompagne depuis 8 ans des indépendants et des équipes vers plus de clarté et d'énergie. Réservez une séance à l'unité ou économisez avec un pack.",
      brandColor: "#6d5cf6",
      timezone: TZ,
      currency: "eur",
    })
    .returning();

  /* ── Event types ──────────────────────────────────────────────── */
  const [coaching] = await db
    .insert(eventType)
    .values({
      professionalId: pro.id,
      title: "Séance de coaching",
      slug: "seance-de-coaching",
      description:
        "Un face-à-face d'une heure pour avancer sur un objectif précis.",
      durationMinutes: 60,
      priceCents: 8000,
      color: "#6d5cf6",
      bufferAfterMinutes: 15,
    })
    .returning();

  const [yoga] = await db
    .insert(eventType)
    .values({
      professionalId: pro.id,
      title: "Cours de yoga privé",
      slug: "cours-de-yoga-prive",
      description: "Séance de yoga sur-mesure, à votre rythme.",
      durationMinutes: 45,
      priceCents: 5000,
      color: "#0ea5e9",
    })
    .returning();

  const [discovery] = await db
    .insert(eventType)
    .values({
      professionalId: pro.id,
      title: "Appel découverte",
      slug: "appel-decouverte",
      description: "15 minutes offertes pour faire connaissance.",
      durationMinutes: 15,
      priceCents: 0,
      color: "#16a34a",
    })
    .returning();

  /* ── Availability: Mon–Fri 9–12 & 14–18, Sat 10–13 ───────────── */
  const rules: {
    professionalId: string;
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
  }[] = [];
  for (const day of [1, 2, 3, 4, 5]) {
    rules.push({ professionalId: pro.id, dayOfWeek: day, startMinute: 540, endMinute: 720 });
    rules.push({ professionalId: pro.id, dayOfWeek: day, startMinute: 840, endMinute: 1080 });
  }
  rules.push({ professionalId: pro.id, dayOfWeek: 6, startMinute: 600, endMinute: 780 });
  await db.insert(availabilityRule).values(rules);

  /* ── Packs ────────────────────────────────────────────────────── */
  const [packCoaching] = await db
    .insert(pack)
    .values({
      professionalId: pro.id,
      name: "Pack 4 séances de coaching",
      description: "4 heures de coaching à utiliser quand vous voulez. -12%.",
      credits: 4,
      priceCents: 28000,
      eventTypeId: coaching.id,
    })
    .returning();

  const [packYoga] = await db
    .insert(pack)
    .values({
      professionalId: pro.id,
      name: "Pack 10 cours de yoga",
      description: "10 cours privés prépayés. -16%.",
      credits: 10,
      priceCents: 42000,
      eventTypeId: yoga.id,
    })
    .returning();

  await db.insert(pack).values({
    professionalId: pro.id,
    name: "Carte 3 séances (toutes prestations)",
    description: "3 crédits utilisables sur n'importe quelle prestation.",
    credits: 3,
    priceCents: 18000,
    eventTypeId: null,
  });

  /* ── Clients & customers ──────────────────────────────────────── */
  const sophieUserId = await createUser(
    "Sophie Martin",
    "sophie@example.com",
    "password123",
  );

  const [sophie] = await db
    .insert(customer)
    .values({
      professionalId: pro.id,
      userId: sophieUserId,
      name: "Sophie Martin",
      email: "sophie@example.com",
      phone: "+33 6 12 34 56 78",
    })
    .returning();

  const [lucas] = await db
    .insert(customer)
    .values({
      professionalId: pro.id,
      name: "Lucas Bernard",
      email: "lucas@example.com",
    })
    .returning();

  const [emma] = await db
    .insert(customer)
    .values({
      professionalId: pro.id,
      name: "Emma Dubois",
      email: "emma@example.com",
    })
    .returning();

  /* ── Pack purchases (paid, with remaining credits) ────────────── */
  const [sophiePurchase] = await db
    .insert(packPurchase)
    .values({
      packId: packCoaching.id,
      professionalId: pro.id,
      customerId: sophie.id,
      creditsTotal: 4,
      creditsRemaining: 3, // 1 already used below
      amountPaidCents: 28000,
      currency: "eur",
      status: "paid",
      stripeSessionId: "cs_test_seed_sophie",
    })
    .returning();

  await db.insert(packPurchase).values({
    packId: packYoga.id,
    professionalId: pro.id,
    customerId: lucas.id,
    creditsTotal: 10,
    creditsRemaining: 8, // 2 used below
    amountPaidCents: 42000,
    currency: "eur",
    status: "paid",
    stripeSessionId: "cs_test_seed_lucas",
  });

  /* ── Bookings (past + upcoming) ───────────────────────────────── */
  const at = (
    y: number,
    m: number,
    d: number,
    minutes: number,
    duration: number,
  ) => {
    const start = instantFromWallClock(y, m, d, minutes, TZ);
    const end = instantFromWallClock(y, m, d, minutes + duration, TZ);
    return { start, end };
  };

  // Sophie — 1 past completed coaching (credit), 1 upcoming confirmed (credit)
  const s1 = at(2026, 6, 12, 600, 60); // Fri 12 June 10:00 (past)
  const s2 = at(2026, 6, 22, 600, 60); // Mon 22 June 10:00 (upcoming)
  // Lucas — 2 yoga sessions (credit): 1 past, 1 upcoming
  const l1 = at(2026, 6, 13, 600, 45); // Sat 13 June 10:00 (past)
  const l2 = at(2026, 6, 24, 840, 45); // Wed 24 June 14:00 (upcoming)
  // Emma — direct-paid coaching upcoming
  const e1 = at(2026, 6, 26, 570, 60); // Fri 26 June 09:30 (upcoming)

  await db.insert(booking).values([
    {
      professionalId: pro.id,
      eventTypeId: coaching.id,
      customerId: sophie.id,
      startAt: s1.start,
      endAt: s1.end,
      status: "completed",
      paymentType: "credit",
      amountPaidCents: 0,
      packPurchaseId: sophiePurchase.id,
    },
    {
      professionalId: pro.id,
      eventTypeId: coaching.id,
      customerId: sophie.id,
      startAt: s2.start,
      endAt: s2.end,
      status: "confirmed",
      paymentType: "credit",
      amountPaidCents: 0,
      packPurchaseId: sophiePurchase.id,
      customerNotes: "On reprend là où on s'était arrêtées 🙂",
    },
    {
      professionalId: pro.id,
      eventTypeId: yoga.id,
      customerId: lucas.id,
      startAt: l1.start,
      endAt: l1.end,
      status: "completed",
      paymentType: "credit",
      amountPaidCents: 0,
    },
    {
      professionalId: pro.id,
      eventTypeId: yoga.id,
      customerId: lucas.id,
      startAt: l2.start,
      endAt: l2.end,
      status: "confirmed",
      paymentType: "credit",
      amountPaidCents: 0,
    },
    {
      professionalId: pro.id,
      eventTypeId: coaching.id,
      customerId: emma.id,
      startAt: e1.start,
      endAt: e1.end,
      status: "confirmed",
      paymentType: "direct",
      amountPaidCents: 8000,
      stripeSessionId: "cs_test_seed_emma",
    },
  ]);

  // mark the free discovery type used so it shows up in stats too
  void discovery;

  console.info("\n✅ Seed terminé.\n");
  console.info("Comptes de démonstration :");
  console.info("  • Pro    → pro@skedul.app     / password123");
  console.info("  • Client → sophie@example.com / password123");
  console.info("\nPage publique : /studio-camille");
  console.info("Back-office   : /dashboard\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  });
