// Hidden: M0 follow-ups edge cases (migration 110, ADR 0016).
import { afterAll, describe, expect, it } from "vitest";
import { type Account, type Tx, account, actAs, errorOf, lead, member, setting, sql, tx } from "../../db/db";

afterAll(() => sql.end());

async function withRule(t: Tx): Promise<{ a: Account; leadId: string; rule: string; entry: string }> {
  const a = await account(t);
  const { leadId } = await lead(t, a);
  const rule = await setting(t, a, "follow_up_rule", "enquiry_day_2", { stage: "enquiry", days: 2, action: "call_task" });
  const [h] = await t`select id from lead_stage_history where lead_id = ${leadId}`;
  return { a, leadId, rule, entry: h.id as string };
}

const activity = (a: Account, leadId: string, kind: string, rule: string | null, entry: string | null) => (s: Tx) =>
  s`insert into lead_activity (account_id, lead_id, kind, rule_id, stage_history_id)
    values (${a.accountId}, ${leadId}, ${kind}, ${rule}, ${entry})`;

describe("rule-made activity (hidden)", () => {
  it("counts a send and a call task from the same rule and entry as one", () =>
    tx(async (t) => {
      const { a, leadId, rule, entry } = await withRule(t);
      const send = await setting(t, a, "follow_up_rule", "enquiry_day_1", { stage: "enquiry", days: 1, action: "send_template", template: "enquiry_day_1" });
      await activity(a, leadId, "follow_up_send", send, entry)(t);
      expect((await errorOf(t, activity(a, leadId, "call_task", send, entry)))?.code).toBe("23505");
    }));

  it("lets the same rule act again on a new stage entry", () =>
    tx(async (t) => {
      const { a, leadId, rule, entry } = await withRule(t);
      await activity(a, leadId, "call_task", rule, entry)(t);
      const [h2] = await t`
        insert into lead_stage_history (account_id, lead_id, stage_id) values (${a.accountId}, ${leadId}, ${a.stageIds[0]})
        returning id`;
      expect(await errorOf(t, activity(a, leadId, "call_task", rule, h2.id as string))).toBeNull();
    }));

  it("leaves hand-made call tasks unlimited, with or without a stage entry", () =>
    tx(async (t) => {
      const { a, leadId, entry } = await withRule(t);
      for (const e of [null, null, entry, entry]) {
        expect(await errorOf(t, activity(a, leadId, "call_task", null, e))).toBeNull();
      }
    }));

  it("still requires a send to have a rule and an entry", () =>
    tx(async (t) => {
      const { a, leadId, rule, entry } = await withRule(t);
      expect((await errorOf(t, activity(a, leadId, "follow_up_send", null, entry)))?.code).toBe("23514");
      expect((await errorOf(t, activity(a, leadId, "follow_up_send", rule, null)))?.code).toBe("23514");
    }));
});

describe("a used follow-up rule (hidden)", () => {
  it("is turned off, not deleted", () =>
    tx(async (t) => {
      const { a, leadId, rule, entry } = await withRule(t);
      await activity(a, leadId, "call_task", rule, entry)(t);
      expect(await errorOf(t, (s) => s`update admissions_settings set active = false where id = ${rule}`)).toBeNull();
    }));

  it("can be deleted after its lead is gone", () =>
    tx(async (t) => {
      const { a, leadId, rule, entry } = await withRule(t);
      await activity(a, leadId, "call_task", rule, entry)(t);
      await t`delete from leads where id = ${leadId}`;
      expect(await errorOf(t, (s) => s`delete from admissions_settings where id = ${rule}`)).toBeNull();
    }));

  it("refuses an admin's delete too", () =>
    tx(async (t) => {
      const { a, leadId, rule, entry } = await withRule(t);
      await activity(a, leadId, "call_task", rule, entry)(t);
      await actAs(t, await member(t, a.accountId, "admin"));
      expect((await errorOf(t, (s) => s`delete from admissions_settings where id = ${rule}`))?.code).toBe("23503");
    }));

  it("is a NO ACTION foreign key", () =>
    tx(async (t) => {
      const [c] = await t`select confdeltype from pg_constraint where conname = 'lead_activity_rule_id_fkey'`;
      expect(c.confdeltype).toBe("a");
    }));
});

describe("people add call tasks (hidden)", () => {
  it("refuses an admin adding a rule-made call task", () =>
    tx(async (t) => {
      const { a, leadId, rule, entry } = await withRule(t);
      await actAs(t, await member(t, a.accountId, "admin"));
      expect((await errorOf(t, activity(a, leadId, "call_task", rule, entry)))?.code).toBe("42501");
    }));

  it("still lets an agent log a call on a rule-made task", () =>
    tx(async (t) => {
      const { a, leadId, rule, entry } = await withRule(t);
      await activity(a, leadId, "call_task", rule, entry)(t);
      await actAs(t, await member(t, a.accountId, "agent"));
      const r = await t`update lead_activity set outcome = 'spoke', done_at = now() where lead_id = ${leadId}`;
      expect(r.count).toBe(1);
    }));
});
