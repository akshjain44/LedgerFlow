"use client";

import { ActionForm, SubmitButton } from "./forms";
import { bulkAssignAction, bulkFollowUpAction } from "@/actions/bulk";

/** Row checkboxes elsewhere on the page join these forms via the `form` attribute. */
export function BulkBar({ direction, members, today, canManage, canWork }: { direction: string; members: { id: string; name: string }[]; today: string; canManage: boolean; canWork: boolean }) {
  return (
    <div className="no-print flex flex-wrap items-center gap-3 border-b border-line bg-[#fafaf7] px-3 py-2 text-[13px]">
      <span className="text-muted">With selected:</span>
      {canManage && (
        <ActionForm action={bulkAssignAction} id="bulk-assign" className="flex items-center gap-1.5">
          <input type="hidden" name="direction" value={direction} />
          <label htmlFor="assignTo" className="sr-only">Assign to</label>
          <select id="assignTo" name="assignTo" className="h-8 rounded-md border border-line-strong bg-surface px-2" defaultValue="">
            <option value="" disabled>Assign to…</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <SubmitButton size="sm" variant="secondary">Assign</SubmitButton>
        </ActionForm>
      )}
      {canWork && direction === "receivable" && (
        <ActionForm action={bulkFollowUpAction} id="bulk-followup" className="flex items-center gap-1.5">
          <label htmlFor="bulkDue" className="sr-only">Follow-up date</label>
          <input id="bulkDue" type="date" name="dueDate" defaultValue={today} className="h-8 rounded-md border border-line-strong bg-surface px-2" />
          <SubmitButton size="sm" variant="secondary">Schedule call</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}

/** Checkbox that belongs to every bulk form at once (selection is duplicated into each form). */
export function RowSelect({ id, label }: { id: string; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="h-4 w-4 accent-[var(--color-accent)]"
      onChange={(e) => {
        for (const formId of ["bulk-assign", "bulk-followup"]) {
          const form = document.getElementById(formId) as HTMLFormElement | null;
          if (!form) continue;
          const existing = form.querySelector(`input[name="ids"][value="${id}"]`);
          if (e.target.checked && !existing) {
            const h = document.createElement("input");
            h.type = "hidden";
            h.name = "ids";
            h.value = id;
            form.appendChild(h);
          } else if (!e.target.checked && existing) existing.remove();
        }
      }}
    />
  );
}
