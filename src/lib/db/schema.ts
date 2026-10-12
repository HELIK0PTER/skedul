import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import {
  SUPPORT_AUTHOR_ROLES,
  SUPPORT_MESSAGE_KINDS,
  SUPPORT_RESOLUTIONS,
  SUPPORT_STAGES,
  SUPPORT_TRACKS,
  SUPPORT_TYPES,
} from "../support";
import {
  ACTORS,
  BOOKING_COVERAGES,
  BOOKING_MODES,
  BOOKING_STATUSES,
  DEFAULT_COLOR,
  MONTHLY_BY,
  MOVEMENT_KINDS,
  OCCURRENCE_STATUSES,
  PURCHASE_STATUSES,
  QUESTION_TYPES,
  RECURRENCE_ENDS,
  RECURRENCE_FREQS,
  TICKET_CLOSE_REASONS,
  TICKET_STATUSES,
  VALIDITY_UNITS,
} from "../tickets";

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
export const questionType = pgEnum("question_type", QUESTION_TYPES);
export const bookingMode = pgEnum("booking_mode", BOOKING_MODES);
export const recurrenceFreq = pgEnum("recurrence_freq", RECURRENCE_FREQS);
export const monthlyBy = pgEnum("monthly_by", MONTHLY_BY);
export const recurrenceEnd = pgEnum("recurrence_end", RECURRENCE_ENDS);
export const validityUnit = pgEnum("validity_unit", VALIDITY_UNITS);
export const occurrenceStatus = pgEnum("occurrence_status", OCCURRENCE_STATUSES);
export const bookingStatus = pgEnum("booking_status", BOOKING_STATUSES);
export const bookingCoverage = pgEnum("booking_coverage", BOOKING_COVERAGES);
export const actor = pgEnum("actor", ACTORS);
export const purchaseStatus = pgEnum("purchase_status", PURCHASE_STATUSES);
export const ticketStatus = pgEnum("ticket_status", TICKET_STATUSES);
export const ticketCloseReason = pgEnum("ticket_close_reason", TICKET_CLOSE_REASONS);
export const movementKind = pgEnum("movement_kind", MOVEMENT_KINDS);
export const supportType = pgEnum("support_type", SUPPORT_TYPES);
export const supportTrack = pgEnum("support_track", SUPPORT_TRACKS);
export const supportStage = pgEnum("support_stage", SUPPORT_STAGES);
export const supportResolution = pgEnum("support_resolution", SUPPORT_RESOLUTIONS);
export const supportAuthorRole = pgEnum("support_author_role", SUPPORT_AUTHOR_ROLES);
export const supportMessageKind = pgEnum("support_message_kind", SUPPORT_MESSAGE_KINDS);

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
    // booking settings (spec § 2.13); events and RDV types may override each
    bookingHorizonDays: integer("booking_horizon_days").default(60).notNull(),
    minNoticeMinutes: integer("min_notice_minutes").default(60).notNull(),
    cancelDeadlineHours: integer("cancel_deadline_hours").default(24).notNull(),
    ...timestamps,
  },
  (t) => [
    index("professional_slug_idx").on(t.slug),
    check("professional_horizon_chk", sql`booking_horizon_days BETWEEN 1 AND 365`),
    check("professional_notice_chk", sql`min_notice_minutes BETWEEN 0 AND 10080`),
    check("professional_cancel_chk", sql`cancel_deadline_hours BETWEEN 0 AND 720`),
  ],
);

/** `professional_id → professional ON DELETE CASCADE`, on every domain table (R2). */
const proRef = () =>
  text("professional_id")
    .notNull()
    .references(() => professional.id, { onDelete: "cascade" });

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

/* ─────────────────────── Tickets & événements ─────────────────────
 * Spec § 6. FK rules: every table cascades DIRECTLY from professional (R2,
 * required for deleteUser); references inside the domain are NO ACTION (R3,
 * drizzle's default) except parent → child compositions, which cascade;
 * references to user and booking_answer → question are SET NULL (R4).
 * Every CHECK is named: mapDbError (src/lib/db/map-db-error.ts) reads names.
 * CHECK bodies are literal SQL (no ${} params) so drizzle-kit writes them as-is.
 */

/** What an event accepts; may be bookable as an RDV libre. */
export const ticketType = pgTable(
  "ticket_type",
  {
    id: id(),
    professionalId: proRef(),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color").default(DEFAULT_COLOR).notNull(),
    position: integer("position").default(0).notNull(),
    rdvEnabled: boolean("rdv_enabled").default(false).notNull(),
    rdvFree: boolean("rdv_free").default(false).notNull(),
    rdvDurationMin: integer("rdv_duration_min"),
    rdvBufferBeforeMin: integer("rdv_buffer_before_min").default(0).notNull(),
    rdvBufferAfterMin: integer("rdv_buffer_after_min").default(0).notNull(),
    rdvBookingHorizonDays: integer("rdv_booking_horizon_days"),
    rdvMinNoticeMinutes: integer("rdv_min_notice_minutes"),
    rdvCancelDeadlineHours: integer("rdv_cancel_deadline_hours"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("ticket_type_pro_idx").on(t.professionalId),
    check(
      "ticket_type_rdv_chk",
      sql`NOT rdv_enabled OR (rdv_duration_min IS NOT NULL AND rdv_duration_min BETWEEN 5 AND 480 AND rdv_duration_min % 5 = 0)`,
    ),
    check("ticket_type_rdv_free_chk", sql`NOT rdv_free OR rdv_enabled`),
    check(
      "ticket_type_buffers_chk",
      sql`rdv_buffer_before_min BETWEEN 0 AND 240 AND rdv_buffer_after_min BETWEEN 0 AND 240`,
    ),
    check(
      "ticket_type_overrides_chk",
      sql`(rdv_booking_horizon_days IS NULL OR rdv_booking_horizon_days BETWEEN 1 AND 365) AND (rdv_min_notice_minutes IS NULL OR rdv_min_notice_minutes BETWEEN 0 AND 10080) AND (rdv_cancel_deadline_hours IS NULL OR rdv_cancel_deadline_hours BETWEEN 0 AND 720)`,
    ),
  ],
);

/** N tickets of one type for a price (« À l'unité », « Carnet de 10 »). */
export const ticketOffer = pgTable(
  "ticket_offer",
  {
    id: id(),
    professionalId: proRef(),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketType.id, { onDelete: "cascade" }),
    label: text("label"),
    quantity: integer("quantity").notNull(),
    priceCents: integer("price_cents").notNull(),
    validityCount: integer("validity_count"),
    validityUnit: validityUnit("validity_unit"),
    isActive: boolean("is_active").default(true).notNull(),
    position: integer("position").default(0).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("ticket_offer_pro_idx").on(t.professionalId),
    index("ticket_offer_type_idx").on(t.ticketTypeId),
    check("ticket_offer_quantity_chk", sql`quantity BETWEEN 1 AND 100`),
    check("ticket_offer_price_chk", sql`price_cents > 0`),
    check("ticket_offer_validity_chk", sql`(validity_count IS NULL) = (validity_unit IS NULL)`),
    check(
      "ticket_offer_validity_count_chk",
      sql`validity_count IS NULL OR validity_count BETWEEN 1 AND 1000`,
    ),
  ],
);

/** Weekly hours for RDV libre: global (ticket_type_id NULL) or per type (replaces the global ones). */
export const availabilityRule = pgTable(
  "availability_rule",
  {
    id: id(),
    professionalId: proRef(),
    ticketTypeId: text("ticket_type_id").references(() => ticketType.id, {
      onDelete: "cascade",
    }),
    // 0 = Sunday … 6 = Saturday
    dayOfWeek: integer("day_of_week").notNull(),
    // minutes from local midnight; endMinute is exclusive (1440 = midnight)
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    ...timestamps,
  },
  (t) => [
    index("availability_pro_idx").on(t.professionalId),
    index("availability_ticket_type_idx").on(t.ticketTypeId),
    check("availability_rule_dow_chk", sql`day_of_week BETWEEN 0 AND 6`),
    check(
      "availability_rule_range_chk",
      sql`start_minute >= 0 AND start_minute < end_minute AND end_minute <= 1440`,
    ),
  ],
);

/**
 * A series (one-off or recurring) with its booking mode and accepted types.
 * A « cette séance et les suivantes » edit ends a segment (until_date = d − 1)
 * and starts a new one with the same series_root_id.
 */
export const event = pgTable(
  "event",
  {
    id: id(),
    professionalId: proRef(),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    color: text("color").default(DEFAULT_COLOR).notNull(),
    bookingMode: bookingMode("booking_mode").default("tickets").notNull(),
    isPrivate: boolean("is_private").default(false).notNull(),
    capacity: integer("capacity").notNull(),
    durationMin: integer("duration_min").notNull(),
    // recurrence (spec § 8); dates are local calendar dates in the pro's tz
    startDate: date("start_date", { mode: "string" }).notNull(),
    startMinute: integer("start_minute").notNull(),
    freq: recurrenceFreq("freq").notNull(),
    interval: smallint("interval").default(1).notNull(),
    weekdays: smallint("weekdays").array(),
    monthlyBy: monthlyBy("monthly_by"),
    monthWeek: smallint("month_week"),
    endMode: recurrenceEnd("end_mode").notNull(),
    untilDate: date("until_date", { mode: "string" }),
    occurrenceCount: integer("occurrence_count"),
    // NULL = the pro's setting
    bookingHorizonDays: integer("booking_horizon_days"),
    minNoticeMinutes: integer("min_notice_minutes"),
    cancelDeadlineHours: integer("cancel_deadline_hours"),
    // occurrences exist for every rule date ≤ generated_until
    generatedUntil: date("generated_until", { mode: "string" }).notNull(),
    // lineage, no FK; the engine always sets it (= id on the first segment)
    seriesRootId: text("series_root_id"),
    version: integer("version").default(1).notNull(),
    lastActionId: text("last_action_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("event_pro_idx").on(t.professionalId),
    index("event_series_root_idx").on(t.seriesRootId),
    check("event_capacity_chk", sql`capacity BETWEEN 1 AND 500`),
    check("event_duration_chk", sql`duration_min BETWEEN 5 AND 720 AND duration_min % 5 = 0`),
    check("event_start_minute_chk", sql`start_minute BETWEEN 0 AND 1439`),
    check(
      "event_once_chk",
      sql`freq <> 'once' OR ("interval" = 1 AND end_mode = 'count' AND occurrence_count IS NOT NULL AND occurrence_count = 1 AND weekdays IS NULL AND monthly_by IS NULL AND month_week IS NULL AND until_date IS NULL)`,
    ),
    check(
      "event_daily_chk",
      sql`freq <> 'daily' OR ("interval" BETWEEN 1 AND 31 AND weekdays IS NULL AND monthly_by IS NULL AND month_week IS NULL)`,
    ),
    check(
      "event_weekly_chk",
      sql`freq <> 'weekly' OR ("interval" BETWEEN 1 AND 52 AND weekdays IS NOT NULL AND cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ '{0,1,2,3,4,5,6}'::smallint[] AND monthly_by IS NULL AND month_week IS NULL)`,
    ),
    check(
      "event_monthly_chk",
      sql`freq <> 'monthly' OR ("interval" BETWEEN 1 AND 12 AND weekdays IS NULL AND monthly_by IS NOT NULL AND ((monthly_by = 'day_of_month' AND month_week IS NULL) OR (monthly_by = 'weekday' AND month_week IS NOT NULL AND month_week IN (1, 2, 3, 4, -1))))`,
    ),
    check(
      "event_end_never_chk",
      sql`end_mode <> 'never' OR (until_date IS NULL AND occurrence_count IS NULL)`,
    ),
    check(
      "event_end_until_chk",
      sql`end_mode <> 'until' OR (until_date IS NOT NULL AND occurrence_count IS NULL AND until_date >= start_date)`,
    ),
    check(
      "event_end_count_chk",
      sql`end_mode <> 'count' OR (occurrence_count IS NOT NULL AND occurrence_count BETWEEN 1 AND 730 AND until_date IS NULL)`,
    ),
    check(
      "event_overrides_chk",
      sql`(booking_horizon_days IS NULL OR booking_horizon_days BETWEEN 1 AND 365) AND (min_notice_minutes IS NULL OR min_notice_minutes BETWEEN 0 AND 10080) AND (cancel_deadline_hours IS NULL OR cancel_deadline_hours BETWEEN 0 AND 720)`,
    ),
  ],
);

/** The ticket types an event in `tickets` mode accepts (read live; empty = nobody). */
export const eventTicketType = pgTable(
  "event_ticket_type",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketType.id, { onDelete: "cascade" }),
    professionalId: proRef(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ name: "event_ticket_type_pk", columns: [t.eventId, t.ticketTypeId] }),
    index("event_ticket_type_type_idx").on(t.ticketTypeId),
    index("event_ticket_type_pro_idx").on(t.professionalId),
  ],
);

/** A registration question, on an event or on an RDV ticket type. */
export const question = pgTable(
  "question",
  {
    id: id(),
    professionalId: proRef(),
    eventId: text("event_id").references(() => event.id, { onDelete: "cascade" }),
    ticketTypeId: text("ticket_type_id").references(() => ticketType.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    type: questionType("type").notNull(),
    options: text("options").array(),
    required: boolean("required").default(false).notNull(),
    position: integer("position").default(0).notNull(),
    ...timestamps,
  },
  (t) => [
    index("question_pro_idx").on(t.professionalId),
    index("question_event_idx").on(t.eventId),
    index("question_ticket_type_idx").on(t.ticketTypeId),
    check("question_owner_chk", sql`num_nonnulls(event_id, ticket_type_id) = 1`),
  ],
);

/**
 * A séance of an event (event_id set, one per series_date) or a booked RDV
 * libre (event_id NULL, ticket_type_id set, capacity 1). Owns the seat counter.
 * EXCLUDE occurrence_rdv_excl lives in migration 0012 (drizzle-kit cannot express it).
 */
export const occurrence = pgTable(
  "occurrence",
  {
    id: id(),
    professionalId: proRef(),
    eventId: text("event_id").references(() => event.id, { onDelete: "cascade" }),
    ticketTypeId: text("ticket_type_id").references(() => ticketType.id),
    seriesDate: date("series_date", { mode: "string" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // RDV: widened by the type's buffers; event séance: equal to starts/ends
    blockStart: timestamp("block_start", { withTimezone: true }).notNull(),
    blockEnd: timestamp("block_end", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    seatsTaken: integer("seats_taken").default(0).notNull(),
    status: occurrenceStatus("status").default("scheduled").notNull(),
    locationOverride: text("location_override"),
    timeDetached: boolean("time_detached").default(false).notNull(),
    capacityOverride: boolean("capacity_override").default(false).notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    googleEventId: text("google_event_id"),
    ...timestamps,
  },
  (t) => [
    unique("occurrence_event_series_uq").on(t.eventId, t.seriesDate),
    index("occurrence_pro_starts_idx").on(t.professionalId, t.startsAt),
    index("occurrence_ticket_type_idx").on(t.ticketTypeId),
    check("occurrence_kind_chk", sql`num_nonnulls(event_id, ticket_type_id) = 1`),
    check("occurrence_series_date_chk", sql`(event_id IS NULL) = (series_date IS NULL)`),
    check("occurrence_seats_chk", sql`seats_taken BETWEEN 0 AND capacity`),
    check("occurrence_capacity_chk", sql`capacity BETWEEN 1 AND 500`),
    check("occurrence_rdv_capacity_chk", sql`event_id IS NOT NULL OR capacity = 1`),
    check(
      "occurrence_time_chk",
      sql`ends_at > starts_at AND block_start <= starts_at AND block_end >= ends_at`,
    ),
    check(
      "occurrence_cancelled_chk",
      sql`(status = 'cancelled') = (cancelled_at IS NOT NULL)`,
    ),
  ],
);

/** A client of one pro, keyed by e-mail; may be linked to a verified account. */
export const customer = pgTable(
  "customer",
  {
    id: id(),
    professionalId: proRef(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    // bumping it revokes every personal link (/api/c/<token>)
    linkVersion: integer("link_version").default(1).notNull(),
    ...timestamps,
  },
  (t) => [
    unique("customer_pro_email_uq").on(t.professionalId, t.email),
    index("customer_user_idx").on(t.userId),
    index("customer_email_idx").on(t.email),
    check("customer_email_chk", sql`email = lower(email) AND email <> ''`),
  ],
);

/** One checkout: the ONLY row that carries money (snapshot of the offer). */
export const ticketPurchase = pgTable(
  "ticket_purchase",
  {
    id: id(),
    professionalId: proRef(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    offerId: text("offer_id")
      .notNull()
      .references(() => ticketOffer.id),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketType.id),
    label: text("label").notNull(),
    quantity: integer("quantity").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    validityCount: integer("validity_count"),
    validityUnit: validityUnit("validity_unit"),
    status: purchaseStatus("status").default("pending").notNull(),
    livemode: boolean("livemode").default(false).notNull(),
    checkoutSessionId: text("checkout_session_id"),
    checkoutUrl: text("checkout_url"),
    checkoutExpiresAt: timestamp("checkout_expires_at", { withTimezone: true }).notNull(),
    processingAt: timestamp("processing_at", { withTimezone: true }),
    paymentIntentId: text("payment_intent_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    fulfilledActionId: text("fulfilled_action_id"),
    ...timestamps,
  },
  (t) => [
    unique("ticket_purchase_checkout_session_uq").on(t.checkoutSessionId),
    index("ticket_purchase_pro_status_paid_idx").on(t.professionalId, t.status, t.paidAt),
    index("ticket_purchase_customer_idx").on(t.customerId),
    index("ticket_purchase_status_expires_idx").on(t.status, t.checkoutExpiresAt),
    check("ticket_purchase_quantity_chk", sql`quantity BETWEEN 1 AND 100`),
    check("ticket_purchase_amount_chk", sql`amount_cents > 0`),
    check("ticket_purchase_paid_chk", sql`(status = 'paid') = (paid_at IS NOT NULL)`),
  ],
);

/** 1 client = 1 seat = at most 1 ticket, on a séance or an RDV. */
export const booking = pgTable(
  "booking",
  {
    id: id(),
    professionalId: proRef(),
    occurrenceId: text("occurrence_id")
      .notNull()
      .references(() => occurrence.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    status: bookingStatus("status").notNull(),
    coverage: bookingCoverage("coverage").notNull(),
    // buy + book: the purchase paying for this seat
    purchaseId: text("purchase_id").references(() => ticketPurchase.id),
    createdBy: actor("created_by").notNull(),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    movedAt: timestamp("moved_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: actor("ended_by"),
    endedActionId: text("ended_action_id"),
    cancelReason: text("cancel_reason"),
    customerNotes: text("customer_notes"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("booking_active_uq")
      .on(t.occurrenceId, t.customerId)
      .where(sql`status IN ('pending', 'confirmed')`),
    unique("booking_purchase_uq").on(t.purchaseId),
    index("booking_occurrence_status_idx").on(t.occurrenceId, t.status),
    index("booking_customer_idx").on(t.customerId),
    index("booking_ended_action_idx").on(t.endedActionId),
    index("booking_hold_idx").on(t.holdExpiresAt).where(sql`status = 'pending'`),
    check(
      "booking_pending_chk",
      sql`status <> 'pending' OR (hold_expires_at IS NOT NULL AND purchase_id IS NOT NULL)`,
    ),
    check("booking_free_chk", sql`coverage <> 'free' OR purchase_id IS NULL`),
    check(
      "booking_ended_chk",
      sql`(status IN ('cancelled', 'expired')) = (ended_at IS NOT NULL)`,
    ),
  ],
);

/** An answer to a question, snapshotted (question_label) onto the booking. */
export const bookingAnswer = pgTable(
  "booking_answer",
  {
    id: id(),
    professionalId: proRef(),
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
    unique("booking_answer_uq").on(t.bookingId, t.questionId),
    index("booking_answer_booking_idx").on(t.bookingId),
  ],
);

/** One ticket held by a client. The balance is a count(*): nothing can drift. */
export const ticket = pgTable(
  "ticket",
  {
    id: id(),
    professionalId: proRef(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketType.id),
    // NULL = offered by the pro
    purchaseId: text("purchase_id").references(() => ticketPurchase.id),
    status: ticketStatus("status").notNull(),
    bookingId: text("booking_id").references(() => booking.id),
    // first instant the ticket is no longer valid (local midnight after its last day)
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    closedReason: ticketCloseReason("closed_reason"),
    closedNote: text("closed_note"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (t) => [
    unique("ticket_booking_uq").on(t.bookingId),
    index("ticket_customer_status_type_idx").on(t.customerId, t.status, t.ticketTypeId),
    index("ticket_by_purchase_idx").on(t.purchaseId),
    index("ticket_by_type_idx").on(t.ticketTypeId),
    index("ticket_expires_idx").on(t.expiresAt).where(sql`status = 'available'`),
    check("ticket_booked_chk", sql`(status = 'booked') = (booking_id IS NOT NULL)`),
    check("ticket_closed_chk", sql`(status = 'closed') = (closed_reason IS NOT NULL)`),
    check(
      "ticket_retire_paid_chk",
      sql`closed_reason IS DISTINCT FROM 'retire' OR purchase_id IS NULL`,
    ),
  ],
);

/**
 * Append-only ledger (convention, checked by invariant I4; no trigger). Order
 * by `seq`, never created_at. Rows are inserted by set-based CTEs, so `id`
 * has a database default.
 */
export const ticketMovement = pgTable(
  "ticket_movement",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    professionalId: proRef(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => ticket.id),
    actionId: text("action_id").notNull(),
    kind: movementKind("kind").notNull(),
    fromStatus: ticketStatus("from_status"),
    toStatus: ticketStatus("to_status").notNull(),
    ticketTypeId: text("ticket_type_id")
      .notNull()
      .references(() => ticketType.id),
    fromTicketTypeId: text("from_ticket_type_id").references(() => ticketType.id),
    bookingId: text("booking_id").references(() => booking.id),
    purchaseId: text("purchase_id").references(() => ticketPurchase.id),
    actor: actor("actor").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("ticket_movement_action_ticket_uq").on(t.actionId, t.ticketId),
    index("ticket_movement_customer_seq_idx").on(t.customerId, t.seq),
    index("ticket_movement_ticket_seq_idx").on(t.ticketId, t.seq),
    index("ticket_movement_action_idx").on(t.actionId),
    index("ticket_movement_pro_idx").on(t.professionalId),
  ],
);

/** Application rate limits (src/lib/throttle.ts) and `health:*` counters. No professional_id. */
export const throttle = pgTable("throttle", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  hits: integer("hits").notNull(),
});

/** Better Auth `rateLimit` model (rateLimit.storage = "database"). No professional_id. */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

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
    // HMAC of IP + user agent keyed with the day's random salt (analytics_salt) —
    // the IP is never stored
    visitorHash: text("visitor_hash").notNull(),
  },
  (t) => [
    index("page_view_created_idx").on(t.createdAt),
    index("page_view_pro_created_idx").on(t.professionalId, t.createdAt),
  ],
);

/**
 * One random salt per Paris day for the visitor hash. Rows older than 2 days are
 * deleted, after which that day's hashes can no longer be linked back to an IP.
 */
export const analyticsSalt = pgTable("analytics_salt", {
  day: text("day").primaryKey(), // YYYY-MM-DD in ADMIN_TZ
  salt: text("salt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ─────────────────────────── Help center ──────────────────────── */

export const helpCategory = pgTable("help_category", {
  id: id(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  // one of HELP_ICONS (src/lib/support.ts)
  icon: text("icon").notNull().default("help"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const helpArticle = pgTable(
  "help_article",
  {
    id: id(),
    categoryId: text("category_id")
      .notNull()
      .references(() => helpCategory.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    // plain text: blank line = paragraph, "- " = list item (parseAnswer)
    answer: text("answer").notNull(),
    position: integer("position").notNull().default(0),
    published: boolean("published").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("help_article_category_idx").on(t.categoryId, t.position)],
);

export const supportRequest = pgTable(
  "support_request",
  {
    id: id(),
    // human-facing "#42"
    number: serial("number").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: supportType("type").notNull(),
    subject: text("subject").notNull(),
    track: supportTrack("track").notNull().default("support"),
    // always a step of `track` (TRACK_STEPS)
    stage: supportStage("stage").notNull().default("received"),
    // set = the request ended off-track (declined / closed); the bar freezes on `stage`
    resolution: supportResolution("resolution"),
    // estimated delivery, development track only
    eta: date("eta", { mode: "string" }),
    unreadByUser: boolean("unread_by_user").notNull().default(false),
    unreadByAdmin: boolean("unread_by_admin").notNull().default(true),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("support_request_user_idx").on(t.userId, t.lastActivityAt),
    index("support_request_unread_idx").on(t.unreadByAdmin),
  ],
);

export const supportMessage = pgTable(
  "support_message",
  {
    id: id(),
    requestId: text("request_id")
      .notNull()
      .references(() => supportRequest.id, { onDelete: "cascade" }),
    // NULL once the author's account is deleted (an admin's messages stay)
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    authorRole: supportAuthorRole("author_role").notNull(),
    kind: supportMessageKind("kind").notNull().default("message"),
    body: text("body").notNull().default(""),
    // kind = stage_change: the step reached
    stage: supportStage("stage"),
    // kind = resolution: declined / closed, or NULL when the request was reopened
    resolution: supportResolution("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("support_message_request_idx").on(t.requestId, t.createdAt)],
);

export const supportAttachment = pgTable(
  "support_attachment",
  {
    id: id(),
    messageId: text("message_id")
      .notNull()
      .references(() => supportMessage.id, { onDelete: "cascade" }),
    // private Blob pathname: support/<requesterUserId>/<nanoid>.<ext>
    pathname: text("pathname").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("support_attachment_message_idx").on(t.messageId)],
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
  timeOff: many(timeOff),
  ticketTypes: many(ticketType),
  events: many(event),
  customers: many(customer),
  availability: many(availabilityRule),
}));

export const timeOffRelations = relations(timeOff, ({ one }) => ({
  professional: one(professional, {
    fields: [timeOff.professionalId],
    references: [professional.id],
  }),
}));

export const ticketTypeRelations = relations(ticketType, ({ one, many }) => ({
  professional: one(professional, { fields: [ticketType.professionalId], references: [professional.id] }),
  offers: many(ticketOffer),
  eventLinks: many(eventTicketType),
  questions: many(question),
  availabilityRules: many(availabilityRule),
}));
export const ticketOfferRelations = relations(ticketOffer, ({ one }) => ({
  ticketType: one(ticketType, { fields: [ticketOffer.ticketTypeId], references: [ticketType.id] }),
}));
export const availabilityRuleRelations = relations(availabilityRule, ({ one }) => ({
  professional: one(professional, { fields: [availabilityRule.professionalId], references: [professional.id] }),
  ticketType: one(ticketType, { fields: [availabilityRule.ticketTypeId], references: [ticketType.id] }),
}));
export const eventRelations = relations(event, ({ one, many }) => ({
  professional: one(professional, { fields: [event.professionalId], references: [professional.id] }),
  ticketTypeLinks: many(eventTicketType),
  questions: many(question),
  occurrences: many(occurrence),
}));
export const eventTicketTypeRelations = relations(eventTicketType, ({ one }) => ({
  event: one(event, { fields: [eventTicketType.eventId], references: [event.id] }),
  ticketType: one(ticketType, { fields: [eventTicketType.ticketTypeId], references: [ticketType.id] }),
}));
export const questionRelations = relations(question, ({ one, many }) => ({
  event: one(event, { fields: [question.eventId], references: [event.id] }),
  ticketType: one(ticketType, { fields: [question.ticketTypeId], references: [ticketType.id] }),
  answers: many(bookingAnswer),
}));
export const occurrenceRelations = relations(occurrence, ({ one, many }) => ({
  professional: one(professional, { fields: [occurrence.professionalId], references: [professional.id] }),
  event: one(event, { fields: [occurrence.eventId], references: [event.id] }),
  ticketType: one(ticketType, { fields: [occurrence.ticketTypeId], references: [ticketType.id] }),
  bookings: many(booking),
}));
export const customerRelations = relations(customer, ({ one, many }) => ({
  professional: one(professional, { fields: [customer.professionalId], references: [professional.id] }),
  user: one(user, { fields: [customer.userId], references: [user.id] }),
  bookings: many(booking),
  tickets: many(ticket),
  purchases: many(ticketPurchase),
}));
export const ticketPurchaseRelations = relations(ticketPurchase, ({ one, many }) => ({
  customer: one(customer, { fields: [ticketPurchase.customerId], references: [customer.id] }),
  offer: one(ticketOffer, { fields: [ticketPurchase.offerId], references: [ticketOffer.id] }),
  tickets: many(ticket),
}));
export const bookingRelations = relations(booking, ({ one, many }) => ({
  occurrence: one(occurrence, { fields: [booking.occurrenceId], references: [occurrence.id] }),
  customer: one(customer, { fields: [booking.customerId], references: [customer.id] }),
  purchase: one(ticketPurchase, { fields: [booking.purchaseId], references: [ticketPurchase.id] }),
  answers: many(bookingAnswer),
}));
export const bookingAnswerRelations = relations(bookingAnswer, ({ one }) => ({
  booking: one(booking, { fields: [bookingAnswer.bookingId], references: [booking.id] }),
  question: one(question, { fields: [bookingAnswer.questionId], references: [question.id] }),
}));
export const ticketRelations = relations(ticket, ({ one, many }) => ({
  customer: one(customer, { fields: [ticket.customerId], references: [customer.id] }),
  ticketType: one(ticketType, { fields: [ticket.ticketTypeId], references: [ticketType.id] }),
  purchase: one(ticketPurchase, { fields: [ticket.purchaseId], references: [ticketPurchase.id] }),
  booking: one(booking, { fields: [ticket.bookingId], references: [booking.id] }),
  movements: many(ticketMovement),
}));
export const ticketMovementRelations = relations(ticketMovement, ({ one }) => ({
  ticket: one(ticket, { fields: [ticketMovement.ticketId], references: [ticket.id] }),
}));
