-- ─────────────────────────────────────────────────────────────────────────────
-- AUTH TABLES  (public schema — owned by NestJS)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "users" (
    "id"             UUID           NOT NULL DEFAULT gen_random_uuid(),
    "email"          VARCHAR(255)   NOT NULL,
    "password"       VARCHAR(255)   NOT NULL,
    "first_name"     VARCHAR(100),
    "last_name"      VARCHAR(100),
    "role"           VARCHAR(20)    NOT NULL DEFAULT 'VIEWER',
    "is_active"      BOOLEAN        NOT NULL DEFAULT true,
    "email_verified" BOOLEAN        NOT NULL DEFAULT false,
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
CREATE INDEX        IF NOT EXISTS "ix_users_email"   ON "users"("email");

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id"         UUID           NOT NULL DEFAULT gen_random_uuid(),
    "token"      VARCHAR(512)   NOT NULL,
    "user_id"    UUID           NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_key"  ON "refresh_tokens"("token");
CREATE INDEX        IF NOT EXISTS "ix_refresh_tokens_user_id" ON "refresh_tokens"("user_id");
CREATE INDEX        IF NOT EXISTS "ix_refresh_tokens_token"   ON "refresh_tokens"("token");

DO $$ BEGIN
  ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTIFICATIONS  (public schema — may also be created by Alembic)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "notifications" (
    "id"         UUID           NOT NULL DEFAULT gen_random_uuid(),
    "user_id"    UUID           NOT NULL,
    "type"       VARCHAR(50)    NOT NULL,
    "title"      VARCHAR(200)   NOT NULL,
    "message"    VARCHAR(500)   NOT NULL,
    "is_read"    BOOLEAN        NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ix_notifications_user_id"         ON "notifications"("user_id");
CREATE INDEX IF NOT EXISTS "ix_notifications_user_id_is_read" ON "notifications"("user_id", "is_read");

-- ─────────────────────────────────────────────────────────────────────────────
-- crm.Tenant  — rename column + add missing columns
-- ─────────────────────────────────────────────────────────────────────────────

-- Rename "createdAt" → "created_at" to match @@map("created_at") in schema.prisma
DO $$ BEGIN
  ALTER TABLE "crm"."Tenant" RENAME COLUMN "createdAt" TO "created_at";
EXCEPTION WHEN undefined_column THEN NULL; END $$;

ALTER TABLE "crm"."Tenant" ADD COLUMN IF NOT EXISTS "user_id"    UUID;
ALTER TABLE "crm"."Tenant" ADD COLUMN IF NOT EXISTS "company_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_user_id_key"    ON "crm"."Tenant"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_company_id_key" ON "crm"."Tenant"("company_id");
CREATE INDEX        IF NOT EXISTS "Tenant_user_id_idx"    ON "crm"."Tenant"("user_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- crm.WorkflowExecution  — add columns added to schema.prisma after migrations
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "crm"."WorkflowExecution" ADD COLUMN IF NOT EXISTS "currentNodeId" TEXT;
ALTER TABLE "crm"."WorkflowExecution" ADD COLUMN IF NOT EXISTS "eventValue"    TEXT;
ALTER TABLE "crm"."WorkflowExecution" ADD COLUMN IF NOT EXISTS "resumeAt"      TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "WorkflowExecution_status_resumeAt_idx"
    ON "crm"."WorkflowExecution"("status", "resumeAt");
