CREATE TABLE "time_off" (
	"id" text PRIMARY KEY NOT NULL,
	"professional_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT true NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_professional_id_professional_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professional"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_off_pro_idx" ON "time_off" USING btree ("professional_id","start_at");