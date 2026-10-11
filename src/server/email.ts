import "server-only";
import nodemailer from "nodemailer";

export type SendResult = { ok: true; id?: string } | { ok: false; error: string; transient: boolean };

export interface EmailProvider {
  name: string;
  send(msg: { to: string; subject: string; text: string; replyTo?: string }): Promise<SendResult>;
}

export function emailConfigStatus() {
  const missing = ["SMTP_HOST", "EMAIL_FROM"].filter((k) => !process.env[k]);
  return { configured: missing.length === 0, provider: "SMTP", missing, host: process.env.SMTP_HOST ? process.env.SMTP_HOST : null };
}

let override: EmailProvider | null | undefined;
/** Tests inject a provider (including a failing one) here. */
export function setEmailProviderForTests(p: EmailProvider | null | undefined) {
  override = p;
}

let cached: EmailProvider | null | undefined;

/** Returns null when email is not configured. Callers must record that, never pretend delivery happened. */
export function getEmailProvider(): EmailProvider | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  const status = emailConfigStatus();
  if (!status.configured) return (cached = null);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  cached = {
    name: "smtp",
    async send(msg) {
      try {
        const info = await transport.sendMail({ from: process.env.EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, replyTo: msg.replyTo });
        return { ok: true, id: info.messageId };
      } catch (e) {
        const err = e as { responseCode?: number; code?: string; message?: string };
        // 5xx SMTP responses are permanent; connection errors and 4xx are worth retrying.
        const transient = !(err.responseCode && err.responseCode >= 500);
        return { ok: false, error: (err.code ? `${err.code}: ` : "") + (err.message ?? "send failed").slice(0, 200), transient };
      }
    },
  };
  return cached;
}
