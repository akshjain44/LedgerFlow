"use server";

import { createCounterparty, updateCounterparty } from "@/server/services/counterparties";
import { fields, run, str } from "./_run";

export async function createCounterpartyAction(fd: FormData) {
  const kind = str(fd, "kind") === "supplier" ? "suppliers" : "customers";
  return run((ctx) => createCounterparty(ctx, fields(fd) as never), { message: (c) => `${c.name} saved`, redirect: (c) => `/${kind}/${c.id}` });
}

export async function updateCounterpartyAction(fd: FormData) {
  const kind = str(fd, "kind") === "supplier" ? "suppliers" : "customers";
  const id = str(fd, "id");
  return run((ctx) => updateCounterparty(ctx, id, fields(fd) as never), { message: "Account updated", redirect: `/${kind}/${id}` });
}
