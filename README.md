# LedgerFlow

Receivables, payables and collections management for small and medium B2B trading businesses in India (initially chemical and industrial-material distributors).

LedgerFlow answers five daily questions: who owes us and how much, whom we owe, what is due or overdue, what the responsible employee should do next, and what evidence and history they need to resolve the account. The product name is configurable through `NEXT_PUBLIC_APP_NAME`.

> **Product context.** The brief referred to an attached document, *"Problem–Solution Lab: India.pdf"*. It was not available in the build environment, so the product decisions follow the context restated in the brief. For example, two broken promises escalate to the owner, calls are the main collection action, and promises are recorded with dates and followed through. The historical figures quoted in the brief are not presented anywhere in the app as product outcomes.

---

## What is implemented

| Area | Status |
|---|---|
| Sign-up, sign-in, sign-out, password reset, 14-day sessions, login rate limiting | ✅ |
| Onboarding: business profile with optional GSTIN, credit terms, working days, reminder preset | ✅ |
| Multi-business membership, business switcher, invitations by link (and by email when SMTP is set) | ✅ |
| Roles: Owner/Admin, Finance Manager, Staff with granular permissions, enforced on the server | ✅ |
| Tenant isolation: server checks **and** PostgreSQL Row Level Security, plus cross-tenant reference triggers | ✅ tested |
| Customers and suppliers in one table (an account can be both), profiles, behaviour facts, statements | ✅ |
| Receivable invoices and payable bills: due-date calculation or explicit date, tax split, PO and delivery refs, duplicate guard with audited override, edit, void, drafts | ✅ |
| Payments: partial payments, multi-invoice allocation, unallocated balances, allocate later, reallocation, reversal, credit notes and write-offs, all traceable | ✅ |
| Collections workspace: explainable priority queue, click-to-call, call outcomes, promises, follow-ups, disputes, message templates | ✅ |
| Promise-to-pay evaluated against actual payments; broken promises raise tasks; repeated broken promises escalate to the owner | ✅ tested |
| Server-side reminder processor: idempotent, deduplicated, quiet hours, bounded retries, delivery log, stale-skip, cancellation on settlement and on due-date change | ✅ tested |
| In-app notification centre | ✅ |
| Email via SMTP (reminders, invitations, password reset, customer messages) | ⚙️ implemented, **needs SMTP credentials** (none in this environment; failure handling is tested with a stub) |
| WhatsApp / SMS | ❌ not integrated. "Prepare message" lets staff copy reviewed text; nothing is reported as sent |
| Dashboard with defined metrics; reports (ageing as of any date, customer outstanding, supplier obligations, collections effectiveness, follow-up productivity, cash-flow outlook); CSV export; printable statements | ✅ |
| CSV import (customers, suppliers, invoices, bills, payments) with mapping, row-level errors, duplicate detection, file fingerprinting and a per-row outcome log | ✅ tested |
| Private document storage with content sniffing and signed, user-bound, time-limited links | ✅ local directory or a Supabase Storage private bucket (see Deployment) |
| Append-only audit log of material events | ✅ enforced by a database trigger |
| Demo mode (separate fictional business) | ✅ |
| Supplier GSTIN verification, invoice reconciliation, AI assistance | ❌ not implemented. Integration boundaries are documented below; nothing is simulated |

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions), React 19, TypeScript (strict), Tailwind CSS 4.
- **PostgreSQL** with **Prisma 6**. Money is `NUMERIC(14,2)`; domain logic uses integer paise (`bigint`); business dates are `DATE`.
- Zod validation, Recharts, Sonner toasts, Papa Parse, Nodemailer, Vitest, Playwright.

Decisions that differ from the suggested stack:

- **Authentication is built in** (scrypt password hashes, opaque session tokens stored hashed, httpOnly cookies) instead of Supabase Auth. No Supabase project or credentials were available, and this keeps the app runnable and testable against any PostgreSQL, including Supabase's. Tenant isolation is still enforced in the database with RLS.
- **Forms use server actions with Zod** rather than React Hook Form. Validation lives on the server, where it has to be enforced anyway, and field errors are mapped back onto the inputs.

## Local setup

Requires Node 20.9+ (22 recommended) and PostgreSQL 14+.

```bash
cd ledgerflow
npm install                       # .npmrc sets legacy-peer-deps (eslint-config-next peer range)
cp .env.example .env.local        # fill in values

# 1. Database and a NON-superuser app role (RLS does not apply to superusers or table owners)
createdb ledgerflow
npm run db:migrate                # runs prisma migrate deploy over DIRECT_URL (the schema owner)
psql "$DIRECT_URL" -c "ALTER ROLE ledgerflow_app WITH LOGIN PASSWORD 'choose-a-password';"
#    then point DATABASE_URL at ledgerflow_app

# 2. Optional demo data (a separate, clearly fictional business)
npm run db:seed-demo

# 3. Run
npm run dev                       # http://localhost:3000
```

Demo sign-ins (password `Demo-ledgerflow-2026` for all three):

| Email | Role |
|---|---|
| `demo-owner@ledgerflow.example` | Owner / Admin |
| `demo-finance@ledgerflow.example` | Finance Manager |
| `demo-staff@ledgerflow.example` | Staff (receivables, collections, payments) |

The demo business is labelled DEMO everywhere in the UI. Its figures are produced by the same services the app uses, not hard-coded. `npm run db:seed-demo -- --new` adds another demo business. Real businesses are never touched.

### Environment variables

See `.env.example`, which documents every variable.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Runtime connection as the restricted `ledgerflow_app` role |
| `DIRECT_URL` | Migration connection as the schema owner |
| `APP_URL` | Absolute URL used in emails and invitation links |
| `NEXT_PUBLIC_APP_NAME` | Product name shown in the UI |
| `SESSION_SECRET` | 32+ characters; signs document links |
| `CRON_SECRET` | Bearer token for `/api/cron/reminders` |
| `STORAGE_DIR` | Private directory for uploaded documents (local provider) |
| `STORAGE_PROVIDER`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | Use Supabase Storage instead (required on Vercel) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM` | Optional email |
| `TEST_DATABASE_URL`, `TEST_DIRECT_URL` | Integration-test database |

## Tests and quality gates

```bash
npm run typecheck                 # tsc --noEmit (strict)
npm run lint                      # eslint (next core-web-vitals + typescript)
npm test                          # unit + integration (integration needs TEST_* DB vars)
npm run build                     # production build
BASE_URL=http://localhost:3000 npm run test:e2e   # browser acceptance against a running server
```

Integration tests run against a real PostgreSQL database as the restricted app role. They never wipe it: each test creates its own businesses, and RLS keeps them apart.

| Suite | Covers |
|---|---|
| `tests/unit/domain.test.ts` (37) | Money parsing and formatting, timezone dates, invoice status, ageing buckets, allocation rules, promise evaluation, priority scoring, reminder scheduling and backoff, permissions, CSV formula-injection escaping |
| `tests/integration/acceptance.test.ts` (17) | Acceptance scenarios 1–9 at the service and database layer, including database-level rejection of over-allocation, deletion and cross-tenant writes |
| `tests/integration/validation.test.ts` (7) | Malformed input, privilege escalation, last-owner protection, document sniffing and tenant scope, signed-link binding, append-only audit log |
| `tests/e2e/acceptance.mjs` (11 steps) | Real browser: onboarding, scenarios 1–6 and 8–10 through the UI, document upload and download, phone-width layout with no horizontal overflow |

## Deployment (Supabase + Vercel)

`npm run vercel-build` runs `prisma migrate deploy` before `next build`, so every Vercel deploy applies pending migrations.

**1. Supabase**
- In the SQL editor, create the application role before the first deploy:
  ```sql
  CREATE ROLE ledgerflow_app LOGIN PASSWORD 'a-long-random-password';
  ```
  The migrations grant it exactly what it needs. Do not use `postgres` or the `service_role` key at runtime: Row Level Security does not apply to them.
- Under Storage, create a bucket named `documents` and leave **Public** off.
- Supabase's direct host only accepts IPv6, and Vercel connects over IPv4, so use the **pooler** for both connections:
  - `DIRECT_URL` (migrations): the **session** pooler on port 5432, `postgresql://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
  - `DATABASE_URL` (runtime): the **transaction** pooler on port 6543 as the app role, `postgresql://ledgerflow_app.<ref>:<app-password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1`
- Migration `…_supabase_hardening` revokes Supabase's default `anon`/`authenticated` grants, so publishable keys cannot reach any table through the Data API.

**2. Vercel**
- Import the repository and keep the default framework settings. Set these environment variables: `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, `CRON_SECRET`, `STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET=documents`, `APP_URL` (your production URL), and optionally the `SMTP_*` and `EMAIL_FROM` variables.
- `vercel.json` schedules the reminder processor daily at 03:30 UTC (09:00 IST), the most the Hobby plan allows. On Pro, change it to hourly (`5 * * * *`). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.

**3. Other hosts:** run `npm run db:migrate`, then `npm run build && npm start`, and call `/api/cron/reminders` hourly with the bearer token (or run `npm run reminders:run`). Without Supabase Storage, set `STORAGE_DIR` to a persistent volume.

## How it works

### Database (`prisma/schema.prisma`, `prisma/migrations/*`)

- One `invoices` table holds receivable invoices and payable bills, distinguished by `direction`. Both share one tested code path for balances, allocations, reminders and documents. Payable-specific data (priority, planned payments) hangs off it.
- `counterparties` is a single record per external business with `is_customer` and `is_supplier` flags, so one business can be both without duplication.
- `payments` → `payment_allocations` → `invoices` is a many-to-many relationship with amounts. Allocations, payments and adjustments are never deleted: a database trigger forbids it, and corrections are reversals that stay visible.
- **Balances are maintained by the database.** Triggers recompute `amount_paid`, `amount_adjusted`, `outstanding_amount` and `settled_on` from active allocations and adjustments, and recompute each payment's `allocated_amount`. CHECK constraints then reject any change that would over-apply a payment, push an outstanding balance below zero, or break `outstanding = total − paid − adjusted`. Further triggers reject allocations across counterparties, directions or tenants.
- **Tenant isolation.** Every tenant table carries `business_id` and has `FORCE ROW LEVEL SECURITY` with the policy `business_id = current_setting('app.business_id')`. The app connects as `ledgerflow_app`, a non-owner, non-superuser role. Every request runs its queries inside `withTenant(businessId, …)`, which sets that value transaction-locally after the server has verified membership. Outside that wrapper, queries return no rows (fail closed). System jobs use an explicit `withSystem` bypass.
- **Audit.** `audit_logs` is append-only through a trigger and records actor, action, entity, summary and before/after values. Sensitive keys are stripped.

### Financial rules (`src/domain/*`, unit-tested)

- Money is parsed into integer paise and never handled as a float. More than two decimal places is rejected, not rounded. Display uses Indian grouping (₹1,23,456.78).
- Status is a set of facts rather than one label: lifecycle (draft/open/void), settlement (unpaid/partially paid/paid) and timing (not due/due today/overdue). An invoice is **overdue** when its balance is above zero and its due date is before today in the business's timezone. Due today is not overdue. A settled invoice is never overdue, and a disputed invoice can still be overdue.
- Ageing buckets: not yet due, due today, 1–30, 31–60, 61–90, and over 90 days past due, computed as of any date from payments dated on or before it.
- **Promises** are judged against payments allocated to the promised invoices between the date the promise was recorded and the promised date. They are never marked kept just because time passed. Partial fulfilment preserves the shortfall and asks for review, and the remainder can be carried into a new promise.
- **Priority** is a transparent rule-based score: severity of overdue, amount band, promise due today, broken promises, never contacted or time since last contact, missed follow-ups, minus points for a scheduled follow-up or a documented dispute hold. Every point is shown as a reason. Weights are configurable per business.

### Reminder processor (`src/server/reminders/processor.ts`)

Runs hourly through cron or the CLI, and on demand from Settings. Each run, per business:

1. **Plan.** Re-syncs every open invoice's stored reminder schedule (dedupe key = invoice + due date + offset). Settled, void or disabled invoices have their pending jobs cancelled. After a due-date change, old jobs are cancelled and new ones created. It then creates first-contact tasks for uncontacted overdue invoices, evaluates promises (broken → task and reminder; threshold reached → owner escalation with the facts), and handles promises due today, follow-ups due today and quiet disputes. Reminders more than 2 days late are skipped as stale, and only the latest reminder per invoice is sent.
2. **Respect quiet hours.** Outside the business's working days and hours, nothing is delivered and the jobs wait.
3. **Dispatch.** Claims jobs with `FOR UPDATE SKIP LOCKED` and a 15-minute lease, re-checks that each job is still relevant, and picks recipients (assignee; finance managers for older overdue items; owners for escalations). It writes one in-app notification per recipient, deduplicated, then sends email outside the transaction. Transient failures retry at 5 and 10 minutes, up to 3 attempts; the job then ends as `failed` and owners get a "delivery failed" notification. With no provider, email deliveries are recorded as skipped with that reason.
4. **Audit.** The run summary goes to the audit log, and every job and delivery keeps its status and reason.

Running the processor any number of times for the same period creates and sends nothing new. This is tested.

## Security notes

- Every server action and route resolves the business from the server-side session and checks membership and permission. Hiding a button is never the only control.
- Server actions get Next.js origin checks. Session cookies are httpOnly and SameSite=Lax. Security headers are set in `next.config.ts`.
- Uploads are limited to 10 MB. The type is detected from file content (PDF, PNG, JPEG, WebP). Storage keys are server-generated and checked against path traversal. Documents are served with `nosniff` and a sandboxing CSP.
- CSV exports require `exports.run` plus read permission, are audited, and neutralise spreadsheet formulas.
- Logs never contain passwords, tokens or document contents. In development only, a password-reset link is printed to the server console when email is not configured.
- This is an operational tool, not a certified accounting or GST-compliance system.

## Known limitations and next steps

- Email delivery has only been exercised against a stub provider. Connect SMTP to verify real delivery.
- There is no WhatsApp/SMS provider, telephony or call recording; click-to-call opens the device dialler.
- Customer-facing messages are sent only manually, after review. Automatic customer reminders are deliberately not enabled.
- Invoice line items are not modelled; there is a single tax amount per invoice.
- Statement "PDF" uses the browser's print to PDF.
- Staff permissions are per module; restricting staff to only their assigned accounts is not implemented.
- **Integration boundaries for future modules:**
  - Supplier GSTIN verification: needs an authorised GST data provider; attach results to `counterparties`.
  - Three-way reconciliation: purchase-order and delivery references and documents are already linked per invoice.
  - AI summaries: optional; must stay read-only over tenant-scoped queries.
