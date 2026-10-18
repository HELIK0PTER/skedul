CREATE TYPE "public"."actor" AS ENUM('client', 'pro', 'system');--> statement-breakpoint
CREATE TYPE "public"."booking_coverage" AS ENUM('ticket', 'free', 'guest');--> statement-breakpoint
CREATE TYPE "public"."booking_mode" AS ENUM('tickets', 'free', 'none');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."monthly_by" AS ENUM('day_of_month', 'weekday');--> statement-breakpoint
CREATE TYPE "public"."movement_kind" AS ENUM('purchase', 'offer', 'spend', 'return', 'pointage', 'unpoint', 'convert', 'expire', 'close');--> statement-breakpoint
CREATE TYPE "public"."occurrence_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('pending', 'paid', 'expired');--> statement-breakpoint
CREATE TYPE "public"."recurrence_end" AS ENUM('never', 'until', 'count');--> statement-breakpoint
CREATE TYPE "public"."recurrence_freq" AS ENUM('once', 'daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."ticket_close_reason" AS ENUM('rembourse', 'compense', 'retire', 'autre');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('available', 'booked', 'used', 'expired', 'closed');--> statement-breakpoint
CREATE TYPE "public"."validity_unit" AS ENUM('day', 'month');--> statement-breakpoint
CREATE TABLE "availability_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"professional_id" text NOT NULL,
	"ticket_type_id" text,
	"day_of_week" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_rule_dow_chk" CHECK (day_of_week BETWEEN 0 AND 6),
	CONSTRAINT "availability_rule_range_chk" CHECK (start_minute >= 0 AND start_minute < end_minute AND end_minute <= 1440)
);
--> statement-breakpoint
CREATE TABLE "booking" (
	"id" text PRIMARY KEY NOT NULL,
	"professional_id" text NOT NULL,
	"occurrence_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"status" "booking_status" NOT NULL,
	"coverage" "booking_coverage" NOT NULL,
	"purchase_id" text,
	"created_by" "actor" NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"moved_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_by" "actor",
	"ended_action_id" text,
	"cancel_reason" text,
	"customer_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_purchase_uq" UNIQUE("purchase_id"),
	CONSTRAINT "booking_pending_chk" CHECK (status <> 'pending' OR (hold_expires_at IS NOT NULL AND purchase_id IS NOT NULL)),
	CONSTRAINT "booking_free_chk" CHECK (coverage <> 'free' OR purchase_id IS NULL),
	CONSTRAINT "booking_ended_chk" CHECK ((status IN ('cancelled', 'expired')) = (ended_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "booking_answer" (
	"id" text PRIMARY KEY NOT NULL,
	"professional_id" text NOT NULL,
	"booking_id" text NOT NULL,
	"question_id" text,
	"question_label" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_answer_uq" UNIQUE("booking_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" text PRIMARY KEY NOT NULL,
	"professional_id" text NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"link_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_pro_email_uq" UNIQUE("professional_id","email"),
	CONSTRAINT "customer_email_chk" CHECK (email = lower(email) AND email <> '')
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" text PRIMARY KEY NOT NULL,
	"professional_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"booking_mode" "booking_mode" DEFAULT 'tickets' NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"capacity" integer NOT NULL,
	"duration_min" integer NOT NULL,
	"start_date" date NOT NULL,
	"start_minute" integer NOT NULL,
	"freq" "recurrence_freq" NOT NULL,
	"interval" smallint DEFAULT 1 NOT NULL,
	"weekdays" smallint[],
	"monthly_by" "monthly_by",
	"month_week" smallint,
	"end_mode" "recurrence_end" NOT NULL,
	"until_date" date,
	"occurrence_count" integer,
	"booking_horizon_days" integer,
	"min_notice_minutes" integer,
	"cancel_deadline_hours" integer,
	"generated_until" date NOT NULL,
	"series_root_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"last_action_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_capacity_chk" CHECK (capacity BETWEEN 1 AND 500),
	CONSTRAINT "event_duration_chk" CHECK (duration_min BETWEEN 5 AND 720 AND duration_min % 5 = 0),
	CONSTRAINT "event_start_minute_chk" CHECK (start_minute BETWEEN 0 AND 1439),
	CONSTRAINT "event_once_chk" CHECK (freq <> 'once' OR ("interval" = 1 AND end_mode = 'count' AND occurrence_count IS NOT NULL AND occurrence_count = 1 AND weekdays IS NULL AND monthly_by IS NULL AND month_week IS NULL AND until_date IS NULL)),
	CONSTRAINT "event_daily_chk" CHECK (freq <> 'daily' OR ("interval" BETWEEN 1 AND 31 AND weekdays IS NULL AND monthly_by IS NULL AND month_week IS NULL)),
	CONSTRAINT "event_weekly_chk" CHECK (freq <> 'weekly' OR ("interval" BETWEEN 1 AND 52 AND weekdays IS NOT NULL AND cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ '{0,1,2,3,4,5,6}'::smallint[] AND monthly_by IS NULL AND month_week IS NULL)),
	CONSTRAINT "event_monthly_chk" CHECK (freq <> 'monthly' OR ("interval" BETWEEN 1 AND 12 AND weekdays IS NULL AND monthly_by IS NOT NULL AND ((monthly_by = 'day_of_month' AND month_week IS NULL) OR (monthly_by = 'weekday' AND month_week IS NOT NULL AND month_week IN (1, 2, 3, 4, -1))))),
	CONSTRAINT "event_end_never_chk" CHECK (end_mode <> 'never' OR (until_date IS NULL AND occurrence_count IS NULL)),
	CONSTRAINT "event_end_until_chk" CHECK (end_mode <> 'until' OR (until_date IS NOT NULL AND occurrence_count IS NULL AND until_date >= start_date)),
	CONSTRAINT "event_end_count_chk" CHECK (end_mode <> 'count' OR (occurrence_count IS NOT NULL AND occurrence_count BETWEEN 1 AND 730 AND until_date IS NULL)),
	CONSTRAINT "event_overrides_chk" CHECK ((booking_horizon_days IS NULL OR booking_horizon_days BETWEEN 1 AND 365) AND (min_notice_minutes IS NULL OR min_notice_minutes BETWEEN 0 AND 10080) AND (cancel_deadline_hours IS NULL OR cancel_deadline_hours BETWEEN 0 AND 720))
);
--> statement-breakpoint
CREATE TABLE "event_ticket_type" (
	"event_id" text NOT NULL,
	"ticket_type_id" text NOT NULL,
	"professional_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_ticket_type_pk" PRIMARY KEY("event_id","ticket_type_id")
);
--> statement-breakpoint
CREATE TABLE "occurrence" (
	"id" text PRIMARY KEY NOT NULL,
	"professional_id" text NOT NULL,
	"event_id" text,
	"ticket_type_id" text,
	"series_date" date,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"block_start" timestamp with time zone NOT NULL,
	"block_end" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"seats_taken" integer DEFAULT 0 NOT NULL,
	"status" "occurrence_status" DEFAULT 'scheduled' NOT NULL,
	"location_override" text,
	"time_detached" boolean DEFAULT false NOT NULL,
	"capacity_override" boolean DEFAULT false NOT NULL,
	"changed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"google_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occurrence_event_series_uq" UNIQUE("event_id","series_date"),
	CONSTRAINT "occurrence_kind_chk" CHECK (num_nonnulls(event_id, ticket_type_id) = 1),
	CONSTRAINT "occurrence_series_date_chk" CHECK ((event_id IS NULL) = (series_date IS NULL)),
	CONSTRAINT "occurrence_seats_chk" CHECK (seats_taken BETWEEN 0 AND capacity),
	CONSTRAINT "occurrence_capacity_chk" CHECK (capacity BETWEEN 1 AND 500),
	CONSTRAINT "occurrence_rdv_capacity_chk" CHECK (event_id IS NOT NULL OR capacity = 1),
	CONSTRAINT "occurrence_time_chk" CHECK (ends_at > starts_at AND block_start <= starts_at AND block_end >= ends_at),
	CONSTRAINT "occurrence_cancelled_chk" CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" text PRIMARY KEY NOT NULL,
	"professional_id" text NOT NULL,
	"event_id" text,
	"ticket_type_id" text,
	"label" text NOT NULL,
	"type" "question_type" NOT NULL,
	"options" text[],
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_owner_chk" CHECK (num_nonnulls(event_id, ticket_type_id) = 1)
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"professional_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"ticket_type_id" text NOT NULL,
	"purchase_id" text,
	"status" "ticket_status" NOT NULL,
	"booking_id" text,
	"expires_at" timestamp with time zone,
	"closed_reason" "ticket_close_reason",
	"closed_note" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_booking_uq" UNIQUE("booking_id"),
	CONSTRAINT "ticket_booked_chk" CHECK ((status = 'booked') = (booking_id IS NOT NULL)),
	CONSTRAINT "ticket_closed_chk" CHECK ((status = 'closed') = (closed_reason IS NOT NULL)),
	CONSTRAINT "ticket_retire_paid_chk" CHECK (closed_reason IS DISTINCT FROM 'retire' OR purchase_id IS NULL)
);
--> statement-breakpoint
CREATE TABLE "ticket_movement" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "ticket_movement_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"professional_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"action_id" text NOT NULL,
	"kind" "movement_kind" NOT NULL,
	"from_status" "ticket_status",
	"to_status" "ticket_status" NOT NULL,
	"ticket_type_id" text NOT NULL,
	"from_ticket_type_id" text,
	"booking_id" text,
	"purchase_id" text,
	"actor" "actor" NOT NULL,
	"actor_user_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_movement_action_ticket_uq" UNIQUE("action_id","ticket_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_offer" (
	"id" text PRIMARY KEY NOT NULL,
	"professional_id" text NOT NULL,
	"ticket_type_id" text NOT NULL,
	"label" text,
	"quantity" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"validity_count" integer,
	"validity_unit" "validity_unit",
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_offer_quantity_chk" CHECK (quantity BETWEEN 1 AND 100),
	CONSTRAINT "ticket_offer_price_chk" CHECK (price_cents > 0),
	CONSTRAINT "ticket_offer_validity_chk" CHECK ((validity_count IS NULL) = (validity_unit IS NULL)),
	CONSTRAINT "ticket_offer_validity_count_chk" CHECK (validity_count IS NULL OR validity_count BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "ticket_purchase" (
	"id" text PRIMARY KEY NOT NULL,
	"professional_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"ticket_type_id" text NOT NULL,
	"label" text NOT NULL,
	"quantity" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"validity_count" integer,
	"validity_unit" "validity_unit",
	"status" "purchase_status" DEFAULT 'pending' NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"checkout_session_id" text,
	"checkout_url" text,
	"checkout_expires_at" timestamp with time zone NOT NULL,
	"processing_at" timestamp with time zone,
	"payment_intent_id" text,
	"paid_at" timestamp with time zone,
	"fulfilled_action_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_purchase_checkout_session_uq" UNIQUE("checkout_session_id"),
	CONSTRAINT "ticket_purchase_quantity_chk" CHECK (quantity BETWEEN 1 AND 100),
	CONSTRAINT "ticket_purchase_amount_chk" CHECK (amount_cents > 0),
	CONSTRAINT "ticket_purchase_paid_chk" CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ticket_type" (
	"id" text PRIMARY KEY NOT NULL,
	"professional_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"rdv_enabled" boolean DEFAULT false NOT NULL,
	"rdv_free" boolean DEFAULT false NOT NULL,
	"rdv_duration_min" integer,
	"rdv_buffer_before_min" integer DEFAULT 0 NOT NULL,
	"rdv_buffer_after_min" integer DEFAULT 0 NOT NULL,
	"rdv_booking_horizon_days" integer,
	"rdv_min_notice_minutes" integer,
	"rdv_cancel_deadline_hours" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_type_rdv_chk" CHECK (NOT rdv_enabled OR (rdv_duration_min IS NOT NULL AND rdv_duration_min BETWEEN 5 AND 480 AND rdv_duration_min % 5 = 0)),
	CONSTRAINT "ticket_type_rdv_free_chk" CHECK (NOT rdv_free OR rdv_enabled),
	CONSTRAINT "ticket_type_buffers_chk" CHECK (rdv_buffer_before_min BETWEEN 0 AND 240 AND rdv_buffer_after_min BETWEEN 0 AND 240),
	CONSTRAINT "ticket_type_overrides_chk" CHECK ((rdv_booking_horizon_days IS NULL OR rdv_booking_horizon_days BETWEEN 1 AND 365) AND (rdv_min_notice_minutes IS NULL OR rdv_min_notice_minutes BETWEEN 0 AND 10080) AND (rdv_cancel_deadline_hours IS NULL OR rdv_cancel_deadline_hours BETWEEN 0 AND 720))
);
--> statement-breakpoint
ALTER TABLE "professional" ADD COLUMN "booking_horizon_days" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "professional" ADD COLUMN "min_notice_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "professional" ADD COLUMN "cancel_deadline_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_rule" ADD CONSTRAINT "availability_rule_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rule" ADD CONSTRAINT "availability_rule_ticket_type_id_ticket_type_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_occurrence_id_occurrence_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."occurrence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_purchase_id_ticket_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."ticket_purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_answer" ADD CONSTRAINT "booking_answer_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_answer" ADD CONSTRAINT "booking_answer_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_answer" ADD CONSTRAINT "booking_answer_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_ticket_type" ADD CONSTRAINT "event_ticket_type_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_ticket_type" ADD CONSTRAINT "event_ticket_type_ticket_type_id_ticket_type_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_ticket_type" ADD CONSTRAINT "event_ticket_type_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence" ADD CONSTRAINT "occurrence_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence" ADD CONSTRAINT "occurrence_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence" ADD CONSTRAINT "occurrence_ticket_type_id_ticket_type_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_ticket_type_id_ticket_type_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_ticket_type_id_ticket_type_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_purchase_id_ticket_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."ticket_purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_movement" ADD CONSTRAINT "ticket_movement_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_movement" ADD CONSTRAINT "ticket_movement_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_movement" ADD CONSTRAINT "ticket_movement_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_movement" ADD CONSTRAINT "ticket_movement_ticket_type_id_ticket_type_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_movement" ADD CONSTRAINT "ticket_movement_from_ticket_type_id_ticket_type_id_fk" FOREIGN KEY ("from_ticket_type_id") REFERENCES "public"."ticket_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_movement" ADD CONSTRAINT "ticket_movement_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_movement" ADD CONSTRAINT "ticket_movement_purchase_id_ticket_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."ticket_purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_movement" ADD CONSTRAINT "ticket_movement_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_offer" ADD CONSTRAINT "ticket_offer_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_offer" ADD CONSTRAINT "ticket_offer_ticket_type_id_ticket_type_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_purchase" ADD CONSTRAINT "ticket_purchase_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_purchase" ADD CONSTRAINT "ticket_purchase_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_purchase" ADD CONSTRAINT "ticket_purchase_offer_id_ticket_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."ticket_offer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_purchase" ADD CONSTRAINT "ticket_purchase_ticket_type_id_ticket_type_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_type" ADD CONSTRAINT "ticket_type_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "availability_pro_idx" ON "availability_rule" USING btree ("professional_id");--> statement-breakpoint
CREATE INDEX "availability_ticket_type_idx" ON "availability_rule" USING btree ("ticket_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_active_uq" ON "booking" USING btree ("occurrence_id","customer_id") WHERE status IN ('pending', 'confirmed');--> statement-breakpoint
CREATE INDEX "booking_occurrence_status_idx" ON "booking" USING btree ("occurrence_id","status");--> statement-breakpoint
CREATE INDEX "booking_customer_idx" ON "booking" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "booking_ended_action_idx" ON "booking" USING btree ("ended_action_id");--> statement-breakpoint
CREATE INDEX "booking_hold_idx" ON "booking" USING btree ("hold_expires_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "booking_answer_booking_idx" ON "booking_answer" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "customer_user_idx" ON "customer" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "customer_email_idx" ON "customer" USING btree ("email");--> statement-breakpoint
CREATE INDEX "event_pro_idx" ON "event" USING btree ("professional_id");--> statement-breakpoint
CREATE INDEX "event_series_root_idx" ON "event" USING btree ("series_root_id");--> statement-breakpoint
CREATE INDEX "event_ticket_type_type_idx" ON "event_ticket_type" USING btree ("ticket_type_id");--> statement-breakpoint
CREATE INDEX "event_ticket_type_pro_idx" ON "event_ticket_type" USING btree ("professional_id");--> statement-breakpoint
CREATE INDEX "occurrence_pro_starts_idx" ON "occurrence" USING btree ("professional_id","starts_at");--> statement-breakpoint
CREATE INDEX "occurrence_ticket_type_idx" ON "occurrence" USING btree ("ticket_type_id");--> statement-breakpoint
CREATE INDEX "question_pro_idx" ON "question" USING btree ("professional_id");--> statement-breakpoint
CREATE INDEX "question_event_idx" ON "question" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "question_ticket_type_idx" ON "question" USING btree ("ticket_type_id");--> statement-breakpoint
CREATE INDEX "ticket_customer_status_type_idx" ON "ticket" USING btree ("customer_id","status","ticket_type_id");--> statement-breakpoint
CREATE INDEX "ticket_by_purchase_idx" ON "ticket" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "ticket_by_type_idx" ON "ticket" USING btree ("ticket_type_id");--> statement-breakpoint
CREATE INDEX "ticket_expires_idx" ON "ticket" USING btree ("expires_at") WHERE status = 'available';--> statement-breakpoint
CREATE INDEX "ticket_movement_customer_seq_idx" ON "ticket_movement" USING btree ("customer_id","seq");--> statement-breakpoint
CREATE INDEX "ticket_movement_ticket_seq_idx" ON "ticket_movement" USING btree ("ticket_id","seq");--> statement-breakpoint
CREATE INDEX "ticket_movement_action_idx" ON "ticket_movement" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "ticket_movement_pro_idx" ON "ticket_movement" USING btree ("professional_id");--> statement-breakpoint
CREATE INDEX "ticket_offer_pro_idx" ON "ticket_offer" USING btree ("professional_id");--> statement-breakpoint
CREATE INDEX "ticket_offer_type_idx" ON "ticket_offer" USING btree ("ticket_type_id");--> statement-breakpoint
CREATE INDEX "ticket_purchase_pro_status_paid_idx" ON "ticket_purchase" USING btree ("professional_id","status","paid_at");--> statement-breakpoint
CREATE INDEX "ticket_purchase_customer_idx" ON "ticket_purchase" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "ticket_purchase_status_expires_idx" ON "ticket_purchase" USING btree ("status","checkout_expires_at");--> statement-breakpoint
CREATE INDEX "ticket_type_pro_idx" ON "ticket_type" USING btree ("professional_id");--> statement-breakpoint
ALTER TABLE "professional" ADD CONSTRAINT "professional_horizon_chk" CHECK (booking_horizon_days BETWEEN 1 AND 365);--> statement-breakpoint
ALTER TABLE "professional" ADD CONSTRAINT "professional_notice_chk" CHECK (min_notice_minutes BETWEEN 0 AND 10080);--> statement-breakpoint
ALTER TABLE "professional" ADD CONSTRAINT "professional_cancel_chk" CHECK (cancel_deadline_hours BETWEEN 0 AND 720);