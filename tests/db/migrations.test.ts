// G0.1: a fresh local DB has upstream's tables untouched and our six beside them, RLS on.
import { afterAll, describe, expect, it } from "vitest";
import { ADMISSIONS_TABLES, sql } from "./db";

afterAll(() => sql.end());

describe("migrations (G0.1)", () => {
  it("creates the six admissions tables in public", async () => {
    const rows = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any(${ADMISSIONS_TABLES as unknown as string[]})`;
    expect(rows.map((r) => r.table_name).sort()).toEqual([...ADMISSIONS_TABLES].sort());
  });

  it("keeps upstream's 37 tables and adds exactly 6", async () => {
    const [{ n }] = await sql`
      select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`;
    expect(n).toBe(43);
  });

  it("numbers our migrations from 100", async () => {
    const rows = await sql`select version from supabase_migrations.schema_migrations order by version`;
    const ours = rows.map((r) => Number(r.version)).filter((v) => v >= 100);
    expect(ours[0]).toBe(100);
    expect(rows.every((r) => Number(r.version) < 61 || Number(r.version) >= 100)).toBe(true);
  });

  it("has RLS on for the six tables", async () => {
    const rows = await sql`
      select relname from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity
        and relname = any(${ADMISSIONS_TABLES as unknown as string[]})`;
    expect(rows).toHaveLength(6);
  });
});
