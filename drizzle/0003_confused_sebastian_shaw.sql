ALTER TABLE "professional" ADD COLUMN "avatar_kind" text;--> statement-breakpoint
ALTER TABLE "professional" ADD COLUMN "avatar_style" text;--> statement-breakpoint
ALTER TABLE "professional" ADD COLUMN "avatar_seed" text;--> statement-breakpoint
ALTER TABLE "professional" ADD COLUMN "banner_url" text;--> statement-breakpoint
ALTER TABLE "professional" ADD COLUMN "header_layout" text DEFAULT 'profil' NOT NULL;