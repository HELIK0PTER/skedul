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
    "Altinha Paris",
    "pro@skedul.app",
    "password123",
  );
  await db.update(user).set({ role: "pro" }).where(eq(user.id, proUserId));

  const [pro] = await db
    .insert(professional)
    .values({
      userId: proUserId,
      slug: "altinha-paris",
      businessName: "Altinha Paris",
      headline: "Aulas de altinha em Paris, com a energia do Rio ☀️",
      bio: "A gente começou a dar aulas pra compartilhar a altinha e fazer esse esporte crescer aqui em Paris. Nascemos e crescemos no Rio, então trazemos essa energia pra cá. As aulas duram 1h, em grupos pequenos organizados por nível, pra todo mundo evoluir no seu ritmo. De segunda a sábado, entre Nation e Tuileries. 🤍",
      brandColor: "#d97706",
      themePreset: "amber",
      headerLayout: "vitrine",
      avatarKind: "generated",
      avatarStyle: "fun-emoji",
      avatarSeed: "altinha-paris",
      timezone: TZ,
      currency: "eur",
    })
    .returning();

  /* ── Event types (aulas, toutes 1h) ───────────────────────────── */
  const [experimental] = await db
    .insert(eventType)
    .values({
      professionalId: pro.id,
      title: "Aula experimental",
      slug: "aula-experimental",
      description:
        "Sua primeira aula pra experimentar a altinha e sentir a vibe, sem compromisso.",
      durationMinutes: 60,
      priceCents: 1500,
      color: "#f59e0b",
    })
    .returning();

  const [individual] = await db
    .insert(eventType)
    .values({
      professionalId: pro.id,
      title: "Aula individual",
      slug: "aula-individual",
      description:
        "Aula só pra você, com foco total na sua evolução e no seu ritmo.",
      durationMinutes: 60,
      priceCents: 3000,
      color: "#0ea5e9",
    })
    .returning();

  const [group] = await db
    .insert(eventType)
    .values({
      professionalId: pro.id,
      title: "Aula em grupo",
      slug: "aula-em-grupo",
      description:
        "Grupo pequeno organizado por nível. A energia da altinha com a galera. Preço por pessoa.",
      durationMinutes: 60,
      priceCents: 2500,
      color: "#16a34a",
    })
    .returning();

  /* ── Availability: seg–sáb, 10h/11h/12h & 17h30/18h30/19h30 ───── */
  // Créneaux de 1h → step = durée : 600–780 = 10h,11h,12h ; 1050–1230 = 17h30,18h30,19h30.
  const rules: {
    professionalId: string;
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
  }[] = [];
  for (const day of [1, 2, 3, 4, 5, 6]) {
    rules.push({ professionalId: pro.id, dayOfWeek: day, startMinute: 600, endMinute: 780 });
    rules.push({ professionalId: pro.id, dayOfWeek: day, startMinute: 1050, endMinute: 1230 });
  }
  await db.insert(availabilityRule).values(rules);

  /* ── Packs ────────────────────────────────────────────────────── */
  const [pack4] = await db
    .insert(pack)
    .values({
      professionalId: pro.id,
      name: "Pack 4 aulas",
      description:
        "4 aulas em grupo pré-pagas, pra usar quando quiser. Economize 15€ vs. a aula avulsa. 🌞",
      credits: 4,
      priceCents: 8500,
      eventTypeId: group.id,
    })
    .returning();

  /* ── Clients & customers ──────────────────────────────────────── */
  const beatrizUserId = await createUser(
    "Beatriz Almeida",
    "beatriz@example.com",
    "password123",
  );

  const [beatriz] = await db
    .insert(customer)
    .values({
      professionalId: pro.id,
      userId: beatrizUserId,
      name: "Beatriz Almeida",
      email: "beatriz@example.com",
      phone: "+33 6 11 22 33 44",
    })
    .returning();

  const [rafael] = await db
    .insert(customer)
    .values({
      professionalId: pro.id,
      name: "Rafael Souza",
      email: "rafael@example.com",
    })
    .returning();

  const [thomas] = await db
    .insert(customer)
    .values({
      professionalId: pro.id,
      name: "Thomas Leroy",
      email: "thomas@example.com",
    })
    .returning();

  const [marina] = await db
    .insert(customer)
    .values({
      professionalId: pro.id,
      name: "Marina Costa",
      email: "marina@example.com",
    })
    .returning();

  /* ── Pack purchases (paid, with remaining credits) ────────────── */
  const [beatrizPurchase] = await db
    .insert(packPurchase)
    .values({
      packId: pack4.id,
      professionalId: pro.id,
      customerId: beatriz.id,
      creditsTotal: 4,
      creditsRemaining: 2, // 2 used below (1 past + 1 upcoming)
      amountPaidCents: 8500,
      currency: "eur",
      status: "paid",
      stripeSessionId: "cs_test_seed_beatriz",
    })
    .returning();

  const [rafaelPurchase] = await db
    .insert(packPurchase)
    .values({
      packId: pack4.id,
      professionalId: pro.id,
      customerId: rafael.id,
      creditsTotal: 4,
      creditsRemaining: 3, // 1 used below (upcoming)
      amountPaidCents: 8500,
      currency: "eur",
      status: "paid",
      stripeSessionId: "cs_test_seed_rafael",
    })
    .returning();

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

  // Beatriz — pack credits: 1 past completed group + 1 upcoming confirmed group
  const b1 = at(2026, 6, 17, 1110, 60); // Wed 17 June 18:30 (past)
  const b2 = at(2026, 6, 22, 1110, 60); // Mon 22 June 18:30 (upcoming)
  // Rafael — pack credit: 1 upcoming group
  const r1 = at(2026, 6, 23, 1110, 60); // Tue 23 June 18:30 (upcoming)
  // Thomas — direct-paid trial upcoming
  const t1 = at(2026, 6, 24, 660, 60); // Wed 24 June 11:00 (upcoming)
  // Marina — direct-paid individual upcoming
  const m1 = at(2026, 6, 25, 1170, 60); // Thu 25 June 19:30 (upcoming)

  await db.insert(booking).values([
    {
      professionalId: pro.id,
      eventTypeId: group.id,
      customerId: beatriz.id,
      startAt: b1.start,
      endAt: b1.end,
      status: "completed",
      paymentType: "credit",
      amountPaidCents: 0,
      packPurchaseId: beatrizPurchase.id,
    },
    {
      professionalId: pro.id,
      eventTypeId: group.id,
      customerId: beatriz.id,
      startAt: b2.start,
      endAt: b2.end,
      status: "confirmed",
      paymentType: "credit",
      amountPaidCents: 0,
      packPurchaseId: beatrizPurchase.id,
      customerNotes: "Bora! Tô amando as aulas 🙌",
    },
    {
      professionalId: pro.id,
      eventTypeId: group.id,
      customerId: rafael.id,
      startAt: r1.start,
      endAt: r1.end,
      status: "confirmed",
      paymentType: "credit",
      amountPaidCents: 0,
      packPurchaseId: rafaelPurchase.id,
    },
    {
      professionalId: pro.id,
      eventTypeId: experimental.id,
      customerId: thomas.id,
      startAt: t1.start,
      endAt: t1.end,
      status: "confirmed",
      paymentType: "direct",
      amountPaidCents: 1500,
      stripeSessionId: "cs_test_seed_thomas",
      customerNotes: "Jamais joué, mais super curieux d'essayer !",
    },
    {
      professionalId: pro.id,
      eventTypeId: individual.id,
      customerId: marina.id,
      startAt: m1.start,
      endAt: m1.end,
      status: "confirmed",
      paymentType: "direct",
      amountPaidCents: 3000,
      stripeSessionId: "cs_test_seed_marina",
    },
  ]);

  console.info("\n✅ Seed terminé.\n");
  console.info("Comptes de démonstration :");
  console.info("  • Pro    → pro@skedul.app       / password123");
  console.info("  • Client → beatriz@example.com  / password123");
  console.info("\nPage publique : /altinha-paris");
  console.info("Back-office   : /dashboard\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  });
