import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => nanoid());

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

/* ───────────────────────────── Enums ───────────────────────────── */

export const userRole = pgEnum("user_role", ["client", "pro", "admin"]);
export const bookingStatus = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
]);
export const paymentType = pgEnum("payment_type", ["direct", "credit", "free"]);
export const purchaseStatus = pgEnum("purchase_status", [
  "pending",
  "paid",
  "refunded",
]);
export const questionType = pgEnum("question_type", ["text", "choice", "boolean"]);

/* ──────────────────────── Better Auth tables ───────────────────── */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: userRole("role").default("client").notNull(),
  // Better Auth admin plugin (suspension)
  banned: boolean("banned").default(false).notNull(),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  // stamped on every real sign-in (see databaseHooks in src/lib/auth.ts)
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // Better Auth admin plugin: id of the admin behind an impersonation session
    impersonatedBy: text("impersonated_by"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* ─────────────────────────── Domain tables ─────────────────────── */

/** A professional's public business profile (one per pro user). */
export const professional = pgTable(
  "professional",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    businessName: text("business_name").notNull(),
    headline: text("headline"),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    avatarKind: text("avatar_kind"),
    avatarStyle: text("avatar_style"),
    avatarSeed: text("avatar_seed"),
    bannerUrl: text("banner_url"),
    brandColor: text("brand_color").default("#6366f1").notNull(),
    themePreset: text("theme_preset").default("violet").notNull(),
    customColor: text("custom_color"),
    headerLayout: text("header_layout").default("profil").notNull(),
    timezone: text("timezone").default("Europe/Paris").notNull(),
    currency: text("currency").default("eur").notNull(),
    stripeAccountId: text("stripe_account_id"),
    googleCalendarId: text("google_calendar_id"),
    ...timestamps,
  },
  (t) => [index("professional_slug_idx").on(t.slug)],
);

/** A bookable service / slot type (e.g. "Coaching 1h"). */
export const eventType = pgTable(
  "event_type",
  {
    id: id(),
    professionalId: text("professional_id")
      .notNull()
      .references(() => professional.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    durationMinutes: integer("duration_minutes").default(30).notNull(),
    priceCents: integer("price_cents").default(0).notNull(),
    capacity: integer("capacity").default(1).notNull(),
    color: text("color").default("#6366f1").notNull(),
    bufferBeforeMinutes: integer("buffer_before_minutes").default(0).notNull(),
    bufferAfterMinutes: integer("buffer_after_minutes").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    ...timestamps,
  },
  (t) => [
    unique("event_type_pro_slug_unique").on(t.professionalId, t.slug),
    index("event_type_pro_idx").on(t.professionalId),
  ],
);

/** A materialised class session: the seat-counter that makes group capacity atomic. */
export const classSession = pgTable(
  "class_session",
  {
    id: id(),
    professionalId: text("professional_id")
      .notNull()
      .references(() => professional.id, { onDelete: "cascade" }),
    eventTypeId: text("event_type_id")
      .notNull()
      .references(() => eventType.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    seatsRemaining: integer("seats_remaining").notNull(),
    googleEventId: text("google_event_id"),
    ...timestamps,
  },
  (t) => [
    unique("session_event_start_unique").on(t.eventTypeId, t.startAt),
    index("session_pro_start_idx").on(t.professionalId, t.startAt),
  ],
);

/** Recurring weekly availability for a professional. */
export const availabilityRule = pgTable(
  "availability_rule",
  {
    id: id(),
    professionalId: text("professional_id")
      .notNull()
      .references(() => professional.id, { onDelete: "cascade" }),
    // null = pro's global schedule; set = override schedule for this event type
    eventTypeId: text("event_type_id").references(() => eventType.id, {
      onDelete: "cascade",
    }),
    // 0 = Sunday … 6 = Saturday
    dayOfWeek: integer("day_of_week").notNull(),
    // minutes from midnight (e.g. 540 = 09:00, 1020 = 17:00)
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    ...timestamps,
  },
  (t) => [
    index("availability_pro_idx").on(t.professionalId),
    index("availability_event_type_idx").on(t.eventTypeId),
  ],
);

/** A prepaid pack of credits sold by a professional. */
export const pack = pgTable(
  "pack",
  {
    id: id(),
    professionalId: text("professional_id")
      .notNull()
      .references(() => professional.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // number of bookings (credits) granted by the pack
    credits: integer("credits").notNull(),
    priceCents: integer("price_cents").notNull(),
    // optional: credits only valid for this event type (null = any)
    eventTypeId: text("event_type_id").references(() => eventType.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").default(true).notNull(),
    ...timestamps,
  },
  (t) => [index("pack_pro_idx").on(t.professionalId)],
);

/** A customer of a professional (may be linked to an auth user). */
export const customer = pgTable(
  "customer",
  {
    id: id(),
    professionalId: text("professional_id")
      .notNull()
      .references(() => professional.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    ...timestamps,
  },
  (t) => [
    unique("customer_pro_email_unique").on(t.professionalId, t.email),
    index("customer_pro_idx").on(t.professionalId),
  ],
);

/** A purchased pack with its remaining credit balance. */
export const packPurchase = pgTable(
  "pack_purchase",
  {
    id: id(),
    packId: text("pack_id")
      .notNull()
      .references(() => pack.id, { onDelete: "restrict" }),
    professionalId: text("professional_id")
      .notNull()
      .references(() => professional.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    creditsTotal: integer("credits_total").notNull(),
    creditsRemaining: integer("credits_remaining").notNull(),
    amountPaidCents: integer("amount_paid_cents").notNull(),
    currency: text("currency").default("eur").notNull(),
    status: purchaseStatus("status").default("pending").notNull(),
    stripeSessionId: text("stripe_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    ...timestamps,
  },
  (t) => [
    index("pack_purchase_customer_idx").on(t.customerId),
    index("pack_purchase_pro_idx").on(t.professionalId),
  ],
);

/** A booked appointment. */
export const booking = pgTable(
  "booking",
  {
    id: id(),
    professionalId: text("professional_id")
      .notNull()
      .references(() => professional.id, { onDelete: "cascade" }),
    eventTypeId: text("event_type_id")
      .notNull()
      .references(() => eventType.id, { onDelete: "restrict" }),
    sessionId: text("session_id").references(() => classSession.id, {
      onDelete: "restrict",
    }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    status: bookingStatus("status").default("pending").notNull(),
    paymentType: paymentType("payment_type").default("direct").notNull(),
    amountPaidCents: integer("amount_paid_cents"),
    // set when paid with a pack credit
    packPurchaseId: text("pack_purchase_id").references(
      () => packPurchase.id,
      { onDelete: "set null" },
    ),
    stripeSessionId: text("stripe_session_id"),
    customerNotes: text("customer_notes"),
    ...timestamps,
  },
  (t) => [
    index("booking_pro_idx").on(t.professionalId),
    index("booking_customer_idx").on(t.customerId),
    index("booking_start_idx").on(t.startAt),
  ],
);

/** A one-off block of unavailability (time off) for a professional. */
export const timeOff = pgTable(
  "time_off",
  {
    id: id(),
    professionalId: text("professional_id")
      .notNull()
      .references(() => professional.id, { onDelete: "cascade" }),
    // instant range; endAt is an EXCLUSIVE bound
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").default(true).notNull(),
    reason: text("reason"),
    ...timestamps,
  },
  (t) => [index("time_off_pro_idx").on(t.professionalId, t.startAt)],
);

/** A custom registration question attached to an event type. */
export const question = pgTable(
  "question",
  {
    id: id(),
    eventTypeId: text("event_type_id")
      .notNull()
      .references(() => eventType.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    type: questionType("type").notNull(),
    options: text("options").array(),
    required: boolean("required").default(false).notNull(),
    position: integer("position").default(0).notNull(),
    ...timestamps,
  },
  (t) => [index("question_event_type_idx").on(t.eventTypeId)],
);

/** A customer's answer to a question, snapshotted onto the booking. */
export const bookingAnswer = pgTable(
  "booking_answer",
  {
    id: id(),
    bookingId: text("booking_id")
      .notNull()
      .references(() => booking.id, { onDelete: "cascade" }),
    questionId: text("question_id").references(() => question.id, {
      onDelete: "set null",
    }),
    questionLabel: text("question_label").notNull(),
    value: text("value").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("booking_answer_unique").on(t.bookingId, t.questionId),
    index("booking_answer_booking_idx").on(t.bookingId),
  ],
);

/** One public page view from the cookieless tracker (see src/app/api/track). Immutable. */
export const pageView = pgTable(
  "page_view",
  {
    id: id(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    path: text("path").notNull(),
    // resolved from the slug at visit time, so it survives a slug change
    professionalId: text("professional_id").references(() => professional.id, {
      onDelete: "set null",
    }),
    referrerHost: text("referrer_host"),
    source: text("source"),
    // first view of a visit (external or no referrer)
    entry: boolean("entry").default(false).notNull(),
    device: text("device").notNull(),
    country: text("country"),
    // daily-rotating anonymous hash — the IP is never stored
    visitorHash: text("visitor_hash").notNull(),
  },
  (t) => [
    index("page_view_created_idx").on(t.createdAt),
    index("page_view_pro_created_idx").on(t.professionalId, t.createdAt),
  ],
);

/* ───────────────────────────── Relations ───────────────────────── */

export const userRelations = relations(user, ({ one }) => ({
  professional: one(professional, {
    fields: [user.id],
    references: [professional.userId],
  }),
}));

export const professionalRelations = relations(professional, ({ one, many }) => ({
  user: one(user, { fields: [professional.userId], references: [user.id] }),
  eventTypes: many(eventType),
  availability: many(availabilityRule),
  packs: many(pack),
  customers: many(customer),
  bookings: many(booking),
  timeOff: many(timeOff),
  sessions: many(classSession),
}));

export const eventTypeRelations = relations(eventType, ({ one, many }) => ({
  professional: one(professional, {
    fields: [eventType.professionalId],
    references: [professional.id],
  }),
  bookings: many(booking),
  availabilityRules: many(availabilityRule),
  sessions: many(classSession),
  questions: many(question),
}));

export const availabilityRuleRelations = relations(
  availabilityRule,
  ({ one }) => ({
    professional: one(professional, {
      fields: [availabilityRule.professionalId],
      references: [professional.id],
    }),
    eventType: one(eventType, {
      fields: [availabilityRule.eventTypeId],
      references: [eventType.id],
    }),
  }),
);

export const packRelations = relations(pack, ({ one, many }) => ({
  professional: one(professional, {
    fields: [pack.professionalId],
    references: [professional.id],
  }),
  eventType: one(eventType, {
    fields: [pack.eventTypeId],
    references: [eventType.id],
  }),
  purchases: many(packPurchase),
}));

export const customerRelations = relations(customer, ({ one, many }) => ({
  professional: one(professional, {
    fields: [customer.professionalId],
    references: [professional.id],
  }),
  user: one(user, { fields: [customer.userId], references: [user.id] }),
  purchases: many(packPurchase),
  bookings: many(booking),
}));

export const packPurchaseRelations = relations(packPurchase, ({ one, many }) => ({
  pack: one(pack, { fields: [packPurchase.packId], references: [pack.id] }),
  professional: one(professional, {
    fields: [packPurchase.professionalId],
    references: [professional.id],
  }),
  customer: one(customer, {
    fields: [packPurchase.customerId],
    references: [customer.id],
  }),
  bookings: many(booking),
}));

export const bookingRelations = relations(booking, ({ one }) => ({
  professional: one(professional, {
    fields: [booking.professionalId],
    references: [professional.id],
  }),
  eventType: one(eventType, {
    fields: [booking.eventTypeId],
    references: [eventType.id],
  }),
  customer: one(customer, {
    fields: [booking.customerId],
    references: [customer.id],
  }),
  packPurchase: one(packPurchase, {
    fields: [booking.packPurchaseId],
    references: [packPurchase.id],
  }),
  session: one(classSession, {
    fields: [booking.sessionId],
    references: [classSession.id],
  }),
}));

export const timeOffRelations = relations(timeOff, ({ one }) => ({
  professional: one(professional, {
    fields: [timeOff.professionalId],
    references: [professional.id],
  }),
}));

export const classSessionRelations = relations(classSession, ({ one, many }) => ({
  professional: one(professional, {
    fields: [classSession.professionalId],
    references: [professional.id],
  }),
  eventType: one(eventType, {
    fields: [classSession.eventTypeId],
    references: [eventType.id],
  }),
  bookings: many(booking),
}));

export const questionRelations = relations(question, ({ one, many }) => ({
  eventType: one(eventType, {
    fields: [question.eventTypeId],
    references: [eventType.id],
  }),
  answers: many(bookingAnswer),
}));

export const bookingAnswerRelations = relations(bookingAnswer, ({ one }) => ({
  booking: one(booking, {
    fields: [bookingAnswer.bookingId],
    references: [booking.id],
  }),
  question: one(question, {
    fields: [bookingAnswer.questionId],
    references: [question.id],
  }),
}));
