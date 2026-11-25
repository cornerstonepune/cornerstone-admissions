// Hidden: stage history and deal status edge cases (ticket 104).
import { afterAll, describe, expect, it } from "vitest";
import { account, contact, lead, sql, tx } from "../../db/db";

afterAll(() => sql.end());

const IST_MIDNIGHT = sql`(date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`;

describe("stage history edge cases (hidden)", () => {
  it("starts a lead created in a later stage at that stage", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a, { stageId: a.stageIds[3] });
      const rows = await t`select stage_id, account_id from lead_stage_history where lead_id = ${leadId}`;
      expect(rows).toEqual([{ stage_id: a.stageIds[3], account_id: a.accountId }]);
    }));

  it("records nothing when the stage is set to the one it already has", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      await t`update deals set stage_id = ${a.stageIds[0]} where id = ${dealId}`;
      const [{ n }] = await t`select count(*)::int as n from lead_stage_history where lead_id = ${leadId}`;
      expect(n).toBe(1);
    }));

  it("records a move back to an earlier stage as a new entry", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      await t`update deals set stage_id = ${a.stageIds[2]} where id = ${dealId}`;
      await t`update deals set stage_id = ${a.stageIds[1]} where id = ${dealId}`;
      const rows = await t`select stage_id from lead_stage_history where lead_id = ${leadId}`;
      expect(rows.map((r) => r.stage_id).sort()).toEqual([a.stageIds[0], a.stageIds[1], a.stageIds[2]].sort());
      expect(rows).toHaveLength(3);
    }));

  it("leaves a deal that has no lead alone", () =>
    tx(async (t) => {
      const a = await account(t);
      const c = await contact(t, a);
      const [d] = await t`
        insert into deals (user_id, account_id, pipeline_id, stage_id, contact_id, title)
        values (${a.ownerId}, ${a.accountId}, ${a.pipelineId}, ${a.stageIds[0]}, ${c}, 'Plain deal') returning id`;
      await t`update deals set stage_id = ${a.stageIds[1]} where id = ${d.id}`;
      const [{ n }] = await t`select count(*)::int as n from lead_stage_history`;
      expect(n).toBe(0);
    }));

  it("records who moved the lead", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: a.ownerId, role: "authenticated" })}, true)`;
      await t`update deals set stage_id = ${a.stageIds[1]} where id = ${dealId}`;
      const [h] = await t`select moved_by from lead_stage_history where lead_id = ${leadId} and stage_id = ${a.stageIds[1]}`;
      expect(h.moved_by).toBe(a.ownerId);
    }));

  it("counts days in stage on the India calendar, not in 24-hour blocks", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const days = async () => (await t`select public.lead_days_in_stage(${leadId}) as d`)[0].d;
      await t`update lead_stage_history set entered_at = ${IST_MIDNIGHT} - interval '1 minute' where lead_id = ${leadId}`;
      expect(await days()).toBe(1);
      await t`update lead_stage_history set entered_at = ${IST_MIDNIGHT} where lead_id = ${leadId}`;
      expect(await days()).toBe(0);
    }));

  it("counts from the latest stage entry", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      await t`update lead_stage_history set entered_at = now() - interval '10 days' where lead_id = ${leadId}`;
      await t`update deals set stage_id = ${a.stageIds[1]} where id = ${dealId}`;
      await t`
        update lead_stage_history set entered_at = now() - interval '2 days'
        where lead_id = ${leadId} and stage_id = ${a.stageIds[1]}`;
      expect((await t`select public.lead_days_in_stage(${leadId}) as d`)[0].d).toBe(2);
    }));

  it("gives no days in stage for an unknown lead", () =>
    tx(async (t) => {
      const [{ d }] = await t`select public.lead_days_in_stage(gen_random_uuid()) as d`;
      expect(d).toBeNull();
    }));
});

describe("deal status edge cases (hidden)", () => {
  it("marks the deal lost when the lead goes Dormant", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      await t`update leads set exit = 'dormant', exited_at = now() where id = ${leadId}`;
      const [d] = await t`select status, closed_at from deals where id = ${dealId}`;
      expect(d.status).toBe("lost");
      expect(d.closed_at).not.toBeNull();
    }));

  it("reopens the deal when a Dormant lead comes back", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      await t`update leads set exit = 'dormant', exited_at = now() where id = ${leadId}`;
      await t`update leads set exit = null, exited_at = null where id = ${leadId}`;
      const [d] = await t`select status, closed_at from deals where id = ${dealId}`;
      expect(d).toEqual({ status: "open", closed_at: null });
    }));

  it("leaves an open lead's deal open", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      await t`update leads set child_name = 'Aarav' where id = ${leadId}`;
      const [d] = await t`select status from deals where id = ${dealId}`;
      expect(d.status).toBe("open");
    }));
});
