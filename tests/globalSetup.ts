import { execSync } from "node:child_process";

/**
 * Applies migrations to the integration-test database (non-destructive).
 * Tests never depend on an empty database: each creates its own businesses,
 * and Row Level Security keeps them apart.
 */
export default function setup() {
  const direct = process.env.TEST_DIRECT_URL;
  if (!direct) {
    console.warn("TEST_DIRECT_URL not set — integration tests will be skipped.");
    return;
  }
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: direct, DIRECT_URL: direct } });
}
