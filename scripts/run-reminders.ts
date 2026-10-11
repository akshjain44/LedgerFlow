/**
 * Runs the reminder processor once for every business. Idempotent: schedule
 * it hourly with cron, systemd, GitHub Actions, etc.
 *
 *   npm run reminders:run
 */
import { prisma } from "../src/server/db";
import { runReminderProcessor } from "../src/server/reminders/processor";

runReminderProcessor()
  .then(async (results) => {
    for (const r of results) {
      console.log(
        `[reminders] ${r.businessId} today=${r.today} jobs=${r.jobsCreated} followUps=${r.followUpsCreated} dispatched=${r.dispatched} inApp=${r.inAppDelivered} email=${r.emailDelivered} failed=${r.emailFailed} skippedEmail=${r.emailSkipped}${r.deferredQuietHours ? " (delivery deferred: outside working hours)" : ""}`,
      );
    }
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("[reminders] run failed:", e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
