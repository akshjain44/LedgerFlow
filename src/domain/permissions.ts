export type Role = "owner" | "finance_manager" | "staff";

export const PERMISSIONS = {
  "receivables.view": "View receivables and customers",
  "receivables.manage": "Create and edit receivable invoices and customers",
  "payables.view": "View payables and suppliers",
  "payables.manage": "Create and edit supplier bills and suppliers",
  "payments.record": "Record payments and allocations",
  "payments.reverse": "Reverse payments, allocations and adjustments",
  "invoices.void": "Void invoices and bills",
  "invoices.override_duplicate": "Override duplicate invoice-number checks",
  "collections.work": "Log calls, promises, follow-ups and disputes",
  "reports.view": "View reports and the cash-flow outlook",
  "exports.run": "Export data as CSV",
  "imports.run": "Import CSV data",
  "documents.manage": "Upload and remove documents",
  "settings.manage": "Change business settings",
  "members.manage": "Invite members and change roles",
  "audit.view": "View the audit log",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const FINANCE_MANAGER: Permission[] = ALL_PERMISSIONS.filter((p) => p !== "settings.manage" && p !== "members.manage");

/** Sensible default grants for a new staff member; owners can change them. */
export const DEFAULT_STAFF_PERMISSIONS: Permission[] = [
  "receivables.view",
  "collections.work",
  "documents.manage",
];

export function effectivePermissions(role: Role, granted: string[]): Set<Permission> {
  if (role === "owner") return new Set(ALL_PERMISSIONS);
  if (role === "finance_manager") return new Set(FINANCE_MANAGER);
  return new Set(granted.filter((p): p is Permission => p in PERMISSIONS && p !== "settings.manage" && p !== "members.manage"));
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner / Admin",
  finance_manager: "Finance Manager",
  staff: "Staff",
};
