CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid NOT NULL,
	"floor_id" uuid,
	"room_id" uuid,
	"asset_type_id" uuid NOT NULL,
	"label" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"condition" integer NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "asset_room_needs_floor_ck" CHECK ("asset"."room_id" IS NULL OR "asset"."floor_id" IS NOT NULL),
	CONSTRAINT "asset_condition_ck" CHECK ("asset"."condition" BETWEEN 1 AND 5),
	CONSTRAINT "asset_quantity_ck" CHECK ("asset"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "asset_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"changed_by" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"tracked_individually" boolean NOT NULL,
	CONSTRAINT "asset_type_name_unique" UNIQUE("name"),
	CONSTRAINT "asset_type_category_ck" CHECK ("asset_type"."category" IN ('furniture', 'equipment', 'system'))
);
--> statement-breakpoint
CREATE TABLE "building" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campus_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"year_built" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "building_campus_code_uq" UNIQUE("campus_id","code")
);
--> statement-breakpoint
CREATE TABLE "campus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"district" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floor_building_level_uq" UNIQUE("building_id","level"),
	CONSTRAINT "floor_id_building_uq" UNIQUE("id","building_id")
);
--> statement-breakpoint
CREATE TABLE "photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid,
	"s3_key" text NOT NULL,
	"ai_suggestion" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_s3_key_unique" UNIQUE("s3_key")
);
--> statement-breakpoint
CREATE TABLE "room" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"room_type" text NOT NULL,
	"walked_at" timestamp with time zone,
	"walked_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_floor_number_uq" UNIQUE("floor_id","number"),
	CONSTRAINT "room_id_floor_uq" UNIQUE("id","floor_id"),
	CONSTRAINT "room_walked_by_ck" CHECK (("room"."walked_at" IS NULL) = ("room"."walked_by_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_asset_type_id_asset_type_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_building_fk" FOREIGN KEY ("building_id") REFERENCES "public"."building"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_floor_in_building_fk" FOREIGN KEY ("floor_id","building_id") REFERENCES "public"."floor"("id","building_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_room_on_floor_fk" FOREIGN KEY ("room_id","floor_id") REFERENCES "public"."room"("id","floor_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_event" ADD CONSTRAINT "asset_event_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_event" ADD CONSTRAINT "asset_event_changed_by_app_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building" ADD CONSTRAINT "building_campus_id_campus_id_fk" FOREIGN KEY ("campus_id") REFERENCES "public"."campus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor" ADD CONSTRAINT "floor_building_id_building_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."building"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo" ADD CONSTRAINT "photo_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room" ADD CONSTRAINT "room_floor_id_floor_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room" ADD CONSTRAINT "room_walked_by_id_app_user_id_fk" FOREIGN KEY ("walked_by_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_building_idx" ON "asset" USING btree ("building_id") WHERE "asset"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "asset_room_idx" ON "asset" USING btree ("room_id") WHERE "asset"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "asset_event_asset_idx" ON "asset_event" USING btree ("asset_id","changed_at");--> statement-breakpoint
CREATE INDEX "photo_asset_idx" ON "photo" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_name_lower_uq" ON "app_user" USING btree (lower("name"));