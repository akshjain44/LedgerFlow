import { EmptyState, LinkButton } from "@/components/ui";

export default function Forbidden() {
  return (
    <EmptyState title="You do not have access to this area" action={<LinkButton href="/dashboard">Back to dashboard</LinkButton>}>
      Ask an owner to grant the permission in Settings → Members.
    </EmptyState>
  );
}
