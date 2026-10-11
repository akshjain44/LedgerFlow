-- CreateEnum
CREATE TYPE "role" AS ENUM ('owner', 'finance_manager', 'staff');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "counterparty_status" AS ENUM ('active', 'on_hold', 'inactive');

-- CreateEnum
CREATE TYPE "invoice_direction" AS ENUM ('receivable', 'payable');

-- CreateEnum
CREATE TYPE "invoice_lifecycle" AS ENUM ('draft', 'open', 'void');

-- CreateEnum
CREATE TYPE "payment_priority" AS ENUM ('low', 'normal', 'high', 'critical');

-- CreateEnum
CREATE TYPE "payment_direction" AS ENUM ('received', 'made');

-- CreateEnum
CREATE TYPE "record_status" AS ENUM ('active', 'reversed');

-- CreateEnum
CREATE TYPE "adjustment_kind" AS ENUM ('credit_note', 'write_off');

-- CreateEnum
CREATE TYPE "follow_up_type" AS ENUM ('call', 'email', 'visit', 'review', 'escalation', 'payment_planning', 'other');

-- CreateEnum
CREATE TYPE "follow_up_status" AS ENUM ('pending', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "follow_up_source" AS ENUM ('manual', 'system_overdue', 'system_promise', 'escalation');

-- CreateEnum
CREATE TYPE "communication_channel" AS ENUM ('call', 'email', 'whatsapp', 'sms', 'visit', 'note');

-- CreateEnum
CREATE TYPE "communication_direction" AS ENUM ('outbound', 'inbound');

-- CreateEnum
CREATE TYPE "call_outcome" AS ENUM ('no_answer', 'unavailable', 'payment_promised', 'part_payment_received', 'payment_completed', 'invoice_dispute', 'delivery_dispute', 'rate_discrepancy', 'cash_flow_difficulty', 'extension_requested', 'refused', 'wrong_contact', 'escalated', 'other');

-- CreateEnum
CREATE TYPE "promise_status" AS ENUM ('upcoming', 'kept', 'partially_kept', 'broken', 'cancelled');

-- CreateEnum
CREATE TYPE "dispute_category" AS ENUM ('quantity_mismatch', 'rate_mismatch', 'missing_delivery_docs', 'damaged_goods', 'invoice_discrepancy', 'tax_discrepancy', 'allocation_discrepancy', 'other');

-- CreateEnum
CREATE TYPE "dispute_status" AS ENUM ('open', 'under_review', 'awaiting_customer', 'awaiting_supplier', 'awaiting_internal', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "notification_priority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "reminder_job_status" AS ENUM ('pending', 'processing', 'completed', 'cancelled', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "delivery_channel" AS ENUM ('in_app', 'email');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('pending', 'delivered', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "planned_payment_status" AS ENUM ('scheduled', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "message_status" AS ENUM ('prepared', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "document_kind" AS ENUM ('invoice', 'supplier_bill', 'purchase_order', 'delivery_challan', 'payment_confirmation', 'dispute_evidence', 'other');

-- CreateEnum
CREATE TYPE "import_type" AS ENUM ('customers', 'suppliers', 'receivables', 'payables', 'payments');

-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('previewed', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "import_row_outcome" AS ENUM ('created', 'skipped_duplicate', 'skipped_by_user', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "active_business_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_attempts" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "business_type" TEXT,
    "gstin" TEXT,
    "address" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "default_customer_credit_days" INTEGER NOT NULL DEFAULT 30,
    "default_supplier_credit_days" INTEGER NOT NULL DEFAULT 30,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_settings" (
    "business_id" UUID NOT NULL,
    "working_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "reminder_start_hour" INTEGER NOT NULL DEFAULT 9,
    "reminder_end_hour" INTEGER NOT NULL DEFAULT 19,
    "receivable_reminder_offsets" INTEGER[] DEFAULT ARRAY[-3, -1, 0, 1, 3, 7, 15, 30]::INTEGER[],
    "payable_reminder_offsets" INTEGER[] DEFAULT ARRAY[-3, -1, 0, 1, 7]::INTEGER[],
    "reminders_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "broken_promise_threshold" INTEGER NOT NULL DEFAULT 2,
    "broken_promise_window_days" INTEGER NOT NULL DEFAULT 90,
    "finance_manager_overdue_days" INTEGER NOT NULL DEFAULT 7,
    "dispute_review_days" INTEGER NOT NULL DEFAULT 7,
    "dispute_policy" TEXT NOT NULL DEFAULT 'continue',
    "payment_methods" TEXT[] DEFAULT ARRAY['Bank transfer (NEFT/RTGS/IMPS)', 'UPI', 'Cheque', 'Cash', 'Other']::TEXT[],
    "invoice_prefix" TEXT,
    "priority_weights" JSONB,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "role" NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "membership_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "role" NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparties" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "billing_address" TEXT,
    "gstin" TEXT,
    "account_code" TEXT,
    "is_customer" BOOLEAN NOT NULL DEFAULT false,
    "is_supplier" BOOLEAN NOT NULL DEFAULT false,
    "customer_credit_days" INTEGER,
    "supplier_credit_days" INTEGER,
    "payment_terms" TEXT,
    "credit_limit" DECIMAL(14,2),
    "status" "counterparty_status" NOT NULL DEFAULT 'active',
    "assigned_user_id" UUID,
    "notes" TEXT,
    "import_batch_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "direction" "invoice_direction" NOT NULL,
    "counterparty_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "payment_terms" TEXT,
    "credit_days" INTEGER,
    "due_date" DATE NOT NULL,
    "due_date_manual" BOOLEAN NOT NULL DEFAULT false,
    "subtotal_amount" DECIMAL(14,2),
    "tax_amount" DECIMAL(14,2),
    "total_amount" DECIMAL(14,2) NOT NULL,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount_adjusted" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outstanding_amount" DECIMAL(14,2) NOT NULL,
    "lifecycle" "invoice_lifecycle" NOT NULL DEFAULT 'open',
    "po_reference" TEXT,
    "delivery_reference" TEXT,
    "notes" TEXT,
    "assigned_user_id" UUID,
    "priority" "payment_priority" NOT NULL DEFAULT 'normal',
    "reminders_enabled" BOOLEAN NOT NULL DEFAULT true,
    "duplicate_override" TEXT,
    "settled_on" DATE,
    "void_reason" TEXT,
    "voided_at" TIMESTAMPTZ,
    "import_batch_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "kind" "adjustment_kind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "adjustment_date" DATE NOT NULL,
    "reference" TEXT,
    "reason" TEXT NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'active',
    "reversed_at" TIMESTAMPTZ,
    "reversed_by_id" UUID,
    "reversal_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planned_payments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "planned_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "promised_to_supplier" BOOLEAN NOT NULL DEFAULT false,
    "status" "planned_payment_status" NOT NULL DEFAULT 'scheduled',
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planned_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "direction" "payment_direction" NOT NULL,
    "counterparty_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "allocated_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_date" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'active',
    "reversed_at" TIMESTAMPTZ,
    "reversed_by_id" UUID,
    "reversal_reason" TEXT,
    "import_batch_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'active',
    "reversed_at" TIMESTAMPTZ,
    "reversed_by_id" UUID,
    "reversal_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "counterparty_id" UUID NOT NULL,
    "invoice_id" UUID,
    "type" "follow_up_type" NOT NULL,
    "title" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "assigned_user_id" UUID,
    "status" "follow_up_status" NOT NULL DEFAULT 'pending',
    "source" "follow_up_source" NOT NULL DEFAULT 'manual',
    "priority" "notification_priority" NOT NULL DEFAULT 'normal',
    "details" TEXT,
    "completed_at" TIMESTAMPTZ,
    "completed_by_id" UUID,
    "completion_note" TEXT,
    "dedupe_key" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communications" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "counterparty_id" UUID NOT NULL,
    "channel" "communication_channel" NOT NULL,
    "direction" "communication_direction" NOT NULL DEFAULT 'outbound',
    "outcome" "call_outcome",
    "contact_person" TEXT,
    "notes" TEXT,
    "contacted_at" TIMESTAMPTZ NOT NULL,
    "follow_up_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_invoices" (
    "communication_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,

    CONSTRAINT "communication_invoices_pkey" PRIMARY KEY ("communication_id","invoice_id")
);

-- CreateTable
CREATE TABLE "payment_promises" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "counterparty_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "promised_date" DATE NOT NULL,
    "is_full_payment" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "follow_up_date" DATE,
    "status" "promise_status" NOT NULL DEFAULT 'upcoming',
    "amount_received" DECIMAL(14,2),
    "evaluated_at" TIMESTAMPTZ,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "review_note" TEXT,
    "cancel_reason" TEXT,
    "parent_promise_id" UUID,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "payment_promises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promise_invoices" (
    "promise_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,

    CONSTRAINT "promise_invoices_pkey" PRIMARY KEY ("promise_id","invoice_id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "counterparty_id" UUID NOT NULL,
    "category" "dispute_category" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "dispute_status" NOT NULL DEFAULT 'open',
    "raised_on" DATE NOT NULL,
    "assigned_user_id" UUID,
    "disputed_amount" DECIMAL(14,2),
    "collection_hold" BOOLEAN NOT NULL DEFAULT false,
    "hold_reason" TEXT,
    "resolution_notes" TEXT,
    "resolved_on" DATE,
    "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_updates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "dispute_id" UUID NOT NULL,
    "from_status" "dispute_status",
    "to_status" "dispute_status" NOT NULL,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "priority" "notification_priority" NOT NULL DEFAULT 'normal',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "entity_type" TEXT,
    "entity_id" UUID,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_jobs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "scheduled_for" DATE NOT NULL,
    "invoice_id" UUID,
    "promise_id" UUID,
    "follow_up_id" UUID,
    "planned_payment_id" UUID,
    "dispute_id" UUID,
    "counterparty_id" UUID,
    "due_date_snapshot" DATE,
    "status" "reminder_job_status" NOT NULL DEFAULT 'pending',
    "status_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_deliveries" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "channel" "delivery_channel" NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'pending',
    "status_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "delivered_at" TIMESTAMPTZ,
    "notification_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_logs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "counterparty_id" UUID NOT NULL,
    "invoice_id" UUID,
    "template_key" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "message_status" NOT NULL,
    "error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "document_kind" NOT NULL,
    "original_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "counterparty_id" UUID,
    "invoice_id" UUID,
    "payment_id" UUID,
    "dispute_id" UUID,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by_id" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "type" "import_type" NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "status" "import_status" NOT NULL DEFAULT 'previewed',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "created_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "mapping" JSONB,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "outcome" "import_row_outcome" NOT NULL,
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entity_id" UUID,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_token_hash_key" ON "password_resets"("token_hash");

-- CreateIndex
CREATE INDEX "auth_attempts_kind_key_hash_created_at_idx" ON "auth_attempts"("kind", "key_hash", "created_at");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_business_id_user_id_key" ON "memberships"("business_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_business_id_idx" ON "invitations"("business_id");

-- CreateIndex
CREATE INDEX "counterparties_business_id_name_idx" ON "counterparties"("business_id", "name");

-- CreateIndex
CREATE INDEX "counterparties_business_id_is_customer_idx" ON "counterparties"("business_id", "is_customer");

-- CreateIndex
CREATE INDEX "counterparties_business_id_is_supplier_idx" ON "counterparties"("business_id", "is_supplier");

-- CreateIndex
CREATE UNIQUE INDEX "counterparties_business_id_account_code_key" ON "counterparties"("business_id", "account_code");

-- CreateIndex
CREATE INDEX "invoices_business_id_direction_due_date_idx" ON "invoices"("business_id", "direction", "due_date");

-- CreateIndex
CREATE INDEX "invoices_business_id_direction_lifecycle_idx" ON "invoices"("business_id", "direction", "lifecycle");

-- CreateIndex
CREATE INDEX "invoices_business_id_counterparty_id_idx" ON "invoices"("business_id", "counterparty_id");

-- CreateIndex
CREATE INDEX "invoices_business_id_assigned_user_id_idx" ON "invoices"("business_id", "assigned_user_id");

-- CreateIndex
CREATE INDEX "adjustments_business_id_invoice_id_idx" ON "adjustments"("business_id", "invoice_id");

-- CreateIndex
CREATE INDEX "planned_payments_business_id_planned_date_idx" ON "planned_payments"("business_id", "planned_date");

-- CreateIndex
CREATE INDEX "payments_business_id_direction_payment_date_idx" ON "payments"("business_id", "direction", "payment_date");

-- CreateIndex
CREATE INDEX "payments_business_id_counterparty_id_idx" ON "payments"("business_id", "counterparty_id");

-- CreateIndex
CREATE INDEX "payment_allocations_business_id_invoice_id_idx" ON "payment_allocations"("business_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payment_allocations_business_id_payment_id_idx" ON "payment_allocations"("business_id", "payment_id");

-- CreateIndex
CREATE INDEX "follow_ups_business_id_status_due_date_idx" ON "follow_ups"("business_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "follow_ups_business_id_assigned_user_id_status_idx" ON "follow_ups"("business_id", "assigned_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "follow_ups_business_id_dedupe_key_key" ON "follow_ups"("business_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "communications_business_id_counterparty_id_contacted_at_idx" ON "communications"("business_id", "counterparty_id", "contacted_at");

-- CreateIndex
CREATE INDEX "communication_invoices_business_id_invoice_id_idx" ON "communication_invoices"("business_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payment_promises_business_id_status_promised_date_idx" ON "payment_promises"("business_id", "status", "promised_date");

-- CreateIndex
CREATE INDEX "payment_promises_business_id_counterparty_id_idx" ON "payment_promises"("business_id", "counterparty_id");

-- CreateIndex
CREATE INDEX "promise_invoices_business_id_invoice_id_idx" ON "promise_invoices"("business_id", "invoice_id");

-- CreateIndex
CREATE INDEX "disputes_business_id_status_idx" ON "disputes"("business_id", "status");

-- CreateIndex
CREATE INDEX "disputes_business_id_invoice_id_idx" ON "disputes"("business_id", "invoice_id");

-- CreateIndex
CREATE INDEX "dispute_updates_business_id_dispute_id_idx" ON "dispute_updates"("business_id", "dispute_id");

-- CreateIndex
CREATE INDEX "notifications_business_id_user_id_read_at_idx" ON "notifications"("business_id", "user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_business_id_user_id_dedupe_key_key" ON "notifications"("business_id", "user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "reminder_jobs_status_scheduled_for_idx" ON "reminder_jobs"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "reminder_jobs_business_id_invoice_id_idx" ON "reminder_jobs"("business_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_jobs_business_id_dedupe_key_key" ON "reminder_jobs"("business_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "reminder_deliveries_business_id_status_idx" ON "reminder_deliveries"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_deliveries_job_id_channel_recipient_user_id_key" ON "reminder_deliveries"("job_id", "channel", "recipient_user_id");

-- CreateIndex
CREATE INDEX "message_logs_business_id_counterparty_id_created_at_idx" ON "message_logs"("business_id", "counterparty_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE INDEX "documents_business_id_invoice_id_idx" ON "documents"("business_id", "invoice_id");

-- CreateIndex
CREATE INDEX "documents_business_id_counterparty_id_idx" ON "documents"("business_id", "counterparty_id");

-- CreateIndex
CREATE INDEX "audit_logs_business_id_created_at_idx" ON "audit_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_business_id_entity_type_entity_id_idx" ON "audit_logs"("business_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "import_batches_business_id_type_file_hash_idx" ON "import_batches"("business_id", "type", "file_hash");

-- CreateIndex
CREATE INDEX "import_rows_business_id_batch_id_idx" ON "import_rows"("business_id", "batch_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_payments" ADD CONSTRAINT "planned_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_invoices" ADD CONSTRAINT "communication_invoices_communication_id_fkey" FOREIGN KEY ("communication_id") REFERENCES "communications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_invoices" ADD CONSTRAINT "communication_invoices_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_promises" ADD CONSTRAINT "payment_promises_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promise_invoices" ADD CONSTRAINT "promise_invoices_promise_id_fkey" FOREIGN KEY ("promise_id") REFERENCES "payment_promises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promise_invoices" ADD CONSTRAINT "promise_invoices_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_updates" ADD CONSTRAINT "dispute_updates_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_jobs" ADD CONSTRAINT "reminder_jobs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "reminder_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_counterparty_id_fkey" FOREIGN KEY ("counterparty_id") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
