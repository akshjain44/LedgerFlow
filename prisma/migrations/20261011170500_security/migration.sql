-- LedgerFlow: integrity constraints, balance triggers, tenant isolation (RLS)
-- and append-only audit log. Hand-written; Prisma does not model these.

-- ---------------------------------------------------------------- application role
-- The running app connects as `ledgerflow_app`: not a superuser, not the table
-- owner, no BYPASSRLS. Grant it LOGIN + a password outside migrations, e.g.
--   ALTER ROLE ledgerflow_app WITH LOGIN PASSWORD '...';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerflow_app') THEN
    CREATE ROLE ledgerflow_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO ledgerflow_app;

-- ---------------------------------------------------------------- CHECK constraints
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));

ALTER TABLE business_settings
  ADD CONSTRAINT bs_hours CHECK (reminder_start_hour BETWEEN 0 AND 23 AND reminder_end_hour BETWEEN 1 AND 24 AND reminder_start_hour < reminder_end_hour),
  ADD CONSTRAINT bs_threshold CHECK (broken_promise_threshold >= 1),
  ADD CONSTRAINT bs_policy CHECK (dispute_policy IN ('continue', 'hold'));

ALTER TABLE businesses
  ADD CONSTRAINT businesses_credit_days CHECK (default_customer_credit_days BETWEEN 0 AND 365 AND default_supplier_credit_days BETWEEN 0 AND 365);

ALTER TABLE counterparties
  ADD CONSTRAINT cp_role CHECK (is_customer OR is_supplier),
  ADD CONSTRAINT cp_credit_limit CHECK (credit_limit IS NULL OR credit_limit >= 0),
  ADD CONSTRAINT cp_credit_days CHECK ((customer_credit_days IS NULL OR customer_credit_days BETWEEN 0 AND 365) AND (supplier_credit_days IS NULL OR supplier_credit_days BETWEEN 0 AND 365));

ALTER TABLE invoices
  ADD CONSTRAINT inv_total_positive CHECK (total_amount > 0),
  ADD CONSTRAINT inv_paid_nonneg CHECK (amount_paid >= 0),
  ADD CONSTRAINT inv_adjusted_nonneg CHECK (amount_adjusted >= 0),
  ADD CONSTRAINT inv_outstanding_nonneg CHECK (outstanding_amount >= 0),
  ADD CONSTRAINT inv_outstanding_identity CHECK (outstanding_amount = total_amount - amount_paid - amount_adjusted),
  ADD CONSTRAINT inv_tax_nonneg CHECK ((subtotal_amount IS NULL OR subtotal_amount >= 0) AND (tax_amount IS NULL OR tax_amount >= 0)),
  ADD CONSTRAINT inv_due_after_invoice CHECK (due_date >= invoice_date),
  ADD CONSTRAINT inv_void_reason CHECK (lifecycle <> 'void' OR void_reason IS NOT NULL);

ALTER TABLE payments
  ADD CONSTRAINT pay_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT pay_allocated_range CHECK (allocated_amount >= 0 AND allocated_amount <= amount),
  ADD CONSTRAINT pay_reversal_reason CHECK (status <> 'reversed' OR reversal_reason IS NOT NULL);

ALTER TABLE payment_allocations
  ADD CONSTRAINT alloc_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT alloc_reversal_reason CHECK (status <> 'reversed' OR reversal_reason IS NOT NULL);

ALTER TABLE adjustments ADD CONSTRAINT adj_amount_positive CHECK (amount > 0);
ALTER TABLE planned_payments ADD CONSTRAINT pp_amount_positive CHECK (amount > 0);
ALTER TABLE payment_promises ADD CONSTRAINT promise_amount_positive CHECK (amount > 0);
ALTER TABLE payment_promises ADD CONSTRAINT promise_cancel_reason CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL);
ALTER TABLE disputes ADD CONSTRAINT dispute_amount_nonneg CHECK (disputed_amount IS NULL OR disputed_amount >= 0);
ALTER TABLE documents ADD CONSTRAINT doc_size CHECK (size_bytes > 0 AND size_bytes <= 10485760);

-- Invoice numbers: our own receivable numbers are unique per business; a
-- supplier's bill numbers are unique per supplier. An authorised override
-- (recorded in duplicate_override + audit log) is exempt.
CREATE UNIQUE INDEX invoices_receivable_number_uniq ON invoices (business_id, lower(invoice_number))
  WHERE direction = 'receivable' AND duplicate_override IS NULL;
CREATE UNIQUE INDEX invoices_payable_number_uniq ON invoices (business_id, counterparty_id, lower(invoice_number))
  WHERE direction = 'payable' AND duplicate_override IS NULL;

-- A file can be imported once per type per business.
CREATE UNIQUE INDEX import_batches_fingerprint_uniq ON import_batches (business_id, type, file_hash)
  WHERE status = 'completed';

-- ---------------------------------------------------------------- tenant context helpers
CREATE OR REPLACE FUNCTION app_business_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.business_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on'
$$;

-- ---------------------------------------------------------------- same-business integrity
-- Rejects a row whose referenced parent belongs to a different business.
-- SECURITY DEFINER so the lookup sees the real parent row even when RLS
-- would hide it from the caller.
CREATE OR REPLACE FUNCTION check_parent_business() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  parent_table text := TG_ARGV[0];
  fk_column text := TG_ARGV[1];
  parent_id uuid;
  parent_business uuid;
BEGIN
  parent_id := (to_jsonb(NEW) ->> fk_column)::uuid;
  IF parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT business_id FROM %I WHERE id = $1', parent_table) INTO parent_business USING parent_id;
  IF parent_business IS NULL OR parent_business <> NEW.business_id THEN
    RAISE EXCEPTION 'cross-tenant reference rejected: %.% -> %', TG_TABLE_NAME, fk_column, parent_table
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  spec text[];
  specs text[][] := ARRAY[
    ARRAY['invoices','counterparty_id','counterparties'],
    ARRAY['adjustments','invoice_id','invoices'],
    ARRAY['planned_payments','invoice_id','invoices'],
    ARRAY['payments','counterparty_id','counterparties'],
    ARRAY['payment_allocations','payment_id','payments'],
    ARRAY['payment_allocations','invoice_id','invoices'],
    ARRAY['follow_ups','counterparty_id','counterparties'],
    ARRAY['follow_ups','invoice_id','invoices'],
    ARRAY['communications','counterparty_id','counterparties'],
    ARRAY['communication_invoices','communication_id','communications'],
    ARRAY['communication_invoices','invoice_id','invoices'],
    ARRAY['payment_promises','counterparty_id','counterparties'],
    ARRAY['promise_invoices','promise_id','payment_promises'],
    ARRAY['promise_invoices','invoice_id','invoices'],
    ARRAY['disputes','invoice_id','invoices'],
    ARRAY['disputes','counterparty_id','counterparties'],
    ARRAY['dispute_updates','dispute_id','disputes'],
    ARRAY['reminder_jobs','invoice_id','invoices'],
    ARRAY['reminder_deliveries','job_id','reminder_jobs'],
    ARRAY['message_logs','counterparty_id','counterparties'],
    ARRAY['message_logs','invoice_id','invoices'],
    ARRAY['documents','counterparty_id','counterparties'],
    ARRAY['documents','invoice_id','invoices'],
    ARRAY['documents','payment_id','payments'],
    ARRAY['documents','dispute_id','disputes'],
    ARRAY['import_rows','batch_id','import_batches']
  ];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I, business_id ON %I FOR EACH ROW EXECUTE FUNCTION check_parent_business(%L, %L)',
      spec[1] || '_' || spec[2] || '_same_business', spec[2], spec[1], spec[3], spec[2]);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- balance maintenance
-- Invoice and payment balances are derived from active allocations and
-- adjustments by the database itself, so no code path can leave them
-- inconsistent. The CHECK constraints above then reject any allocation that
-- would over-apply a payment or over-settle an invoice.

CREATE OR REPLACE FUNCTION invoices_compute_outstanding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.outstanding_amount := NEW.total_amount - NEW.amount_paid - NEW.amount_adjusted;
  RETURN NEW;
END $$;

CREATE TRIGGER invoices_outstanding BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_compute_outstanding();

CREATE OR REPLACE FUNCTION recalc_invoice_balance(p_invoice uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_paid numeric(14,2);
  v_adjusted numeric(14,2);
  v_total numeric(14,2);
  v_settled date;
BEGIN
  SELECT coalesce(sum(a.amount), 0) INTO v_paid
    FROM payment_allocations a WHERE a.invoice_id = p_invoice AND a.status = 'active';
  SELECT coalesce(sum(j.amount), 0) INTO v_adjusted
    FROM adjustments j WHERE j.invoice_id = p_invoice AND j.status = 'active';
  SELECT total_amount INTO v_total FROM invoices WHERE id = p_invoice;

  IF v_total - v_paid - v_adjusted = 0 THEN
    SELECT max(d) INTO v_settled FROM (
      SELECT p.payment_date AS d FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
        WHERE a.invoice_id = p_invoice AND a.status = 'active'
      UNION ALL
      SELECT j.adjustment_date FROM adjustments j WHERE j.invoice_id = p_invoice AND j.status = 'active'
    ) s;
  ELSE
    v_settled := NULL;
  END IF;

  UPDATE invoices
     SET amount_paid = v_paid, amount_adjusted = v_adjusted, settled_on = v_settled, updated_at = now()
   WHERE id = p_invoice;
END $$;

CREATE OR REPLACE FUNCTION recalc_payment_allocated(p_payment uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE payments
     SET allocated_amount = (SELECT coalesce(sum(amount), 0) FROM payment_allocations WHERE payment_id = p_payment AND status = 'active')
   WHERE id = p_payment;
END $$;

CREATE OR REPLACE FUNCTION allocations_validate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p payments%ROWTYPE;
  i invoices%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'reversed' THEN
      RAISE EXCEPTION 'a reversed allocation cannot be changed' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.amount <> OLD.amount OR NEW.payment_id <> OLD.payment_id OR NEW.invoice_id <> OLD.invoice_id THEN
      RAISE EXCEPTION 'allocations are immutable; reverse and re-allocate instead' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO p FROM payments WHERE id = NEW.payment_id;
  SELECT * INTO i FROM invoices WHERE id = NEW.invoice_id;
  IF p.status <> 'active' THEN
    RAISE EXCEPTION 'cannot allocate a reversed payment' USING ERRCODE = 'check_violation';
  END IF;
  IF i.lifecycle <> 'open' THEN
    RAISE EXCEPTION 'can only allocate to an open invoice' USING ERRCODE = 'check_violation';
  END IF;
  IF p.counterparty_id <> i.counterparty_id THEN
    RAISE EXCEPTION 'payment and invoice belong to different counterparties' USING ERRCODE = 'check_violation';
  END IF;
  IF (p.direction = 'received' AND i.direction <> 'receivable') OR (p.direction = 'made' AND i.direction <> 'payable') THEN
    RAISE EXCEPTION 'payment direction does not match invoice direction' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER allocations_validate BEFORE INSERT OR UPDATE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION allocations_validate();

CREATE OR REPLACE FUNCTION allocations_recalc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM recalc_invoice_balance(NEW.invoice_id);
  PERFORM recalc_payment_allocated(NEW.payment_id);
  RETURN NULL;
END $$;

CREATE TRIGGER allocations_recalc AFTER INSERT OR UPDATE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION allocations_recalc();

CREATE OR REPLACE FUNCTION adjustments_recalc() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM recalc_invoice_balance(NEW.invoice_id);
  RETURN NULL;
END $$;

CREATE TRIGGER adjustments_recalc AFTER INSERT OR UPDATE ON adjustments
  FOR EACH ROW EXECUTE FUNCTION adjustments_recalc();

-- A payment with active allocations cannot be reversed directly; the
-- service reverses its allocations first, in the same transaction.
CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'reversed' AND NEW.status = 'reversed' AND (NEW.amount <> OLD.amount) THEN
    RAISE EXCEPTION 'a reversed payment cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'reversed' AND NEW.status = 'active' THEN
    RAISE EXCEPTION 'a reversed payment cannot be reinstated; record a new payment' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'reversed' AND OLD.status = 'active' AND NEW.allocated_amount > 0 THEN
    RAISE EXCEPTION 'reverse the payment allocations before reversing the payment' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount <> OLD.amount AND NEW.amount < NEW.allocated_amount THEN
    RAISE EXCEPTION 'payment amount cannot fall below its allocated amount' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payments_guard BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- Financial history rows are never deleted.
CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are part of the financial history and cannot be deleted', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER allocations_no_delete BEFORE DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER adjustments_no_delete BEFORE DELETE ON adjustments FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- Audit log is append-only.
CREATE OR REPLACE FUNCTION audit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_append_only();

-- ---------------------------------------------------------------- privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, sessions, password_resets, auth_attempts, businesses, business_settings, memberships, invitations,
  counterparties, planned_payments, follow_ups, communications, communication_invoices,
  payment_promises, promise_invoices, disputes, dispute_updates, notifications, reminder_jobs,
  reminder_deliveries, documents, import_batches, import_rows
TO ledgerflow_app;
GRANT SELECT, INSERT, UPDATE ON invoices, payments, payment_allocations, adjustments TO ledgerflow_app;
GRANT SELECT, INSERT ON audit_logs, message_logs TO ledgerflow_app;
GRANT EXECUTE ON FUNCTION app_business_id(), app_rls_bypass() TO ledgerflow_app;

-- ---------------------------------------------------------------- row level security
-- Every tenant table is visible only for the business set in the
-- transaction-local `app.business_id`. System jobs (reminder processor,
-- invitation acceptance, demo seeding) set `app.bypass_rls = on` explicitly.
-- With no context set, every query returns zero rows (fail closed).
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'business_settings','invitations','counterparties','invoices','adjustments','planned_payments',
    'payments','payment_allocations','follow_ups','communications','communication_invoices',
    'payment_promises','promise_invoices','disputes','dispute_updates','notifications',
    'reminder_jobs','reminder_deliveries','message_logs','documents','audit_logs',
    'import_batches','import_rows'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_rls_bypass() OR business_id = app_business_id()) WITH CHECK (app_rls_bypass() OR business_id = app_business_id())',
      t);
  END LOOP;
END $$;
