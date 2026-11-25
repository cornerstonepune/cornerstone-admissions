// Hidden: a lead's account and deal never change (ADR 0016 §3) and rpc probing of 103's definer helpers (ADR 0015 §3).
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, actAsSuperuser, contact, errorOf, lead, member, sql, tx, type Account, type Tx } from "../../db/db";

afterAll(() => sql.end());

const MOVE = "A lead's account and deal never change";

async function plainDeal(t: Tx, a: Account, contactId: string): Promise<string> {
  const [d] = await t`
    insert into deals (user_id, account_id, pipeline_id, stage_id, contact_id, title)
    values (${a.ownerId}, ${a.accountId}, ${a.pipelineId}, ${a.stageIds[0]}, ${contactId}, 'Other deal') returning id`;
  return d.id as string;
}

async function message(t: Tx, a: Account): Promise<string> {
  const c = await contact(t, a);
  const [conv] = await t`insert into conversations (user_id, contact_id, account_id) values (${a.ownerId}, ${c}, ${a.accountId}) returning id`;
  const [m] = await t`insert into messages (conversation_id, sender_type, content_text) values (${conv.id}, 'agent', 'Hi') returning id`;
  return m.id as string;
}

describe("lead move guard (hidden)", () => {
  it("refuses a deal move for a lead with a visit, with the new sentence", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, contactId } = await lead(t, a);
      await t`insert into visits (account_id, lead_id, cal_booking_id, starts_at) values (${a.accountId}, ${leadId}, 'cal_1', now())`;
      const other = await plainDeal(t, a, contactId);
      const err = await errorOf(t, (s) => s`update leads set deal_id = ${other} where id = ${leadId}`);
      expect(err?.code).toBe("23514");
      expect(err?.message).toBe(MOVE);
    }));

  it("refuses an account move for a lead with activity, with the new sentence", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { leadId } = await lead(t, a);
      await t`insert into lead_activity (account_id, lead_id, kind) values (${a.accountId}, ${leadId}, 'call_task')`;
      const err = await errorOf(t, (s) => s`update leads set account_id = ${b.accountId} where id = ${leadId}`);
      expect(err?.code).toBe("23514");
      expect(err?.message).toBe(MOVE);
    }));

  it("refuses an agent too, through RLS", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, contactId } = await lead(t, a);
      const other = await plainDeal(t, a, contactId);
      await actAs(t, await member(t, a.accountId, "agent"));
      const err = await errorOf(t, (s) => s`update leads set deal_id = ${other} where id = ${leadId}`);
      expect(err?.code).toBe("23514");
      expect(err?.message).toBe(MOVE);
      expect(await errorOf(t, (s) => s`update leads set child_name = 'Asha' where id = ${leadId}`)).toBeNull();
    }));

  it("allows an update that sets account and deal to what they already are", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      expect(
        await errorOf(t, (s) => s`update leads set account_id = ${a.accountId}, deal_id = ${dealId} where id = ${leadId}`),
      ).toBeNull();
    }));

  it("keeps check_lead_integrity running as the caller", () =>
    tx(async (t) => {
      const [f] = await t`select prosecdef from pg_proc where oid = 'public.check_lead_integrity()'::regprocedure`;
      expect(f.prosecdef).toBe(false);
    }));
});

describe("definer helpers refuse rpc probing (hidden)", () => {
  it("deal_matches_lead answers false for another account's deal, true for one's own", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const mine = await lead(t, a);
      const theirs = await lead(t, b);
      await actAs(t, await member(t, a.accountId, "agent"));
      const [r] = await t`select
          public.deal_matches_lead(${theirs.dealId}, ${b.accountId}, ${theirs.contactId}) as theirs,
          public.deal_matches_lead(${mine.dealId}, ${a.accountId}, ${mine.contactId}) as mine`;
      expect(r).toEqual({ theirs: false, mine: true });
      await actAsSuperuser(t);
      const [s] = await t`select public.deal_matches_lead(${theirs.dealId}, ${b.accountId}, ${theirs.contactId}) as ok`;
      expect(s.ok).toBe(true);
    }));

  it("message_in_account answers false for another account's message, true for one's own", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const mine = await message(t, a);
      const theirs = await message(t, b);
      await actAs(t, await member(t, a.accountId, "agent"));
      const [r] = await t`select
          public.message_in_account(${theirs}, ${b.accountId}) as theirs,
          public.message_in_account(${mine}, ${a.accountId}) as mine`;
      expect(r).toEqual({ theirs: false, mine: true });
    }));

  it("refuses anon outright", () =>
    tx(async (t) => {
      const a = await account(t);
      const { dealId, contactId } = await lead(t, a);
      await actAs(t, null);
      const err = await errorOf(t, (s) => s`select public.deal_matches_lead(${dealId}, ${a.accountId}, ${contactId})`);
      expect(err?.code).toBe("42501");
    }));
});
