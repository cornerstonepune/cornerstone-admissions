// Migration 125 (ADR 0039): the conversation log and its audio bucket keep each account to itself.
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, actAsSuperuser, errorOf, lead, member, sql, tx, type Tx } from "./db";

afterAll(() => sql.end());

async function conversation(t: Tx, accountId: string, leadId: string, by: string | null = null): Promise<string> {
  const [c] = await t`
    insert into lead_conversations (account_id, lead_id, kind, typed_note, created_by)
    values (${accountId}, ${leadId}, 'call', 'Asked about fees', ${by})
    returning id`;
  return c.id as string;
}

async function audio(t: Tx, accountId: string, file = "a.m4a"): Promise<void> {
  await t`insert into storage.objects (bucket_id, name) values ('conversation-audio', ${`${accountId}/lead/${file}`})`;
}

describe("lead_conversations RLS", () => {
  it("lets a member read their own account's conversations, not another account's", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const own = await conversation(t, a.accountId, (await lead(t, a)).leadId);
      const theirs = await conversation(t, b.accountId, (await lead(t, b)).leadId);
      await actAs(t, await member(t, a.accountId, "viewer"));
      const rows = await t`select id from lead_conversations where id in (${own}, ${theirs})`;
      expect(rows.map((r) => r.id)).toEqual([own]);
    }));

  it("lets an agent log a conversation and refuses a viewer", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      expect(await errorOf(t, (s) => conversation(s, a.accountId, leadId, agent))).toBeNull();
      await actAsSuperuser(t);
      const viewer = await member(t, a.accountId, "viewer");
      await actAs(t, viewer);
      expect((await errorOf(t, (s) => conversation(s, a.accountId, leadId, viewer)))?.code).toBe("42501");
    }));

  it("refuses a conversation on another account's lead", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { leadId: theirs } = await lead(t, b);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      expect((await errorOf(t, (s) => conversation(s, a.accountId, theirs, agent)))?.code).toBe("23514");
    }));

  it("refuses an agent any UPDATE, even on their own account's conversation (only the job runner writes)", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const id = await conversation(t, a.accountId, leadId);
      await actAs(t, await member(t, a.accountId, "agent"));
      const updates: ((s: Tx) => Promise<unknown>)[] = [
        (s) => s`update lead_conversations set status = 'analysing' where id = ${id}`,
        (s) => s`update lead_conversations set audio_path = ${`${a.accountId}/${leadId}/x.m4a`} where id = ${id}`,
        (s) => s`update lead_conversations set provider_job_id = 'someone-elses-job' where id = ${id}`,
        (s) => s`update lead_conversations set created_at = now() - interval '2 years' where id = ${id}`,
      ];
      for (const update of updates) expect((await errorOf(t, update))?.code).toBe("42501");
    }));

  it("refuses an agent setting job columns when logging, or logging as someone else", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const agent = await member(t, a.accountId, "agent");
      const colleague = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const withJob = await errorOf(
        t,
        (s) => s`insert into lead_conversations (account_id, lead_id, kind, typed_note, created_by, status, provider_job_id)
                 values (${a.accountId}, ${leadId}, 'call', 'x', ${agent}, 'transcribing', 'their-job')`,
      );
      expect(withJob?.code).toBe("42501");
      expect((await errorOf(t, (s) => conversation(s, a.accountId, leadId, colleague)))?.code).toBe("42501");
    }));

  it("keeps the audio path inside the conversation's own account and lead folder", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { leadId } = await lead(t, a);
      const { leadId: other } = await lead(t, a);
      const insert = (path: string) => (s: Tx) =>
        s`insert into lead_conversations (account_id, lead_id, kind, audio_path) values (${a.accountId}, ${leadId}, 'call', ${path})`;
      expect(await errorOf(t, insert(`${a.accountId}/${leadId}/x.m4a`))).toBeNull();
      expect((await errorOf(t, insert(`${b.accountId}/${leadId}/x.m4a`)))?.code).toBe("23514");
      expect((await errorOf(t, insert(`${a.accountId}/${other}/x.m4a`)))?.code).toBe("23514");
      expect((await errorOf(t, insert(`${a.accountId}/${leadId}/../../x.m4a`)))?.code).toBe("23514");
    }));

  it("lets an agent's DELETE on another account's conversation touch 0 rows", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const theirs = await conversation(t, b.accountId, (await lead(t, b)).leadId);
      await actAs(t, await member(t, a.accountId, "admin"));
      expect(await t`delete from lead_conversations where id = ${theirs} returning id`).toHaveLength(0);
    }));

  it("goes when its lead is deleted", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const id = await conversation(t, a.accountId, leadId);
      await t`delete from leads where id = ${leadId}`;
      expect(await t`select id from lead_conversations where id = ${id}`).toHaveLength(0);
    }));
});

describe("conversation-audio bucket", () => {
  it("is private", async () => {
    const [b] = await sql`select public from storage.buckets where id = 'conversation-audio'`;
    expect(b.public).toBe(false);
  });

  it("lets a member read their own account's audio, not another account's", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      await audio(t, a.accountId);
      await audio(t, b.accountId);
      await actAs(t, await member(t, a.accountId, "viewer"));
      const rows = await t`select name from storage.objects where bucket_id = 'conversation-audio'`;
      expect(rows.map((r) => r.name)).toEqual([`${a.accountId}/lead/a.m4a`]);
    }));

  it("lets an agent upload into their account's folder only, and refuses a viewer", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      await actAs(t, await member(t, a.accountId, "agent"));
      expect(await errorOf(t, (s) => audio(s, a.accountId))).toBeNull();
      expect((await errorOf(t, (s) => audio(s, b.accountId)))?.code).toBe("42501");
      await actAsSuperuser(t);
      await actAs(t, await member(t, a.accountId, "viewer"));
      expect((await errorOf(t, (s) => audio(s, a.accountId, "b.m4a")))?.code).toBe("42501");
    }));

  it("gives anon nothing", () =>
    tx(async (t) => {
      const a = await account(t);
      await audio(t, a.accountId);
      await actAs(t, null);
      // Either no grant at all or no row: both keep the audio away from anon.
      const err = await errorOf(t, async (s) => {
        expect(await s`select name from storage.objects where bucket_id = 'conversation-audio'`).toHaveLength(0);
      });
      expect(err === null || err.code === "42501").toBe(true);
    }));

  it("never lets an agent delete audio, even in their own account", () =>
    tx(async (t) => {
      const a = await account(t);
      await audio(t, a.accountId);
      await actAs(t, await member(t, a.accountId, "agent"));
      await errorOf(t, (s) => s`delete from storage.objects where bucket_id = 'conversation-audio'`);
      await actAsSuperuser(t);
      const [{ n }] = await t`select count(*)::int as n from storage.objects where name = ${`${a.accountId}/lead/a.m4a`}`;
      expect(n).toBe(1);
    }));
});

describe("conversation_audio_to_sweep", () => {
  it("lists audio over 12 months old and day-old audio no conversation points to, nothing else", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const path = (f: string) => `${a.accountId}/${leadId}/${f}`;
      const put = (f: string, age: string) =>
        t`insert into storage.objects (bucket_id, name, created_at) values ('conversation-audio', ${path(f)}, now() - ${age}::interval)`;
      await put("old.m4a", "13 months");
      await put("orphan.m4a", "2 days");
      await put("uploading.m4a", "1 hour");
      await put("kept.m4a", "2 days");
      await t`insert into lead_conversations (account_id, lead_id, kind, audio_path) values (${a.accountId}, ${leadId}, 'call', ${path("kept.m4a")})`;
      await t`insert into lead_conversations (account_id, lead_id, kind, audio_path) values (${a.accountId}, ${leadId}, 'call', ${path("old.m4a")})`;
      const rows = await t`select name from public.conversation_audio_to_sweep(1000) where name like ${`${a.accountId}/%`}`;
      expect(rows.map((r) => r.name).sort()).toEqual([path("old.m4a"), path("orphan.m4a")]);
    }));

  it("is for the service role only", () =>
    tx(async (t) => {
      const a = await account(t);
      await actAs(t, await member(t, a.accountId, "owner"));
      expect((await errorOf(t, (s) => s`select * from public.conversation_audio_to_sweep(10)`))?.code).toBe("42501");
    }));
});
