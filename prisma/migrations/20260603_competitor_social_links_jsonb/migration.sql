-- Replace individual platform URL columns with a flexible JSONB social_links column

-- 1. Add social_links column
ALTER TABLE "public"."competitors" ADD COLUMN "social_links" JSONB NOT NULL DEFAULT '{}';

-- 2. Migrate existing data
UPDATE "public"."competitors"
SET social_links = (
    COALESCE(
        CASE WHEN facebook_url  IS NOT NULL THEN jsonb_build_object('facebook',  facebook_url)  ELSE '{}'::jsonb END ||
        CASE WHEN instagram_url IS NOT NULL THEN jsonb_build_object('instagram', instagram_url) ELSE '{}'::jsonb END ||
        CASE WHEN tiktok_url    IS NOT NULL THEN jsonb_build_object('tiktok',    tiktok_url)    ELSE '{}'::jsonb END,
        '{}'::jsonb
    )
);

-- 3. Drop old columns
ALTER TABLE "public"."competitors" DROP COLUMN "facebook_url";
ALTER TABLE "public"."competitors" DROP COLUMN "instagram_url";
ALTER TABLE "public"."competitors" DROP COLUMN "tiktok_url";
