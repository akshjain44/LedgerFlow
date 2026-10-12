-- Hardening for hosted Postgres (Supabase in particular).
--
-- Supabase grants every new table in `public` to its `anon` and
-- `authenticated` roles and exposes them through its Data API (PostgREST).
-- LedgerFlow does not use that API: only the server connects, as
-- `ledgerflow_app`. Remove those grants so a public/publishable key can never
-- read users, sessions or any business data.

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      BEGIN
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I', r);
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'could not change default privileges for %', r;
      END;
    END IF;
  END LOOP;
END $$;

-- Internal helper functions are not callable by arbitrary roles (e.g. as RPCs).
REVOKE EXECUTE ON FUNCTION recalc_invoice_balance(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION recalc_payment_allocated(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION check_parent_business() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION allocations_validate() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION allocations_recalc() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION adjustments_recalc() FROM PUBLIC;

-- Identity tables are not tenant-scoped, so they had no RLS. Enable it with a
-- policy for the application role only: any other non-owner role sees nothing.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'sessions', 'password_resets', 'auth_attempts', 'businesses', 'memberships'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY app_only ON %I TO ledgerflow_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
