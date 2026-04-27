-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NOUVEAU', 'QUALIFIE', 'CONVERTI', 'INACTIF');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('MANUEL', 'CSV_IMPORT', 'FORMULAIRE', 'RESEAU_SOCIAL');

-- CreateEnum
CREATE TYPE "WorkflowTrigger" AS ENUM ('TAG_ADDED', 'CSV_IMPORT', 'MANUEL', 'INACTIVITE');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('EN_COURS', 'TERMINE', 'EN_PAUSE', 'ERREUR');

-- CreateTable
CREATE TABLE "alembic_version" (
    "version_num" VARCHAR(32) NOT NULL,

    CONSTRAINT "alembic_version_pkc" PRIMARY KEY ("version_num")
);

-- CreateTable
CREATE TABLE "calendar_entries" (
    "id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "week_number" INTEGER,
    "scheduled_date" DATE,
    "platform" VARCHAR(100) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "event_reference" TEXT,
    "weather_context" TEXT,
    "notes" TEXT,
    "status" VARCHAR(50) NOT NULL,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_contents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "calendar_id" UUID,
    "calendar_entry_id" UUID,
    "status" VARCHAR(50) NOT NULL,
    "content_format" VARCHAR(50) NOT NULL,
    "platform" VARCHAR(100),
    "title" TEXT,
    "body" TEXT,
    "hashtags" JSONB,
    "local_context" JSONB,
    "premium_features" JSONB,
    "ab_variant" VARCHAR(20),
    "image_prompt" TEXT,
    "image_url" TEXT,
    "export_batch_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_calendars" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "is_strategy_approved" BOOLEAN NOT NULL DEFAULT false,
    "is_calendar_approved" BOOLEAN NOT NULL DEFAULT false,
    "strategy_summary" TEXT,
    "generation_context" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraped_sources" (
    "id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "source_type" VARCHAR(50) NOT NULL,
    "source_category" VARCHAR(50) NOT NULL,
    "url" TEXT NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "title" TEXT NOT NULL,
    "snippet" TEXT,
    "relevance_score" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "scraped_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cache_key" VARCHAR(255),
    "expires_at" TIMESTAMPTZ(6),
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "scope_city" VARCHAR(255),
    "scope_sector" VARCHAR(255),

    CONSTRAINT "scraped_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_citations" (
    "id" UUID NOT NULL,
    "generated_content_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "influence_type" VARCHAR(50) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NOUVEAU',
    "source" "LeadSource" NOT NULL DEFAULT 'MANUEL',
    "notes" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "WorkflowTrigger" NOT NULL,
    "steps" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowExecution" (
    "id" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'EN_COURS',
    "workflowId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_LeadTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_LeadTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "ix_calendar_entries_calendar_id" ON "calendar_entries"("calendar_id");

-- CreateIndex
CREATE INDEX "ix_generated_contents_calendar_entry_id" ON "generated_contents"("calendar_entry_id");

-- CreateIndex
CREATE INDEX "ix_generated_contents_calendar_id" ON "generated_contents"("calendar_id");

-- CreateIndex
CREATE INDEX "ix_generated_contents_export_batch_id" ON "generated_contents"("export_batch_id");

-- CreateIndex
CREATE INDEX "ix_generated_contents_user_id" ON "generated_contents"("user_id");

-- CreateIndex
CREATE INDEX "ix_marketing_calendars_user_id" ON "marketing_calendars"("user_id");

-- CreateIndex
CREATE INDEX "ix_scraped_sources_cache_key" ON "scraped_sources"("cache_key");

-- CreateIndex
CREATE INDEX "ix_scraped_sources_calendar_id" ON "scraped_sources"("calendar_id");

-- CreateIndex
CREATE INDEX "ix_scraped_sources_expires_at" ON "scraped_sources"("expires_at");

-- CreateIndex
CREATE INDEX "ix_scraped_sources_url" ON "scraped_sources"("url");

-- CreateIndex
CREATE INDEX "ix_source_citations_generated_content_id" ON "source_citations"("generated_content_id");

-- CreateIndex
CREATE INDEX "ix_source_citations_source_id" ON "source_citations"("source_id");

-- CreateIndex
CREATE INDEX "Lead_tenantId_idx" ON "Lead"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_email_tenantId_key" ON "Lead"("email", "tenantId");

-- CreateIndex
CREATE INDEX "Tag_tenantId_idx" ON "Tag"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_label_tenantId_key" ON "Tag"("label", "tenantId");

-- CreateIndex
CREATE INDEX "Workflow_tenantId_idx" ON "Workflow"("tenantId");

-- CreateIndex
CREATE INDEX "WorkflowExecution_leadId_idx" ON "WorkflowExecution"("leadId");

-- CreateIndex
CREATE INDEX "WorkflowExecution_workflowId_idx" ON "WorkflowExecution"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowExecution_workflowId_leadId_key" ON "WorkflowExecution"("workflowId", "leadId");

-- CreateIndex
CREATE INDEX "_LeadTags_B_index" ON "_LeadTags"("B");

-- AddForeignKey
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "marketing_calendars"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "generated_contents" ADD CONSTRAINT "generated_contents_calendar_entry_id_fkey" FOREIGN KEY ("calendar_entry_id") REFERENCES "calendar_entries"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "generated_contents" ADD CONSTRAINT "generated_contents_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "marketing_calendars"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scraped_sources" ADD CONSTRAINT "scraped_sources_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "marketing_calendars"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "source_citations" ADD CONSTRAINT "source_citations_generated_content_id_fkey" FOREIGN KEY ("generated_content_id") REFERENCES "generated_contents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "source_citations" ADD CONSTRAINT "source_citations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "scraped_sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecution" ADD CONSTRAINT "WorkflowExecution_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LeadTags" ADD CONSTRAINT "_LeadTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LeadTags" ADD CONSTRAINT "_LeadTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

