import "server-only";
import type { BusinessSettings, ReminderJob, Role } from "@prisma/client";
import { prisma, withTenant, type Tx } from "../db";
import { audit } from "../audit";
import { appUrl } from "../config";
import { getEmailProvider, type EmailProvider } from "../email";
import { notify } from "../services/notifications";
import { syncInvoiceReminders } from "../services/reminderJobs";
import { evaluatePromises } from "../services/promises";
import { loadSettings, paise } from "../services/common";
import { addDays, diffDays, formatDate, fromDbDate, localClock, todayIn, toDbDate } from "@/domain/dates";
import { formatINR } from "@/domain/money";
import { isStale, nextRetryAt, MAX_DELIVERY_ATTEMPTS, REMINDER_LABELS, withinWorkingHours, type ReminderType } from "@/domain/reminderSchedule";
import { effectivePermissions } from "@/domain/permissions";

export interface BusinessRunSummary {
  businessId: string;
  today: string;
  jobsCreated: number;
  followUpsCreated: number;
  promisesBroken: number;
  promisesKept: number;
  escalations: number;
  staleSkipped: number;
  dispatched: number;
  irrelevantSkipped: number;
  inAppDelivered: number;
  emailDelivered: number;
  emailFailed: number;
  emailSkipped: number;
  retriesScheduled: number;
  jobsFailed: number;
  deferredQuietHours: boolean;
}

export interface RunOptions {
  now?: Date;
  businessId?: string;
  /** Overrides the configured provider; `null` means "no provider". */
  emailProvider?: EmailProvider | null;
  /** Ignore quiet hours (manual "run now" by an admin, tests). */
  ignoreQuietHours?: boolean;
}

const LEASE_MINUTES = 15;

/**
 * The reminder processor. Safe to run any number of times: every job,
 * follow-up, notification and delivery is keyed by a dedupe key, so repeated
 * runs for the same period create nothing new and send nothing twice.
 */
export async function runReminderProcessor(opts: RunOptions = {}): Promise<BusinessRunSummary[]> {
  const now = opts.now ?? new Date();
  const businesses = await prisma.business.findMany({
    where: opts.businessId ? { id: opts.businessId } : {},
    select: { id: true },
  });
  const results: BusinessRunSummary[] = [];
  for (const b of businesses) {
    try {
      results.push(await processBusiness(b.id, now, opts));
    } catch (e) {
      // One tenant's failure must not stop the others. Log without payloads.
      console.error(`[reminders] business ${b.id} failed:`, e instanceof Error ? e.message.slice(0, 300) : "unknown error");
    }
  }
  return results;
}

async function processBusiness(businessId: string, now: Date, opts: RunOptions): Promise<BusinessRunSummary> {
  const summary = await withTenant(businessId, (tx) => planBusiness(tx, businessId, now));
  const { settings, business } = await withTenant(businessId, (tx) => loadSettings(tx, businessId));
  const clock = localClock(business.timezone, now);
  if (!opts.ignoreQuietHours && !withinWorkingHours(clock, settings)) {
    summary.deferredQuietHours = true;
  } else {
    await dispatchBusiness(businessId, now, settings, summary, opts.emailProvider === undefined ? getEmailProvider() : opts.emailProvider);
  }
  await withTenant(businessId, (tx) =>
    audit(tx, {
      businessId,
      actorUserId: null,
      action: "reminders.run",
      entityType: "system",
      summary: `Reminder run: ${summary.jobsCreated} jobs, ${summary.followUpsCreated} follow-ups, ${summary.dispatched} dispatched, ${summary.emailFailed} email failures${summary.deferredQuietHours ? ", delivery deferred (outside working hours)" : ""}`,
      after: summary,
    }),
  );
  return summary;
}

// ---------------------------------------------------------------- phase A: plan

async function planBusiness(tx: Tx, businessId: string, now: Date): Promise<BusinessRunSummary> {
  const { business, settings } = await loadSettings(tx, businessId);
  const today = todayIn(business.timezone, now);
  const summary: BusinessRunSummary = {
    businessId, today, jobsCreated: 0, followUpsCreated: 0, promisesBroken: 0, promisesKept: 0, escalations: 0, staleSkipped: 0,
    dispatched: 0, irrelevantSkipped: 0, inAppDelivered: 0, emailDelivered: 0, emailFailed: 0, emailSkipped: 0, retriesScheduled: 0, jobsFailed: 0, deferredQuietHours: false,
  };
  const jobsBefore = await tx.reminderJob.count();
  const followUpsBefore = await tx.followUp.count();

  // 1. Every open invoice has an up-to-date reminder schedule (covers imports and due-date edits).
  const open = await tx.invoice.findMany({
    where: { lifecycle: "open" },
    select: { id: true, direction: true, dueDate: true, outstandingAmount: true, counterpartyId: true, assignedUserId: true, invoiceNumber: true },
  });
  for (const inv of open) await syncInvoiceReminders(tx, businessId, inv.id, today, settings);
  // Invoices settled/voided since the last run: sync() above only sees open ones.
  const stalePendingForClosed = await tx.reminderJob.findMany({
    where: { status: "pending", invoiceId: { not: null }, invoice: { OR: [{ lifecycle: { not: "open" } }, { outstandingAmount: { lte: 0 } }] } },
    select: { invoiceId: true },
    distinct: ["invoiceId"],
  });
  for (const j of stalePendingForClosed) await syncInvoiceReminders(tx, businessId, j.invoiceId!, today, settings);

  // 2. First-contact task for every overdue receivable nobody has contacted since it fell due.
  for (const inv of open) {
    if (inv.direction !== "receivable" || paise(inv.outstandingAmount) <= 0n) continue;
    const due = fromDbDate(inv.dueDate);
    if (due >= today) continue;
    const contacted = await tx.communicationInvoice.findFirst({
      where: { invoiceId: inv.id, communication: { contactedAt: { gte: toDbDate(addDays(due, 1)) } } },
      select: { communicationId: true },
    });
    if (contacted) continue;
    const pending = await tx.followUp.findFirst({ where: { invoiceId: inv.id, status: "pending" }, select: { id: true } });
    if (pending) continue;
    await tx.followUp.createMany({
      data: [{
        businessId,
        counterpartyId: inv.counterpartyId,
        invoiceId: inv.id,
        type: "call",
        title: `First contact: ${inv.invoiceNumber} is overdue`,
        dueDate: toDbDate(today),
        assignedUserId: inv.assignedUserId,
        source: "system_overdue",
        priority: "high",
        dedupeKey: `overdue:${inv.id}:${due}`,
      }],
      skipDuplicates: true,
    });
  }

  // 3. Promises: evaluate against actual payments; raise broken / due-today / escalation.
  const transitions = await evaluatePromises(tx, { businessId, timezone: business.timezone, today, actorUserId: null });
  for (const t of transitions) {
    if (t.to === "kept" || t.to === "partially_kept") summary.promisesKept++;
    if (t.to !== "broken") continue;
    summary.promisesBroken++;
    const p = t.promise;
    const cp = await tx.counterparty.findUniqueOrThrow({ where: { id: p.counterpartyId }, select: { name: true, assignedUserId: true } });
    await tx.reminderJob.createMany({
      data: [{ businessId, type: "promise_broken", dedupeKey: `promise_broken:${p.id}`, scheduledFor: toDbDate(today), promiseId: p.id, counterpartyId: p.counterpartyId }],
      skipDuplicates: true,
    });
    await tx.followUp.createMany({
      data: [{
        businessId,
        counterpartyId: p.counterpartyId,
        type: "call",
        title: `Broken promise: ${cp.name} did not pay ${formatINR(paise(p.amount))} due ${formatDate(p.promisedDate)}`,
        dueDate: toDbDate(today),
        assignedUserId: cp.assignedUserId,
        source: "system_promise",
        priority: "high",
        dedupeKey: `promise_broken:${p.id}`,
      }],
      skipDuplicates: true,
    });
    // Escalation: N broken promises within the window → owner review.
    const windowStart = toDbDate(addDays(today, -settings.brokenPromiseWindowDays));
    const broken = await tx.paymentPromise.findMany({
      where: { counterpartyId: p.counterpartyId, status: "broken", promisedDate: { gte: windowStart } },
      orderBy: { promisedDate: "asc" },
    });
    if (broken.length >= settings.brokenPromiseThreshold) {
      summary.escalations++;
      const owner = await tx.membership.findFirst({ where: { businessId, role: "owner", status: "active" }, orderBy: { createdAt: "asc" } });
      const facts = broken.map((b) => `${formatINR(paise(b.amount))} promised for ${formatDate(b.promisedDate)}, received ${formatINR(paise(b.amountReceived))}`).join("; ");
      await tx.followUp.createMany({
        data: [{
          businessId,
          counterpartyId: p.counterpartyId,
          type: "escalation",
          title: `Owner review: ${cp.name} has ${broken.length} broken payment promises`,
          details: `Facts: ${facts}. Consider reviewing credit terms, credit limit or future order conditions. This is a review prompt, not an automatic decision.`,
          dueDate: toDbDate(today),
          assignedUserId: owner?.userId ?? null,
          source: "escalation",
          priority: "urgent",
          dedupeKey: `escalation:${p.counterpartyId}:${p.id}`,
        }],
        skipDuplicates: true,
      });
      await tx.reminderJob.createMany({
        data: [{ businessId, type: "promise_repeated_broken", dedupeKey: `escalation:${p.id}`, scheduledFor: toDbDate(today), promiseId: p.id, counterpartyId: p.counterpartyId }],
        skipDuplicates: true,
      });
    }
  }
  const dueToday = await tx.paymentPromise.findMany({ where: { status: "upcoming", promisedDate: toDbDate(today) }, select: { id: true, counterpartyId: true } });
  if (dueToday.length) {
    await tx.reminderJob.createMany({
      data: dueToday.map((p) => ({ businessId, type: "promise_due_today", dedupeKey: `promise_due:${p.id}:${today}`, scheduledFor: toDbDate(today), promiseId: p.id, counterpartyId: p.counterpartyId })),
      skipDuplicates: true,
    });
  }

  // 4. Follow-ups due today.
  const fus = await tx.followUp.findMany({ where: { status: "pending", dueDate: toDbDate(today) }, select: { id: true, counterpartyId: true, invoiceId: true } });
  if (fus.length) {
    await tx.reminderJob.createMany({
      data: fus.map((f) => ({ businessId, type: "followup_due", dedupeKey: `followup:${f.id}:${today}`, scheduledFor: toDbDate(today), followUpId: f.id, counterpartyId: f.counterpartyId, invoiceId: f.invoiceId })),
      skipDuplicates: true,
    });
  }

  // 5. Disputes without activity for N days need review (at most weekly per dispute).
  const quietSince = new Date(now.getTime() - settings.disputeReviewDays * 86_400_000);
  const quiet = await tx.dispute.findMany({
    where: { status: { notIn: ["resolved", "closed"] }, lastActivityAt: { lt: quietSince } },
    select: { id: true, counterpartyId: true, invoiceId: true, raisedOn: true },
  });
  if (quiet.length) {
    await tx.reminderJob.createMany({
      data: quiet.map((d) => ({
        businessId,
        type: "dispute_review",
        dedupeKey: `dispute_review:${d.id}:w${Math.floor(diffDays(fromDbDate(d.raisedOn), today) / 7)}`,
        scheduledFor: toDbDate(today),
        disputeId: d.id,
        counterpartyId: d.counterpartyId,
        invoiceId: d.invoiceId,
      })),
      skipDuplicates: true,
    });
  }

  // 6. Pending jobs older than the catch-up window are skipped, not sent late.
  const pendingOld = await tx.reminderJob.findMany({ where: { status: "pending", scheduledFor: { lt: toDbDate(today) } }, select: { id: true, scheduledFor: true } });
  const staleIds = pendingOld.filter((j) => isStale(fromDbDate(j.scheduledFor), today)).map((j) => j.id);
  if (staleIds.length) {
    await tx.reminderJob.updateMany({ where: { id: { in: staleIds } }, data: { status: "skipped", statusReason: "Stale: missed its delivery window", processedAt: now } });
    summary.staleSkipped = staleIds.length;
  }

  // 7. One reminder per invoice per run: when several scheduled reminders for
  // the same invoice are due (new or imported invoice, outage), send only the
  // most recent and mark the others superseded.
  const dueInvoiceJobs = await tx.reminderJob.findMany({
    where: { status: "pending", invoiceId: { not: null }, scheduledFor: { lte: toDbDate(today) }, type: { in: ["receivable_upcoming", "receivable_due_today", "receivable_overdue", "payable_upcoming", "payable_overdue"] } },
    select: { id: true, invoiceId: true, scheduledFor: true },
    orderBy: { scheduledFor: "desc" },
  });
  const keep = new Set<string>();
  const superseded: string[] = [];
  for (const j of dueInvoiceJobs) {
    if (keep.has(j.invoiceId!)) superseded.push(j.id);
    else keep.add(j.invoiceId!);
  }
  if (superseded.length) {
    await tx.reminderJob.updateMany({ where: { id: { in: superseded } }, data: { status: "skipped", statusReason: "Superseded by a later reminder for the same invoice", processedAt: now } });
    summary.staleSkipped += superseded.length;
  }

  summary.jobsCreated = (await tx.reminderJob.count()) - jobsBefore;
  summary.followUpsCreated = (await tx.followUp.count()) - followUpsBefore;
  return summary;
}

// ---------------------------------------------------------------- phase B: dispatch

interface Member {
  userId: string;
  role: Role;
  email: string;
  name: string;
  permissions: Set<string>;
}

async function claimJobs(businessId: string, today: string, now: Date): Promise<string[]> {
  return withTenant(businessId, async (tx) => {
    const lease = new Date(now.getTime() + LEASE_MINUTES * 60_000);
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE reminder_jobs SET status = 'processing', attempts = attempts + 1, next_attempt_at = ${lease}
      WHERE id IN (
        SELECT id FROM reminder_jobs
        WHERE business_id = ${businessId}::uuid
          AND scheduled_for <= ${toDbDate(today)}
          AND (
            (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
            OR (status = 'processing' AND next_attempt_at <= ${now})
          )
        ORDER BY scheduled_for, created_at
        LIMIT 500
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;
    return rows.map((r) => r.id);
  });
}

async function dispatchBusiness(businessId: string, now: Date, settings: BusinessSettings, summary: BusinessRunSummary, provider: EmailProvider | null) {
  const today = summary.today;
  const jobIds = await claimJobs(businessId, today, now);
  const members: Member[] = (
    await prisma.membership.findMany({ where: { businessId, status: "active" }, include: { user: { select: { email: true, name: true, isActive: true } } } })
  )
    .filter((m) => m.user.isActive)
    .map((m) => ({ userId: m.userId, role: m.role, email: m.user.email, name: m.user.name, permissions: effectivePermissions(m.role, m.permissions) as Set<string> }));

  for (const jobId of jobIds) {
    summary.dispatched++;
    // Step 1 (transaction): relevance check, recipients, in-app notifications, delivery rows.
    const prepared = await withTenant(businessId, async (tx) => {
      const job = await tx.reminderJob.findUniqueOrThrow({ where: { id: jobId } });
      const content = await buildContent(tx, job, today, settings);
      if (!content) {
        // Became irrelevant between planning and dispatch (paid, cancelled, completed...).
        await tx.reminderJob.update({ where: { id: jobId }, data: { status: "skipped", statusReason: "No longer applicable at dispatch", processedAt: now, nextAttemptAt: null } });
        summary.irrelevantSkipped++;
        return null;
      }
      const recipients = pickRecipients(members, content);
      if (recipients.length === 0) {
        await tx.reminderJob.update({ where: { id: jobId }, data: { status: "skipped", statusReason: "No eligible recipient", processedAt: now, nextAttemptAt: null } });
        return null;
      }
      for (const r of recipients) {
        // In-app: idempotent through the notification dedupe key + delivery unique key.
        const existing = await tx.reminderDelivery.findUnique({ where: { jobId_channel_recipientUserId: { jobId, channel: "in_app", recipientUserId: r.userId } } });
        if (!existing || existing.status !== "delivered") {
          const { notification, created } = await notify(tx, {
            businessId,
            userId: r.userId,
            category: job.type,
            priority: content.priority,
            title: content.title,
            body: content.body,
            link: content.link,
            entityType: content.entityType,
            entityId: content.entityId,
            dedupeKey: `job:${jobId}`,
          });
          await tx.reminderDelivery.upsert({
            where: { jobId_channel_recipientUserId: { jobId, channel: "in_app", recipientUserId: r.userId } },
            create: { businessId, jobId, channel: "in_app", recipientUserId: r.userId, status: "delivered", attempts: 1, deliveredAt: now, notificationId: notification.id },
            update: { status: "delivered", deliveredAt: now, notificationId: notification.id, attempts: { increment: 1 } },
          });
          if (created) summary.inAppDelivered++;
        }
        if (settings.emailNotificationsEnabled) {
          await tx.reminderDelivery.upsert({
            where: { jobId_channel_recipientUserId: { jobId, channel: "email", recipientUserId: r.userId } },
            create: { businessId, jobId, channel: "email", recipientUserId: r.userId, status: "pending" },
            update: {},
          });
        }
      }
      const emailDeliveries = await tx.reminderDelivery.findMany({ where: { jobId, channel: "email", status: { in: ["pending", "failed"] } } });
      return { job, content, emailDeliveries };
    });
    if (!prepared) continue;

    // Step 2 (outside any transaction): send emails.
    const results: { id: string; status: "delivered" | "failed" | "skipped"; reason?: string; transient?: boolean }[] = [];
    for (const d of prepared.emailDeliveries) {
      const member = members.find((m) => m.userId === d.recipientUserId);
      if (!provider) {
        results.push({ id: d.id, status: "skipped", reason: "Email provider not configured" });
        continue;
      }
      if (!member) {
        results.push({ id: d.id, status: "skipped", reason: "Recipient no longer a member" });
        continue;
      }
      const r = await provider.send({
        to: member.email,
        subject: `[${REMINDER_LABELS[prepared.job.type as ReminderType] ?? "Reminder"}] ${prepared.content.title}`,
        text: `${prepared.content.body}\n\nOpen: ${appUrl()}${prepared.content.link}\n\nYou receive this because you are responsible for this account. Notification settings: ${appUrl()}/settings`,
      });
      results.push(r.ok ? { id: d.id, status: "delivered" } : { id: d.id, status: "failed", reason: r.error, transient: r.transient });
    }

    // Step 3 (transaction): record outcomes, decide retry / completion.
    await withTenant(businessId, async (tx) => {
      for (const r of results) {
        await tx.reminderDelivery.update({
          where: { id: r.id },
          data: {
            status: r.status,
            statusReason: r.reason ?? null,
            lastError: r.status === "failed" ? r.reason ?? null : null,
            attempts: { increment: r.status === "skipped" ? 0 : 1 },
            deliveredAt: r.status === "delivered" ? now : null,
          },
        });
        if (r.status === "delivered") summary.emailDelivered++;
        if (r.status === "failed") summary.emailFailed++;
        if (r.status === "skipped") summary.emailSkipped++;
      }
      const job = await tx.reminderJob.findUniqueOrThrow({ where: { id: jobId } });
      const retryable = results.filter((r) => r.status === "failed" && r.transient);
      const permanent = results.filter((r) => r.status === "failed" && !r.transient);
      if (retryable.length > 0) {
        const retryAt = nextRetryAt(job.attempts, now);
        if (retryAt) {
          await tx.reminderJob.update({ where: { id: jobId }, data: { status: "pending", nextAttemptAt: retryAt, lastError: retryable[0].reason?.slice(0, 300) ?? null, statusReason: `Email retry ${job.attempts}/${MAX_DELIVERY_ATTEMPTS} scheduled` } });
          summary.retriesScheduled++;
          return;
        }
      }
      if (retryable.length > 0 || permanent.length > 0) {
        await tx.reminderJob.update({
          where: { id: jobId },
          data: { status: "failed", processedAt: now, nextAttemptAt: null, lastError: (retryable[0] ?? permanent[0]).reason?.slice(0, 300) ?? null, statusReason: "In-app delivered; email delivery failed" },
        });
        summary.jobsFailed++;
        // Tell the owners a reminder could not be emailed (in-app only, so it cannot loop).
        for (const owner of members.filter((m) => m.role === "owner")) {
          await notify(tx, {
            businessId,
            userId: owner.userId,
            category: "delivery_failure",
            priority: "high",
            title: `Reminder email could not be delivered: ${prepared.content.title}`,
            body: `Reason: ${(retryable[0] ?? permanent[0]).reason ?? "unknown"}. The in-app notification was delivered. Check Settings → Integrations.`,
            link: "/settings/integrations",
            dedupeKey: `delivery_failure:${jobId}`,
          });
        }
        return;
      }
      const skippedEmail = results.some((r) => r.status === "skipped");
      await tx.reminderJob.update({
        where: { id: jobId },
        data: { status: "completed", processedAt: now, nextAttemptAt: null, lastError: null, statusReason: skippedEmail ? "In-app delivered; email skipped (provider not configured)" : "Delivered" },
      });
    });
  }
}

// ---------------------------------------------------------------- content & recipients

interface Content {
  title: string;
  body: string;
  link: string;
  priority: "low" | "normal" | "high" | "urgent";
  entityType: string;
  entityId: string | null;
  module: "receivables" | "payables";
  assignedUserId: string | null;
  audience: "assignee" | "assignee+finance" | "owners+finance";
}

/** Builds notification content, or returns null when the job is no longer relevant. */
async function buildContent(tx: Tx, job: ReminderJob, today: string, settings: BusinessSettings): Promise<Content | null> {
  const type = job.type as ReminderType;
  if (job.invoiceId && ["receivable_upcoming", "receivable_due_today", "receivable_overdue", "payable_upcoming", "payable_overdue"].includes(type)) {
    const inv = await tx.invoice.findUnique({ where: { id: job.invoiceId }, include: { counterparty: { select: { name: true, assignedUserId: true } } } });
    if (!inv || inv.lifecycle !== "open" || paise(inv.outstandingAmount) <= 0n || !inv.remindersEnabled) return null;
    if (job.dueDateSnapshot && fromDbDate(job.dueDateSnapshot) !== fromDbDate(inv.dueDate)) return null;
    const due = fromDbDate(inv.dueDate);
    const days = diffDays(due, today);
    const amount = formatINR(paise(inv.outstandingAmount));
    const receivable = inv.direction === "receivable";
    const when = days < 0 ? `due in ${-days} day${days === -1 ? "" : "s"} (${formatDate(due)})` : days === 0 ? "due today" : `${days} day${days === 1 ? "" : "s"} overdue (due ${formatDate(due)})`;
    return {
      title: receivable ? `${inv.counterparty.name}: ${inv.invoiceNumber} ${when}` : `Pay ${inv.counterparty.name}: bill ${inv.invoiceNumber} ${when}`,
      body: receivable
        ? `${amount} outstanding on invoice ${inv.invoiceNumber}. ${days > 0 ? "Call the customer and record the outcome." : "Check the customer has what they need to pay on time."}`
        : `${amount} outstanding to ${inv.counterparty.name} on bill ${inv.invoiceNumber}. Schedule or record the payment.`,
      link: `/${receivable ? "receivables" : "payables"}/${inv.id}`,
      priority: days > 30 ? "urgent" : days > 0 ? "high" : "normal",
      entityType: "invoice",
      entityId: inv.id,
      module: receivable ? "receivables" : "payables",
      assignedUserId: inv.assignedUserId ?? inv.counterparty.assignedUserId,
      audience: receivable && days >= settings.financeManagerOverdueDays ? "assignee+finance" : "assignee",
    };
  }
  if (type === "promise_due_today" || type === "promise_broken" || type === "promise_repeated_broken") {
    const p = job.promiseId ? await tx.paymentPromise.findUnique({ where: { id: job.promiseId }, include: { counterparty: { select: { name: true, assignedUserId: true } } } }) : null;
    if (!p) return null;
    if (type === "promise_due_today" && p.status !== "upcoming") return null;
    if (type !== "promise_due_today" && p.status !== "broken") return null;
    const amount = formatINR(paise(p.amount));
    if (type === "promise_due_today") {
      return { title: `${p.counterparty.name} promised ${amount} today`, body: `Confirm the payment and record it when received. Reason given: ${p.reason ?? "—"}.`, link: `/customers/${p.counterpartyId}`, priority: "high", entityType: "promise", entityId: p.id, module: "receivables", assignedUserId: p.counterparty.assignedUserId, audience: "assignee" };
    }
    if (type === "promise_broken") {
      return { title: `Broken promise: ${p.counterparty.name}`, body: `${amount} was promised for ${formatDate(p.promisedDate)}; ${formatINR(paise(p.amountReceived))} was recorded by that date. Call to get a new commitment.`, link: `/customers/${p.counterpartyId}`, priority: "high", entityType: "promise", entityId: p.id, module: "receivables", assignedUserId: p.counterparty.assignedUserId, audience: "assignee" };
    }
    return { title: `Owner review needed: ${p.counterparty.name} has repeated broken promises`, body: `The broken-promise threshold (${settings.brokenPromiseThreshold}) was reached. Review the account facts and decide on credit terms or order conditions.`, link: `/customers/${p.counterpartyId}`, priority: "urgent", entityType: "counterparty", entityId: p.counterpartyId, module: "receivables", assignedUserId: null, audience: "owners+finance" };
  }
  if (type === "followup_due") {
    const f = job.followUpId ? await tx.followUp.findUnique({ where: { id: job.followUpId }, include: { counterparty: { select: { name: true, isCustomer: true } } } }) : null;
    if (!f || f.status !== "pending") return null;
    return { title: `Follow-up today: ${f.title}`, body: `Scheduled ${f.type} with ${f.counterparty.name}. ${f.details ?? ""}`.trim(), link: `/follow-ups?tab=tasks`, priority: f.priority, entityType: "followup", entityId: f.id, module: f.counterparty.isCustomer ? "receivables" : "payables", assignedUserId: f.assignedUserId, audience: f.type === "escalation" ? "owners+finance" : "assignee" };
  }
  if (type === "planned_payment_due") {
    const pp = job.plannedPaymentId ? await tx.plannedPayment.findUnique({ where: { id: job.plannedPaymentId }, include: { invoice: { include: { counterparty: { select: { name: true } } } } } }) : null;
    if (!pp || pp.status !== "scheduled" || paise(pp.invoice.outstandingAmount) <= 0n) return null;
    return { title: `Planned payment today: ${formatINR(paise(pp.amount))} to ${pp.invoice.counterparty.name}`, body: `Bill ${pp.invoice.invoiceNumber}. This is a plan, not a payment — record the payment once it has actually been made.`, link: `/payables/${pp.invoiceId}`, priority: pp.promisedToSupplier ? "high" : "normal", entityType: "invoice", entityId: pp.invoiceId, module: "payables", assignedUserId: pp.invoice.assignedUserId, audience: "assignee" };
  }
  if (type === "dispute_review") {
    const d = job.disputeId ? await tx.dispute.findUnique({ where: { id: job.disputeId }, include: { invoice: { select: { invoiceNumber: true, direction: true } }, counterparty: { select: { name: true } } } }) : null;
    if (!d || d.status === "resolved" || d.status === "closed") return null;
    return { title: `Dispute needs review: ${d.counterparty.name} · ${d.invoice.invoiceNumber}`, body: `No activity for ${settings.disputeReviewDays}+ days (status: ${d.status.replace(/_/g, " ")}).`, link: `/${d.invoice.direction === "receivable" ? "receivables" : "payables"}/${d.invoiceId}`, priority: "normal", entityType: "dispute", entityId: d.id, module: d.invoice.direction === "receivable" ? "receivables" : "payables", assignedUserId: d.assignedUserId, audience: "assignee+finance" };
  }
  return null;
}

function pickRecipients(members: Member[], c: Content): Member[] {
  const canSee = (m: Member) => m.permissions.has(c.module === "receivables" ? "receivables.view" : "payables.view");
  const finance = members.filter((m) => (m.role === "finance_manager" || m.role === "owner") && canSee(m));
  const set = new Map<string, Member>();
  if (c.audience === "owners+finance") {
    for (const m of finance) set.set(m.userId, m);
  } else {
    const assignee = members.find((m) => m.userId === c.assignedUserId && canSee(m));
    if (assignee) set.set(assignee.userId, assignee);
    // Unassigned work goes to the people accountable for it.
    if (!assignee || c.audience === "assignee+finance") {
      const fm = finance.filter((m) => m.role === "finance_manager");
      for (const m of fm.length ? fm : finance) set.set(m.userId, m);
    }
  }
  return [...set.values()];
}
