CREATE TYPE "public"."support_author_role" AS ENUM('user', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."support_message_kind" AS ENUM('message', 'stage_change', 'resolution');--> statement-breakpoint
CREATE TYPE "public"."support_resolution" AS ENUM('declined', 'closed');--> statement-breakpoint
CREATE TYPE "public"."support_stage" AS ENUM('received', 'in_progress', 'resolved', 'accepted', 'planned', 'in_development', 'testing', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."support_track" AS ENUM('support', 'development');--> statement-breakpoint
CREATE TYPE "public"."support_type" AS ENUM('question', 'bug', 'feature', 'other');--> statement-breakpoint
CREATE TABLE "help_article" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "help_category" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"icon" text DEFAULT 'help' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_category_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "support_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"pathname" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_message" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"author_id" text,
	"author_role" "support_author_role" NOT NULL,
	"kind" "support_message_kind" DEFAULT 'message' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"stage" "support_stage",
	"resolution" "support_resolution",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_request" (
	"id" text PRIMARY KEY NOT NULL,
	"number" serial NOT NULL,
	"user_id" text NOT NULL,
	"type" "support_type" NOT NULL,
	"subject" text NOT NULL,
	"track" "support_track" DEFAULT 'support' NOT NULL,
	"stage" "support_stage" DEFAULT 'received' NOT NULL,
	"resolution" "support_resolution",
	"eta" date,
	"unread_by_user" boolean DEFAULT false NOT NULL,
	"unread_by_admin" boolean DEFAULT true NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_request_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "help_article" ADD CONSTRAINT "help_article_category_id_help_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."help_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_attachment" ADD CONSTRAINT "support_attachment_message_id_support_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."support_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_request_id_support_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."support_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "help_article_category_idx" ON "help_article" USING btree ("category_id","position");--> statement-breakpoint
CREATE INDEX "support_attachment_message_idx" ON "support_attachment" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "support_message_request_idx" ON "support_message" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "support_request_user_idx" ON "support_request" USING btree ("user_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "support_request_unread_idx" ON "support_request" USING btree ("unread_by_admin");