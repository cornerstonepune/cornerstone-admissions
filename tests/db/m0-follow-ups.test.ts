// M0 follow-ups (migration 110, ADR 0016): rule-made activity names its stage entry and is unique per
// (lead, rule, stage entry); a used rule can't be deleted; people add call tasks only without a rule.
import { afterAll, describe, expect, it } from "vitest";
import { type Account, type Tx, account, actAs, errorOf, lead, member, setting, sql, tx } from "./db";

afterAll(() => sql.end());

/** A lead, a call-task rule and the lead's first stage entry (written when the lead is created). */
async function withRule(t: Tx): Promise<{ a: Account; leadId: string; rule: string; entry: string }> {
  const a = await account(t);
  const { leadId } = await lead(t, a);
  const rule = await setting(t, a, "follow_up_rule", "enquiry_day_2", { stage: "enquiry", days: 2, action: "call_task" });
  const [h] = await t`select id from lead_stage_history where lead_id = ${leadId}`;
  return { a, leadId, rule, entry: h.id as string };
}

const ruleTask = (a: Account, leadId: string, rule: string | null, entry: string | null) => (s: Tx) =>
  s`insert into lead_activity (account_id, lead_id, kind, rule_id, stage_history_id)
    values (${a.accountId}, ${leadId}, 'call_task', ${rule}, ${entry})`;

describe("rule-made activity", () => {
  it("must name its stage entry", () =>
    tx(async (t) => {
      const { a, leadId, rule } = await withRule(t);
      expect((await errorOf(t, ruleTask(a, leadId, rule, null)))?.code).toBe("23514");
    }));

  it("is made once per lead, rule and stage entry, call tasks included", () =>
    tx(async (t) => {
      const { a, leadId, rule, entry } = await withRule(t);
      expect(await errorOf(t, ruleTask(a, leadId, rule, entry))).toBeNull();
      expect((await errorOf(t, ruleTask(a, leadId, rule, entry)))?.code).toBe("23505");
    }));
});

describe("a used follow-up rule", () => {
  it("can't be deleted, and its activity keeps the rule", () =>
    tx(async (t) => {
      const { a, leadId, rule, entry } = await withRule(t);
      await ruleTask(a, leadId, rule, entry)(t);
      expect((await errorOf(t, (s) => s`delete from admissions_settings where id = ${rule}`))?.code).toBe("23503");
      const [r] = await t`select rule_id from lead_activity where lead_id = ${leadId}`;
      expect(r.rule_id).toBe(rule);
    }));

  it("can be deleted once unused", () =>
    tx(async (t) => {
      const { rule } = await withRule(t);
      expect(await errorOf(t, (s) => s`delete from admissions_settings where id = ${rule}`)).toBeNull();
    }));

  it("doesn't stop a whole account being deleted", () =>
    tx(async (t) => {
      const { a, leadId, rule, entry } = await withRule(t);
      await ruleTask(a, leadId, rule, entry)(t);
      expect(await errorOf(t, (s) => s`delete from accounts where id = ${a.accountId}`)).toBeNull();
    }));
});

describe("people add call tasks", () => {
  it("without a rule only", () =>
    tx(async (t) => {
      const { a, leadId, rule, entry } = await withRule(t);
      await actAs(t, await member(t, a.accountId, "agent"));
      expect((await errorOf(t, ruleTask(a, leadId, rule, entry)))?.code).toBe("42501");
      expect(await errorOf(t, ruleTask(a, leadId, null, null))).toBeNull();
    }));
});
