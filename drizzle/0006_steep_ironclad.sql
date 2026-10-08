ALTER TYPE "public"."user_role" ADD VALUE 'admin';--> statement-breakpoint
CREATE TABLE "page_view" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"path" text NOT NULL,
	"professional_id" text,
	"referrer_host" text,
	"source" text,
	"entry" boolean DEFAULT false NOT NULL,
	"device" text NOT NULL,
	"country" text,
	"visitor_hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "page_view" ADD CONSTRAINT "page_view_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_view_created_idx" ON "page_view" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "page_view_pro_created_idx" ON "page_view" USING btree ("professional_id","created_at");