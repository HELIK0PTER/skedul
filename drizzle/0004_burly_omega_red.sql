CREATE TYPE "public"."question_type" AS ENUM('text', 'choice', 'boolean');--> statement-breakpoint
CREATE TABLE "booking_answer" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" text NOT NULL,
	"question_id" text,
	"question_label" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_answer_unique" UNIQUE("booking_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "class_session" (
	"id" text PRIMARY KEY NOT NULL,
	"professional_id" text NOT NULL,
	"event_type_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"seats_remaining" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_event_start_unique" UNIQUE("event_type_id","start_at")
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type_id" text NOT NULL,
	"label" text NOT NULL,
	"type" "question_type" NOT NULL,
	"options" text[],
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "event_type" ADD COLUMN "capacity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_answer" ADD CONSTRAINT "booking_answer_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_answer" ADD CONSTRAINT "booking_answer_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_event_type_id_event_type_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_event_type_id_event_type_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_answer_booking_idx" ON "booking_answer" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "session_pro_start_idx" ON "class_session" USING btree ("professional_id","start_at");--> statement-breakpoint
CREATE INDEX "question_event_type_idx" ON "question" USING btree ("event_type_id");--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_session_id_class_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_session"("id") ON DELETE restrict ON UPDATE no action;