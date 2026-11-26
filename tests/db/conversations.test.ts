// Migration 125 (ADR 0039): the conversation log and its audio bucket keep each account to itself.
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, actAsSuperuser, errorOf, lead, member, sql, tx, type Tx } from "./db";

afterAll(() => sql.end());

async function conversation(t: Tx, accountId: string, leadId: string): Promise<string> {
  const [c] = await t`
    insert into lead_conversations (account_id, lead_id, kind, typed_note) values (${accountId}, ${leadId}, 'call', 'Asked about fees')
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
      await actAs(t, await member(t, a.accountId, "agent"));
      expect(await errorOf(t, (s) => conversation(s, a.accountId, leadId))).toBeNull();
      await actAsSuperuser(t);
      await actAs(t, await member(t, a.accountId, "viewer"));
      expect((await errorOf(t, (s) => conversation(s, a.accountId, leadId)))?.code).toBe("42501");
    }));

  it("refuses a conversation on another account's lead", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { leadId: theirs } = await lead(t, b);
      await actAs(t, await member(t, a.accountId, "agent"));
      expect((await errorOf(t, (s) => conversation(s, a.accountId, theirs)))?.code).toBe("23514");
    }));

  it("lets an agent's UPDATE on another account's conversation touch 0 rows", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const theirs = await conversation(t, b.accountId, (await lead(t, b)).leadId);
      await actAs(t, await member(t, a.accountId, "agent"));
      expect(await t`update lead_conversations set summary = 'x' where id = ${theirs} returning id`).toHaveLength(0);
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
});
