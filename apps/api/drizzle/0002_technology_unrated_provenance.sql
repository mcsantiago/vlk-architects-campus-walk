ALTER TABLE "asset" DROP CONSTRAINT "asset_condition_ck";--> statement-breakpoint
ALTER TABLE "asset_type" DROP CONSTRAINT "asset_type_category_ck";--> statement-breakpoint
ALTER TABLE "asset" ALTER COLUMN "condition" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "manufacturer" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "serial_number" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "install_year" integer;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_install_year_ck" CHECK ("asset"."install_year" IS NULL OR "asset"."install_year" BETWEEN 1800 AND 2200);--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_condition_ck" CHECK ("asset"."condition" IS NULL OR "asset"."condition" BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE "asset_type" ADD CONSTRAINT "asset_type_category_ck" CHECK ("asset_type"."category" IN ('furniture', 'technology', 'equipment', 'system'));