import { requireTenant } from "@/server/context";
import { withTenant } from "@/server/db";
import { Badge, Card, Table, Td, Th } from "@/components/ui";
import { DateText } from "@/components/format";
import { ConfirmAction, Dialog } from "@/components/forms";
import { InviteForm, MemberEditForm } from "@/components/SettingsForms";
import { revokeInviteAction } from "@/actions/settings";
import { ROLE_LABELS, effectivePermissions, PERMISSIONS } from "@/domain/permissions";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  const ctx = await requireTenant();
  const canManage = ctx.permissions.has("members.manage");
  const [members, invites] = await withTenant(ctx.businessId, (tx) =>
    Promise.all([
      tx.membership.findMany({ where: { businessId: ctx.businessId }, include: { user: { select: { name: true, email: true, lastLoginAt: true } } }, orderBy: { createdAt: "asc" } }),
      canManage ? tx.invitation.findMany({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    ]),
  );
  return (
    <div className="space-y-5">
      {canManage && (
        <Card title="Invite a team member" description="Owners have full access. Finance managers handle all financial records and reports. Staff get only the permissions you tick.">
          <InviteForm isOwner={ctx.role === "owner"} />
        </Card>
      )}
      <Card title="Members" padded={false}>
        <Table>
          <thead><tr><Th>Name</Th><Th>Role</Th><Th>Status</Th><Th>Access</Th><Th>Last sign-in</Th>{canManage && <Th />}</tr></thead>
          <tbody>
            {members.map((m) => {
              const eff = [...effectivePermissions(m.role, m.permissions)];
              return (
                <tr key={m.id}>
                  <Td><span className="font-medium">{m.user.name}</span>{m.userId === ctx.userId && <span className="text-muted"> (you)</span>}<span className="block text-[12px] text-muted">{m.user.email}</span></Td>
                  <Td>{ROLE_LABELS[m.role]}</Td>
                  <Td><Badge tone={m.status === "active" ? "ok" : "neutral"}>{m.status}</Badge></Td>
                  <Td className="max-w-[360px] text-[12px] text-muted">{m.role === "staff" ? eff.map((p) => PERMISSIONS[p]).join(" · ") || "No access" : m.role === "owner" ? "Everything" : "All financial records and reports; not settings or members"}</Td>
                  <Td>{m.user.lastLoginAt ? <DateText value={m.user.lastLoginAt} /> : "—"}</Td>
                  {canManage && <Td>{m.userId !== ctx.userId && <Dialog trigger="Edit" title={`Edit ${m.user.name}`} triggerSize="sm"><MemberEditForm m={{ id: m.id, role: m.role, status: m.status, permissions: m.permissions }} canEditOwner={ctx.role === "owner"} /></Dialog>}</Td>}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      {canManage && invites.length > 0 && (
        <Card title="Pending invitations" padded={false}>
          <ul className="divide-y divide-line">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
                <span>{i.email} · {ROLE_LABELS[i.role]} <span className="text-muted">· expires <DateText value={i.expiresAt} /></span></span>
                <ConfirmAction action={revokeInviteAction} hidden={{ id: i.id }} label="Revoke" title="Revoke invitation?" description="The link stops working immediately." variant="ghost" />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
