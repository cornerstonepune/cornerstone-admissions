// Invariant 6: agents write call tasks only; follow-up sends are the server's (migration 107, ADR 0013 §3).
import { afterAll, describe, expect, it } from "vitest";
import { type Tx, account, actAs, errorOf, lead, member, setting, sql, tx } from "./db";

afterAll(() => sql.end());

/** A lead with one follow-up send, written as the server (superuser). */
async function withSend(t: Tx) {
  const a = await account(t);
  const { leadId } = await lead(t, a);
  const rule = await setting(t, a, "follow_up_rule", "enquiry_day_2", { stage: "enquiry", days: 2, action: "call_task" });
  const [h] = await t`
    insert into lead_stage_history (account_id, lead_id, stage_id) values (${a.accountId}, ${leadId}, ${a.stageIds[0]})
    returning id`;
  const [send] = await t`
    insert into lead_activity (account_id, lead_id, kind, rule_id, stage_history_id)
    values (${a.accountId}, ${leadId}, 'follow_up_send', ${rule}, ${h.id}) returning id`;
  return { a, leadId, rule, historyId: h.id as string, sendId: send.id as string };
}

describe("agents write call tasks only (invariant 6)", () => {
  it("stops an agent turning a send into a call task", () =>
    tx(async (t) => {
      const { a, sendId } = await withSend(t);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      expect((await t`update lead_activity set kind = 'call_task' where id = ${sendId}`).count).toBe(0);
    }));

  it("stops an agent writing a send", () =>
    tx(async (t) => {
      const { a, leadId, rule, historyId } = await withSend(t);
      await t`delete from lead_activity`;
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const err = await errorOf(
        t,
        (s) => s`
          insert into lead_activity (account_id, lead_id, kind, rule_id, stage_history_id)
          values (${a.accountId}, ${leadId}, 'follow_up_send', ${rule}, ${historyId})`,
      );
      expect(err?.code).toBe("42501");
    }));
});
