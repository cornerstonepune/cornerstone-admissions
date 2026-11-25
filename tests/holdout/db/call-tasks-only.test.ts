// Hidden: agents write call tasks only, edge cases (migration 107, ADR 0013 §3).
import { afterAll, describe, expect, it } from "vitest";
import { type Tx, account, actAs, actAsSuperuser, errorOf, lead, member, setting, sql, tx } from "../../db/db";

afterAll(() => sql.end());

async function withSendAndTask(t: Tx) {
  const a = await account(t);
  const { leadId } = await lead(t, a);
  const rule = await setting(t, a, "follow_up_rule", "enquiry_day_2", { stage: "enquiry", days: 2, action: "call_task" });
  const [h] = await t`
    insert into lead_stage_history (account_id, lead_id, stage_id) values (${a.accountId}, ${leadId}, ${a.stageIds[0]})
    returning id`;
  const [send] = await t`
    insert into lead_activity (account_id, lead_id, kind, rule_id, stage_history_id)
    values (${a.accountId}, ${leadId}, 'follow_up_send', ${rule}, ${h.id}) returning id`;
  const [task] = await t`
    insert into lead_activity (account_id, lead_id, kind) values (${a.accountId}, ${leadId}, 'call_task') returning id`;
  return { a, rule, historyId: h.id as string, sendId: send.id as string, taskId: task.id as string };
}

describe("call tasks only (hidden)", () => {
  it("stops even an admin deleting a send, but lets them delete a call task", () =>
    tx(async (t) => {
      const { a, sendId, taskId } = await withSendAndTask(t);
      const admin = await member(t, a.accountId, "admin");
      await actAs(t, admin);
      expect((await t`delete from lead_activity where id = ${sendId}`).count).toBe(0);
      expect((await t`delete from lead_activity where id = ${taskId}`).count).toBe(1);
    }));

  it("stops an agent editing a send's notes or stage entry", () =>
    tx(async (t) => {
      const { a, sendId } = await withSendAndTask(t);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      expect((await t`update lead_activity set notes = 'x' where id = ${sendId}`).count).toBe(0);
      expect((await t`update lead_activity set stage_history_id = null where id = ${sendId}`).count).toBe(0);
    }));

  it("stops an agent turning a call task into a send", () =>
    tx(async (t) => {
      const { a, rule, historyId, taskId } = await withSendAndTask(t);
      await t`delete from lead_activity where kind = 'follow_up_send'`;
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const err = await errorOf(
        t,
        (s) => s`
          update lead_activity set kind = 'follow_up_send', rule_id = ${rule}, stage_history_id = ${historyId}
          where id = ${taskId}`,
      );
      expect(err?.code).toBe("42501");
    }));

  it("still lets an agent log a call and members read sends", () =>
    tx(async (t) => {
      const { a, taskId } = await withSendAndTask(t);
      const agent = await member(t, a.accountId, "agent");
      const viewer = await member(t, a.accountId, "viewer");
      await actAs(t, agent);
      expect((await t`update lead_activity set outcome = 'answered', done_at = now() where id = ${taskId}`).count).toBe(1);
      await actAsSuperuser(t);
      await actAs(t, viewer);
      expect(await t`select id from lead_activity`).toHaveLength(2);
    }));
});
