// ADR 0038, migration 124: deleting a lead (through its deal) is admin-only. Everything hanging off the lead goes;
// the parent's contact and WhatsApp conversation stay. Run as real users with RLS on.
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, actAsSuperuser, lead, member, sql, tx, type Tx } from "./db";

afterAll(() => sql.end());

const left = async (t: Tx, leadId: string, dealId: string, contactId: string) => {
  await actAsSuperuser(t);
  const [r] = await t`select
      (select count(*) from leads where id = ${leadId})::int as leads,
      (select count(*) from deals where id = ${dealId})::int as deals,
      (select count(*) from lead_stage_history where lead_id = ${leadId})::int as history,
      (select count(*) from lead_activity where lead_id = ${leadId})::int as activity,
      (select count(*) from contacts where id = ${contactId})::int as contacts,
      (select count(*) from conversations where contact_id = ${contactId})::int as conversations`;
  return r;
};

/** A lead with a call logged and a WhatsApp conversation with its parent. */
async function fullLead(t: Tx) {
  const a = await account(t);
  const l = await lead(t, a);
  await t`insert into lead_activity (account_id, lead_id, kind, due_at, done_at, outcome)
          values (${a.accountId}, ${l.leadId}, 'call_task', now(), now(), 'Talked')`;
  await t`insert into conversations (user_id, account_id, contact_id) values (${a.ownerId}, ${a.accountId}, ${l.contactId})`;
  return { a, ...l };
}

describe("deleting a lead", () => {
  it("an admin deletes the lead, its history and calls; the contact and conversation stay", () =>
    tx(async (t) => {
      const { a, leadId, dealId, contactId } = await fullLead(t);
      await actAs(t, await member(t, a.accountId, "admin"));
      const gone = await t`delete from deals where id = ${dealId} returning id`;
      expect(gone).toHaveLength(1);
      expect(await left(t, leadId, dealId, contactId)).toEqual({
        leads: 0,
        deals: 0,
        history: 0,
        activity: 0,
        contacts: 1,
        conversations: 1,
      });
    }));

  it("an agent cannot delete a lead's deal, nor the lead itself", () =>
    tx(async (t) => {
      const { a, leadId, dealId, contactId } = await fullLead(t);
      await actAs(t, await member(t, a.accountId, "agent"));
      expect(await t`delete from deals where id = ${dealId} returning id`).toHaveLength(0);
      expect(await t`delete from leads where id = ${leadId} returning id`).toHaveLength(0);
      expect(await left(t, leadId, dealId, contactId)).toMatchObject({ leads: 1, deals: 1, history: 1, activity: 1 });
    }));

  it("an agent can still delete a deal that carries no lead (upstream's rule)", () =>
    tx(async (t) => {
      const a = await account(t);
      const [d] = await t`insert into deals (user_id, account_id, pipeline_id, stage_id, title)
                          values (${a.ownerId}, ${a.accountId}, ${a.pipelineId}, ${a.stageIds[0]}, 'Plain deal') returning id`;
      await actAs(t, await member(t, a.accountId, "agent"));
      expect(await t`delete from deals where id = ${d.id} returning id`).toHaveLength(1);
    }));

  it("an admin of another account cannot delete it", () =>
    tx(async (t) => {
      const { leadId, dealId, contactId } = await fullLead(t);
      const other = await account(t);
      await actAs(t, await member(t, other.accountId, "admin"));
      expect(await t`delete from deals where id = ${dealId} returning id`).toHaveLength(0);
      expect(await left(t, leadId, dealId, contactId)).toMatchObject({ leads: 1, deals: 1 });
    }));
});
