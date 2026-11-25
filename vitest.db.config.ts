import { defineConfig } from "vitest/config";

// Database tests (ADR 0011): run against the local Supabase Postgres started by `npm run db:reset`.
// One file at a time: every test rolls back, but unique indexes still block across open transactions.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts", "tests/holdout/db/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
