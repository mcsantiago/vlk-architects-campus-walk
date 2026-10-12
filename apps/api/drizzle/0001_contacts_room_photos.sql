ALTER TABLE "building" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "building" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "building" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "building" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "campus" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "campus" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "campus" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "campus" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "photo" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_room_idx" ON "photo" USING btree ("room_id");--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_one_subject_ck" CHECK ("photo"."asset_id" IS NULL OR "photo"."room_id" IS NULL);