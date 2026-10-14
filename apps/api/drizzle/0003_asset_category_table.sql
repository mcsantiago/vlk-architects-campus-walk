CREATE TABLE "asset_category" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"color" text NOT NULL,
	"tracked_by_default" boolean NOT NULL,
	CONSTRAINT "asset_category_name_unique" UNIQUE("name"),
	CONSTRAINT "asset_category_key_ck" CHECK ("asset_category"."key" ~ '^[a-z][a-z0-9-]*$'),
	CONSTRAINT "asset_category_color_ck" CHECK ("asset_category"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
-- The four categories the check constraint used to hard-code, now rows. Existing types already
-- use these keys, so the foreign key below holds for every database migrated so far.
INSERT INTO "asset_category" ("key", "name", "sort_order", "color", "tracked_by_default") VALUES
	('furniture', 'Furniture', 10, '#3949ab', false),
	('technology', 'Technology', 20, '#1565c0', true),
	('equipment', 'Equipment', 30, '#00695c', true),
	('system', 'System', 40, '#bf360c', true);
--> statement-breakpoint
ALTER TABLE "asset_type" DROP CONSTRAINT "asset_type_category_ck";--> statement-breakpoint
ALTER TABLE "asset_type" ADD CONSTRAINT "asset_type_category_asset_category_key_fk" FOREIGN KEY ("category") REFERENCES "public"."asset_category"("key") ON DELETE no action ON UPDATE no action;