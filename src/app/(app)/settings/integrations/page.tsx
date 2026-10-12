import { requireTenant } from "@/server/context";
import { emailConfigStatus } from "@/server/email";
import { storageStatus } from "@/server/storage";
import { Badge, Card } from "@/components/ui";

export const metadata = { title: "Integrations" };

function Row({ name, status, tone, children }: { name: string; status: string; tone: "ok" | "warn" | "neutral"; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line py-3 last:border-0">
      <div className="max-w-2xl">
        <p className="font-medium">{name}</p>
        <div className="mt-0.5 text-[13px] text-muted">{children}</div>
      </div>
      <Badge tone={tone}>{status}</Badge>
    </div>
  );
}

export default async function IntegrationsPage() {
  await requireTenant();
  const email = emailConfigStatus();
  const storage = storageStatus();
  const cron = !!process.env.CRON_SECRET;
  return (
    <Card title="Integrations" description="Secrets are never shown here. Configure them as server environment variables (see .env.example).">
      <Row name="Email (SMTP)" status={email.configured ? "Configured" : "Not configured"} tone={email.configured ? "ok" : "warn"}>
        {email.configured ? <>Sending through {email.host}. Failures are recorded per delivery and retried up to 3 times.</> : <>Set {email.missing.join(", ")} (and SMTP_USER / SMTP_PASSWORD if required). Until then, reminders are in-app only and email deliveries are recorded as “skipped: email provider not configured”.</>}
      </Row>
      <Row name="Scheduled reminder processor" status={cron ? "Endpoint protected" : "CRON_SECRET missing"} tone={cron ? "ok" : "warn"}>
        Call <code>GET /api/cron/reminders</code> with <code>Authorization: Bearer $CRON_SECRET</code> every hour (vercel.json includes a schedule), or run <code>npm run reminders:run</code> from any scheduler.
      </Row>
      <Row name="Document storage" status={storage.missing.length ? "Misconfigured" : storage.provider} tone={storage.missing.length ? "warn" : "ok"}>
        {storage.missing.length ? <>Set {storage.missing.join(", ")}.</> : <>Files are stored in {storage.dir} and served only through time-limited signed links after a membership check.</>} On serverless hosts (Vercel) set <code>STORAGE_PROVIDER=supabase</code> with a private Supabase bucket; the local directory is not persistent there.
      </Row>
      <Row name="WhatsApp / SMS" status="Not available" tone="neutral">
        No provider is integrated. “Prepare message” lets staff copy reviewed text into WhatsApp manually; nothing is sent automatically and nothing is reported as delivered.
      </Row>
      <Row name="Supplier GSTIN verification" status="Not available" tone="neutral">
        GSTIN format is checked; registration status, filing history and public records are not looked up. A verification provider with authorised API access would be needed (integration boundary: counterparty record).
      </Row>
      <Row name="AI assistance" status="Not enabled" tone="neutral">
        The application does not require or use an AI service. Financial calculations are deterministic.
      </Row>
    </Card>
  );
}
