import "server-only";

/** Product name is configurable so the brand can be replaced without code changes. */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "LedgerFlow";

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters (see .env.example)");
  }
  return s;
}

export const isProduction = process.env.NODE_ENV === "production";
