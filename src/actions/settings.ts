"use server";

import { updateBusiness, updateReminderSettings, updateFinancialSettings, inviteMember, revokeInvitation, updateMember } from "@/server/services/business";
import { runReminderProcessor } from "@/server/reminders/processor";
import { assertCan } from "@/server/context";
import { fields, list, run, str } from "./_run";

export async function updateBusinessAction(fd: FormData) {
  return run((ctx) => updateBusiness(ctx, fields(fd) as never), { message: "Business details saved" });
}

export async function updateRemindersAction(fd: FormData) {
  return run((ctx) => updateReminderSettings(ctx, ({ ...fields(fd), workingDays: list(fd, "workingDays") } as never)), { message: "Reminder settings saved" });
}

export async function updateFinancialAction(fd: FormData) {
  return run((ctx) => updateFinancialSettings(ctx, fields(fd) as never), { message: "Financial settings saved" });
}

export async function inviteMemberAction(fd: FormData) {
  return run((ctx) => inviteMember(ctx, { email: str(fd, "email"), role: str(fd, "role") as never, permissions: list(fd, "permissions") }), {
    message: (r) => (r.emailed ? "Invitation emailed" : "Invitation created — copy the link below"),
  });
}

export async function revokeInviteAction(fd: FormData) {
  return run((ctx) => revokeInvitation(ctx, str(fd, "id")), { message: "Invitation revoked" });
}

export async function updateMemberAction(fd: FormData) {
  return run((ctx) => updateMember(ctx, str(fd, "id"), { role: str(fd, "role"), permissions: list(fd, "permissions"), status: str(fd, "status") }), { message: "Member updated" });
}

/** Manual "run now" for admins. Same idempotent processor as the scheduled job. */
export async function runRemindersNowAction() {
  return run(
    async (ctx) => {
      assertCan(ctx, "settings.manage");
      const [r] = await runReminderProcessor({ businessId: ctx.businessId, ignoreQuietHours: true });
      return r;
    },
    { message: (r) => (r ? `Reminder run complete: ${r.jobsCreated} new jobs, ${r.dispatched} dispatched, ${r.inAppDelivered} notifications, ${r.emailFailed} email failures` : "Reminder run complete") },
  );
}
