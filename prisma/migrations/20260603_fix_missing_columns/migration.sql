-- ─────────────────────────────────────────────────────────────────────────────
-- subscriptions — add Stripe columns missing from the initial Alembic migration
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "public"."subscriptions" ADD COLUMN IF NOT EXISTS "stripe_customer_id"     VARCHAR(255);
ALTER TABLE "public"."subscriptions" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" VARCHAR(255);

CREATE INDEX IF NOT EXISTS "ix_subscriptions_stripe_subscription_id"
    ON "public"."subscriptions"("stripe_subscription_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- plans — add stripe_price_id missing from initial Alembic migration
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "public"."plans" ADD COLUMN IF NOT EXISTS "stripe_price_id" VARCHAR(255);

-- ─────────────────────────────────────────────────────────────────────────────
-- webhook_events — create if not yet created by Alembic
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "public"."webhook_events" (
    "id"               UUID           NOT NULL DEFAULT gen_random_uuid(),
    "stripe_event_id"  VARCHAR(255)   NOT NULL,
    "event_type"       VARCHAR(100)   NOT NULL,
    "status"           VARCHAR(20)    NOT NULL,
    "error_message"    TEXT,
    "livemode"         BOOLEAN        NOT NULL DEFAULT false,
    "raw_payload"      JSONB,
    "processed_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_stripe_event_id_key" ON "public"."webhook_events"("stripe_event_id");
CREATE INDEX        IF NOT EXISTS "ix_webhook_events_event_type"        ON "public"."webhook_events"("event_type");
CREATE INDEX        IF NOT EXISTS "ix_webhook_events_status"            ON "public"."webhook_events"("status");

-- ─────────────────────────────────────────────────────────────────────────────
-- crm.WorkflowExecution — add columns that 20260601 migration failed to apply
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "crm"."WorkflowExecution" ADD COLUMN IF NOT EXISTS "currentNodeId" TEXT;
ALTER TABLE "crm"."WorkflowExecution" ADD COLUMN IF NOT EXISTS "eventValue"    TEXT;
ALTER TABLE "crm"."WorkflowExecution" ADD COLUMN IF NOT EXISTS "resumeAt"      TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "WorkflowExecution_status_resumeAt_idx"
    ON "crm"."WorkflowExecution"("status", "resumeAt");
