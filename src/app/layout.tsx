import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

const name = process.env.NEXT_PUBLIC_APP_NAME || "LedgerFlow";

export const metadata: Metadata = {
  title: { default: name, template: `%s · ${name}` },
  description: "Receivables, payables and collections management for B2B trading businesses.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f6f5f1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        {children}
        <Toaster position="top-right" richColors closeButton toastOptions={{ style: { fontSize: 13.5 } }} />
      </body>
    </html>
  );
}
