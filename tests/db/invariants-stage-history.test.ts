// Invariant 5 (migration 104): every stage a lead enters writes one history row; the deal's status follows the lead.
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, errorOf, lead, member, setting, sql, tx } from "./db";

afterAll(() => sql.end());

describe("stage history (invariant 5)", () => {
  it("records the stage a new lead starts in", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const rows = await t`select stage_id from lead_stage_history where lead_id = ${leadId}`;
      expect(rows.map((r) => r.stage_id)).toEqual([a.stageIds[0]]);
    }));

  it("records each stage move once", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      await t`update deals set stage_id = ${a.stageIds[1]} where id = ${dealId}`;
      await t`update deals set stage_id = ${a.stageIds[2]} where id = ${dealId}`;
      const [{ n }] = await t`select count(*)::int as n from lead_stage_history where lead_id = ${leadId}`;
      expect(n).toBe(3);
    }));

  it("records nothing when the deal changes but its stage doesn't", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      await t`update deals set title = 'Renamed' where id = ${dealId}`;
      const [{ n }] = await t`select count(*)::int as n from lead_stage_history where lead_id = ${leadId}`;
      expect(n).toBe(1);
    }));

  it("counts whole days in stage", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await t`update lead_stage_history set entered_at = now() - interval '3 days' where lead_id = ${leadId}`;
      const [{ d }] = await t`select public.lead_days_in_stage(${leadId}) as d`;
      expect(d).toBe(3);
    }));
});

describe("deal status follows the lead", () => {
  it("marks the deal won when the lead is admitted", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      await t`update leads set admitted_at = now() where id = ${leadId}`;
      const [d] = await t`select status from deals where id = ${dealId}`;
      expect(d.status).toBe("won");
    }));

  it("marks the deal lost, with a close time, when the lead is Lost", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      const reason = await setting(t, a, "lost_reason", "fees");
      await t`update leads set exit = 'lost', exited_at = now(), lost_reason_id = ${reason} where id = ${leadId}`;
      const [d] = await t`select status, closed_at from deals where id = ${dealId}`;
      expect(d.status).toBe("lost");
      expect(d.closed_at).not.toBeNull();
    }));
  it("stops anyone writing stage history directly", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const err = await errorOf(
        t,
        (s) => s`insert into lead_stage_history (account_id, lead_id, stage_id) values (${a.accountId}, ${leadId}, ${a.stageIds[3]})`,
      );
      expect(err?.code).toBe("42501");
    }));

  it("records the first stage of a lead an agent creates, as moved by that agent", () =>
    tx(async (t) => {
      const a = await account(t);
      const [c] = await t`insert into contacts (user_id, account_id, phone, name) values (${a.ownerId}, ${a.accountId}, '+919800000001', 'Parent') returning id`;
      const [d] = await t`
        insert into deals (user_id, account_id, pipeline_id, stage_id, contact_id, title)
        values (${a.ownerId}, ${a.accountId}, ${a.pipelineId}, ${a.stageIds[0]}, ${c.id}, 'Lead') returning id`;
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const [l] = await t`insert into leads (account_id, deal_id, contact_id) values (${a.accountId}, ${d.id}, ${c.id}) returning id`;
      const rows = await t`select stage_id, moved_by from lead_stage_history where lead_id = ${l.id}`;
      expect(rows).toEqual([{ stage_id: a.stageIds[0], moved_by: agent }]);
    }));
});
