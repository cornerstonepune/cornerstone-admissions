// M3 (#66, migration 112): moving a lead, days in stage, Lost needs a reason — as an agent, with RLS on.
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, actAsSuperuser, errorOf, lead, member, setting, sql, tx } from "./db";

afterAll(() => sql.end());

const historyOf = (t: Parameters<Parameters<typeof tx>[0]>[0], leadId: string) =>
  t`select stage_id, moved_by from lead_stage_history where lead_id = ${leadId}`;

describe("G3.1 moving a lead writes exactly one history row", () => {
  it("adds one row for the new stage, moved by the agent", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      await t`select public.move_lead(${leadId}, ${a.stageIds[2]})`;
      const rows = await historyOf(t, leadId);
      expect(rows).toHaveLength(2);
      expect(rows).toContainEqual({ stage_id: a.stageIds[2], moved_by: agent });
    }));

  it("adds nothing when the lead is dropped on its own stage", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await actAs(t, await member(t, a.accountId, "agent"));
      await t`select public.move_lead(${leadId}, ${a.stageIds[0]})`;
      expect(await historyOf(t, leadId)).toHaveLength(1);
    }));

  it("admits the lead on the last stage and reopens it when it leaves", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      await actAs(t, await member(t, a.accountId, "agent"));
      await t`select public.move_lead(${leadId}, ${a.stageIds[5]})`;
      const [won] = await t`select l.admitted_at, d.status from leads l join deals d on d.id = l.deal_id where l.id = ${leadId}`;
      expect(won.admitted_at).not.toBeNull();
      expect(won.status).toBe("won");
      await t`select public.move_lead(${leadId}, ${a.stageIds[4]})`;
      const [open] = await t`select l.admitted_at, d.status from leads l join deals d on d.id = ${dealId} where l.id = ${leadId}`;
      expect(open).toEqual({ admitted_at: null, status: "open" });
      expect(await historyOf(t, leadId)).toHaveLength(3);
    }));

  it("refuses a stage of another pipeline, and writes nothing", () =>
    tx(async (t) => {
      const a = await account(t);
      const other = await account(t);
      const { leadId } = await lead(t, a);
      await actAs(t, await member(t, a.accountId, "agent"));
      const err = await errorOf(t, (s) => s`select public.move_lead(${leadId}, ${other.stageIds[1]})`);
      expect(err?.code).toBe("23514");
      expect(await historyOf(t, leadId)).toHaveLength(1);
    }));

  it("refuses a closed lead", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await t`update leads set exit = 'dormant', exited_at = now() where id = ${leadId}`;
      await actAs(t, await member(t, a.accountId, "agent"));
      const err = await errorOf(t, (s) => s`select public.move_lead(${leadId}, ${a.stageIds[1]})`);
      expect(err?.code).toBe("23514");
    }));

  it("refuses a viewer instead of doing nothing", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await actAs(t, await member(t, a.accountId, "viewer"));
      const err = await errorOf(t, (s) => s`select public.move_lead(${leadId}, ${a.stageIds[1]})`);
      expect(err?.code).toBe("42501");
      await actAsSuperuser(t);
      expect(await historyOf(t, leadId)).toHaveLength(1);
    }));
});

describe("G3.2 days in stage comes from history", () => {
  it("reads the latest history row, not a stored number", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const stored = await t`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'leads' and column_name like '%days%'`;
      expect(stored).toHaveLength(0);
      await t`update lead_stage_history set entered_at = now() - interval '5 days' where lead_id = ${leadId}`;
      await actAs(t, await member(t, a.accountId, "viewer"));
      const [r] = await t`select public.days_in_stage(l) as d from leads l where l.id = ${leadId}`;
      expect(r.d).toBe(5);
    }));

  it("starts again at 0 after a move", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await t`update lead_stage_history set entered_at = now() - interval '9 days' where lead_id = ${leadId}`;
      await actAs(t, await member(t, a.accountId, "agent"));
      await t`select public.move_lead(${leadId}, ${a.stageIds[1]})`;
      const [r] = await t`select public.days_in_stage(l) as d from leads l where l.id = ${leadId}`;
      expect(r.d).toBe(0);
    }));
});

describe("G3.3 Lost needs a lost reason", () => {
  it("refuses an agent closing a lead as Lost without a reason", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await actAs(t, await member(t, a.accountId, "agent"));
      const err = await errorOf(t, (s) => s`update leads set exit = 'lost', exited_at = now() where id = ${leadId}`);
      expect(err?.code).toBe("23514");
    }));

  it("closes it as Lost with a reason", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const reason = await setting(t, a, "lost_reason", "fees");
      await actAs(t, await member(t, a.accountId, "agent"));
      await t`update leads set exit = 'lost', exited_at = now(), lost_reason_id = ${reason} where id = ${leadId}`;
      const [l] = await t`select exit from leads where id = ${leadId}`;
      expect(l.exit).toBe("lost");
    }));
});

describe("a lead can't be moved from another account", () => {
  it("refuses an agent of account B moving account A's lead, and writes no history", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { leadId } = await lead(t, a);
      await actAs(t, await member(t, b.accountId, "agent"));
      const err = await errorOf(t, (s) => s`select public.move_lead(${leadId}, ${a.stageIds[1]})`);
      expect(err?.code).toBe("23514");
      await actAsSuperuser(t);
      expect(await historyOf(t, leadId)).toHaveLength(1);
    }));
});
