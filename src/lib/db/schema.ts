import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
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
export const questionType = pgEnum("question_type", ["text", "choice", "boolean"]);
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
    ...timestamps,
  },
  (t) => [index("professional_slug_idx").on(t.slug)],
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
}));

export const timeOffRelations = relations(timeOff, ({ one }) => ({
  professional: one(professional, {
    fields: [timeOff.professionalId],
    references: [professional.id],
  }),
}));
