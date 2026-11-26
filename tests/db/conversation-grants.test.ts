// Migration 127: whatever the database grants by default (hosted gives everything), staff end up with 125's rights only.
import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { sql, tx } from "./db";

afterAll(() => sql.end());

it("leaves staff no way to write the job columns, even after hosted-style default grants", () =>
  tx(async (t) => {
    await t`grant all on public.lead_conversations to anon, authenticated`;
    await t.unsafe(readFileSync("supabase/migrations/127_conversation_grants.sql", "utf8"));
    const [r] = await t`
      select has_table_privilege('authenticated', 'public.lead_conversations', 'UPDATE') as upd,
             has_column_privilege('authenticated', 'public.lead_conversations', 'status', 'INSERT') as ins_status,
             has_column_privilege('authenticated', 'public.lead_conversations', 'provider_job_id', 'INSERT') as ins_job,
             has_column_privilege('authenticated', 'public.lead_conversations', 'typed_note', 'INSERT') as ins_note,
             has_table_privilege('anon', 'public.lead_conversations', 'SELECT') as anon_read`;
    expect(r).toEqual({ upd: false, ins_status: false, ins_job: false, ins_note: true, anon_read: false });
  }));
