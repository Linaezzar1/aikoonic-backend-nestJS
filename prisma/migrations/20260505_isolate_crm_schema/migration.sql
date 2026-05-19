-- Isolate NestJS/CRM tables into a dedicated "crm" PostgreSQL schema.
-- FastAPI tables live in "public" and are NOT touched by this migration.
-- After this migration, "prisma migrate deploy" and "db push" will ONLY
-- manage objects in the "crm" schema — the public schema is left untouched.

CREATE SCHEMA IF NOT EXISTS "crm";

-- Move enum types from public to crm (silently skip if already moved or missing)
DO $$ BEGIN ALTER TYPE "public"."LeadStatus" SET SCHEMA "crm"; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "public"."LeadSource" SET SCHEMA "crm"; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "public"."WorkflowTrigger" SET SCHEMA "crm"; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "public"."ExecutionStatus" SET SCHEMA "crm"; EXCEPTION WHEN others THEN NULL; END $$;

-- Move CRM tables from public to crm (silently skip if already moved or missing)
DO $$ BEGIN ALTER TABLE "public"."Tenant" SET SCHEMA "crm"; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "public"."Lead" SET SCHEMA "crm"; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "public"."Tag" SET SCHEMA "crm"; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "public"."Workflow" SET SCHEMA "crm"; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "public"."WorkflowExecution" SET SCHEMA "crm"; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "public"."_LeadTags" SET SCHEMA "crm"; EXCEPTION WHEN others THEN NULL; END $$;

-- Recreate tables in crm if they don't exist yet (fresh DB scenario)
CREATE TABLE IF NOT EXISTS "crm"."Tenant" (
    "id"        TEXT         NOT NULL,
    "name"      TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm"."Lead" (
    "id"        TEXT         NOT NULL,
    "firstName" TEXT,
    "lastName"  TEXT,
    "email"     TEXT         NOT NULL,
    "phone"     TEXT,
    "status"    "crm"."LeadStatus"  NOT NULL DEFAULT 'NOUVEAU',
    "source"    "crm"."LeadSource"  NOT NULL DEFAULT 'MANUEL',
    "notes"     TEXT,
    "tenantId"  TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm"."Tag" (
    "id"        TEXT         NOT NULL,
    "label"     TEXT         NOT NULL,
    "color"     TEXT,
    "tenantId"  TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm"."Workflow" (
    "id"           TEXT         NOT NULL,
    "name"         TEXT         NOT NULL,
    "tenantId"     TEXT         NOT NULL,
    "trigger"      TEXT         NOT NULL,
    "triggerValue" TEXT,
    "steps"        JSONB        NOT NULL,
    "isActive"     BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm"."WorkflowExecution" (
    "id"          TEXT         NOT NULL,
    "workflowId"  TEXT         NOT NULL,
    "leadId"      TEXT         NOT NULL,
    "currentStep" INTEGER      NOT NULL DEFAULT 0,
    "status"      TEXT         NOT NULL DEFAULT 'running',
    "startedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm"."_LeadTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_LeadTags_AB_pkey" PRIMARY KEY ("A", "B")
);

-- Indexes (IF NOT EXISTS to be idempotent)
CREATE INDEX IF NOT EXISTS "Lead_tenantId_idx"               ON "crm"."Lead"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_email_tenantId_key"  ON "crm"."Lead"("email", "tenantId");
CREATE INDEX IF NOT EXISTS "Tag_tenantId_idx"                ON "crm"."Tag"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_label_tenantId_key"   ON "crm"."Tag"("label", "tenantId");
CREATE INDEX IF NOT EXISTS "Workflow_tenantId_idx"           ON "crm"."Workflow"("tenantId");
CREATE INDEX IF NOT EXISTS "WorkflowExecution_workflowId_idx" ON "crm"."WorkflowExecution"("workflowId");
CREATE INDEX IF NOT EXISTS "WorkflowExecution_leadId_idx"    ON "crm"."WorkflowExecution"("leadId");
CREATE INDEX IF NOT EXISTS "_LeadTags_B_index"               ON "crm"."_LeadTags"("B");

-- Foreign keys (skip if already exist)
DO $$ BEGIN
  ALTER TABLE "crm"."Lead" ADD CONSTRAINT "Lead_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "crm"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "crm"."Tag" ADD CONSTRAINT "Tag_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "crm"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "crm"."Workflow" ADD CONSTRAINT "Workflow_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "crm"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "crm"."WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "crm"."Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "crm"."WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "crm"."Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "crm"."_LeadTags" ADD CONSTRAINT "_LeadTags_A_fkey"
    FOREIGN KEY ("A") REFERENCES "crm"."Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "crm"."_LeadTags" ADD CONSTRAINT "_LeadTags_B_fkey"
    FOREIGN KEY ("B") REFERENCES "crm"."Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
