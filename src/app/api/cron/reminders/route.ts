import { timingSafeEqual } from "node:crypto";
import { runReminderProcessor } from "@/server/reminders/processor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Scheduled entry point for the reminder processor. Idempotent; safe to call repeatedly. */
export async function GET(req: Request) {
  if (!authorised(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const results = await runReminderProcessor();
  return Response.json({
    ok: true,
    businesses: results.length,
    jobsCreated: results.reduce((a, r) => a + r.jobsCreated, 0),
    dispatched: results.reduce((a, r) => a + r.dispatched, 0),
    inAppDelivered: results.reduce((a, r) => a + r.inAppDelivered, 0),
    emailDelivered: results.reduce((a, r) => a + r.emailDelivered, 0),
    emailFailed: results.reduce((a, r) => a + r.emailFailed, 0),
    deferred: results.filter((r) => r.deferredQuietHours).length,
  });
}

export const POST = GET;
