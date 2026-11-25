// Rule-made activity is the kind its rule makes and keeps its rule and stage entry; a follow-up rule in use
// keeps its action (migration 111, ADR 0017).
import { afterAll, describe, expect, it } from "vitest";
import { type Account, type Tx, account, actAs, errorOf, lead, member, setting, sql, tx } from "./db";

afterAll(() => sql.end());

const WRONG_KIND = /A rule-made activity must be the kind its rule makes/;
const FIXED = /A lead activity keeps its rule and stage entry/;
const ACTION_FIXED = /A follow-up rule in use cannot change its action/;

/** A lead, its first stage entry, a send rule and a call-task rule. */
async function withRules(t: Tx) {
  const a = await account(t);
  const { leadId } = await lead(t, a);
  const sendRule = await setting(t, a, "follow_up_rule", "enquiry_day_1", {
    stage: "enquiry", days: 1, action: "send_template", template: "enquiry_day_1",
  });
  const callRule = await setting(t, a, "follow_up_rule", "enquiry_day_2", { stage: "enquiry", days: 2, action: "call_task" });
  const [h] = await t`select id from lead_stage_history where lead_id = ${leadId}`;
  return { a, leadId, sendRule, callRule, entry: h.id as string };
}

const activity = (a: Account, leadId: string, kind: string, rule: string | null, entry: string | null) => (s: Tx) =>
  s`insert into lead_activity (account_id, lead_id, kind, rule_id, stage_history_id)
    values (${a.accountId}, ${leadId}, ${kind}, ${rule}, ${entry}) returning id`;

describe("rule-made activity is the kind its rule makes", () => {
  it("records a send under a send rule and a call task under a call-task rule", () =>
    tx(async (t) => {
      const { a, leadId, sendRule, callRule, entry } = await withRules(t);
      expect(await errorOf(t, activity(a, leadId, "follow_up_send", sendRule, entry))).toBeNull();
      expect(await errorOf(t, activity(a, leadId, "call_task", callRule, entry))).toBeNull();
    }));

  it("refuses a send under a call-task rule", () =>
    tx(async (t) => {
      const { a, leadId, callRule, entry } = await withRules(t);
      const err = await errorOf(t, activity(a, leadId, "follow_up_send", callRule, entry));
      expect(err?.code).toBe("23514");
      expect(err?.message).toMatch(WRONG_KIND);
    }));

  it("refuses a call task under a send rule", () =>
    tx(async (t) => {
      const { a, leadId, sendRule, entry } = await withRules(t);
      const err = await errorOf(t, activity(a, leadId, "call_task", sendRule, entry));
      expect(err?.code).toBe("23514");
      expect(err?.message).toMatch(WRONG_KIND);
    }));
});

describe("an agent can't make a hand-made call task rule-made", () => {
  it("refuses adding a send rule and stage entry, so the send still goes out", () =>
    tx(async (t) => {
      const { a, leadId, sendRule, entry } = await withRules(t);
      const [task] = await activity(a, leadId, "call_task", null, null)(t);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const err = await errorOf(
        t,
        (s) => s`update lead_activity set rule_id = ${sendRule}, stage_history_id = ${entry} where id = ${task.id}`,
      );
      expect(err?.code).toBe("23514");
    }));

  it("still lets an agent log the call", () =>
    tx(async (t) => {
      const { a, leadId } = await withRules(t);
      const [task] = await activity(a, leadId, "call_task", null, null)(t);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const r = await t`update lead_activity set done_at = now(), notes = 'spoke to mother' where id = ${task.id}`;
      expect(r.count).toBe(1);
    }));
});

describe("a lead activity keeps its rule and stage entry", () => {
  it("refuses moving a rule-made call task to another rule", () =>
    tx(async (t) => {
      const { a, leadId, callRule, entry } = await withRules(t);
      const other = await setting(t, a, "follow_up_rule", "enquiry_day_5", { stage: "enquiry", days: 5, action: "call_task" });
      const [task] = await activity(a, leadId, "call_task", callRule, entry)(t);
      const err = await errorOf(t, (s) => s`update lead_activity set rule_id = ${other} where id = ${task.id}`);
      expect(err?.code).toBe("23514");
      expect(err?.message).toMatch(FIXED);
    }));
});

describe("a follow-up rule in use keeps its action", () => {
  it("refuses changing a used rule's action", () =>
    tx(async (t) => {
      const { a, leadId, callRule, entry } = await withRules(t);
      await activity(a, leadId, "call_task", callRule, entry)(t);
      const err = await errorOf(
        t,
        (s) => s`update admissions_settings
                 set value = ${s.json({ stage: "enquiry", days: 2, action: "send_template", template: "x" })}
                 where id = ${callRule}`,
      );
      expect(err?.code).toBe("23514");
      expect(err?.message).toMatch(ACTION_FIXED);
    }));

  it("lets an unused rule change its action", () =>
    tx(async (t) => {
      const { callRule } = await withRules(t);
      const err = await errorOf(
        t,
        (s) => s`update admissions_settings
                 set value = ${s.json({ stage: "enquiry", days: 2, action: "dormant" })}
                 where id = ${callRule}`,
      );
      expect(err).toBeNull();
    }));
});
