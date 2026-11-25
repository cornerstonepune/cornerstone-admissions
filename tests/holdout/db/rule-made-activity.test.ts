// Hidden: rule-made activity edge cases (migration 111, ADR 0017).
import { afterAll, describe, expect, it } from "vitest";
import { type Account, type Tx, account, actAs, actAsSuperuser, errorOf, lead, member, setting, sql, tx } from "../../db/db";

afterAll(() => sql.end());

const WRONG_KIND = /A rule-made activity must be the kind its rule makes/;
const FIXED = /A lead activity keeps its rule and stage entry/;

async function withRules(t: Tx) {
  const a = await account(t);
  const { leadId } = await lead(t, a);
  const sendRule = await setting(t, a, "follow_up_rule", "enquiry_day_1", {
    stage: "enquiry", days: 1, action: "send_template", template: "enquiry_day_1",
  });
  const callRule = await setting(t, a, "follow_up_rule", "enquiry_day_2", { stage: "enquiry", days: 2, action: "call_task" });
  const dormantRule = await setting(t, a, "follow_up_rule", "enquiry_day_30", { stage: "enquiry", days: 30, action: "dormant" });
  const [h] = await t`select id from lead_stage_history where lead_id = ${leadId}`;
  return { a, leadId, sendRule, callRule, dormantRule, entry: h.id as string };
}

const activity = (a: Account, leadId: string, kind: string, rule: string | null, entry: string | null) => (s: Tx) =>
  s`insert into lead_activity (account_id, lead_id, kind, rule_id, stage_history_id)
    values (${a.accountId}, ${leadId}, ${kind}, ${rule}, ${entry}) returning id`;

const newEntry = async (t: Tx, a: Account, leadId: string) => {
  const [h] = await t`
    insert into lead_stage_history (account_id, lead_id, stage_id) values (${a.accountId}, ${leadId}, ${a.stageIds[0]})
    returning id`;
  return h.id as string;
};

describe("rule-made activity kind (hidden)", () => {
  it("lets a dormant rule make no activity of any kind", () =>
    tx(async (t) => {
      const { a, leadId, dormantRule, entry } = await withRules(t);
      for (const kind of ["follow_up_send", "call_task"]) {
        const err = await errorOf(t, activity(a, leadId, kind, dormantRule, entry));
        expect(err?.code).toBe("23514");
        expect(err?.message).toMatch(WRONG_KIND);
      }
    }));

  it("stops the server turning a rule-made send into a call task", () =>
    tx(async (t) => {
      const { a, leadId, sendRule, entry } = await withRules(t);
      const [send] = await activity(a, leadId, "follow_up_send", sendRule, entry)(t);
      const err = await errorOf(t, (s) => s`update lead_activity set kind = 'call_task' where id = ${send.id}`);
      expect(err?.code).toBe("23514");
      expect(err?.message).toMatch(WRONG_KIND);
    }));

  it("leaves hand-made call tasks free of any rule check", () =>
    tx(async (t) => {
      const { a, leadId, entry } = await withRules(t);
      expect(await errorOf(t, activity(a, leadId, "call_task", null, entry))).toBeNull();
      expect(await errorOf(t, activity(a, leadId, "call_task", null, null))).toBeNull();
    }));
});

describe("rule and stage entry fixed (hidden)", () => {
  it("stops an agent clearing the rule or moving the stage entry of a rule-made call task", () =>
    tx(async (t) => {
      const { a, leadId, callRule, entry } = await withRules(t);
      const [task] = await activity(a, leadId, "call_task", callRule, entry)(t);
      const later = await newEntry(t, a, leadId);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      for (const q of [
        (s: Tx) => s`update lead_activity set rule_id = null where id = ${task.id}`,
        (s: Tx) => s`update lead_activity set stage_history_id = ${later} where id = ${task.id}`,
      ]) {
        const err = await errorOf(t, q);
        expect(err?.code).toBe("23514");
        expect(err?.message).toMatch(FIXED);
      }
    }));

  it("stops the server too", () =>
    tx(async (t) => {
      const { a, leadId, sendRule, entry } = await withRules(t);
      const other = await setting(t, a, "follow_up_rule", "enquiry_day_3", {
        stage: "enquiry", days: 3, action: "send_template", template: "enquiry_day_3",
      });
      const [send] = await activity(a, leadId, "follow_up_send", sendRule, entry)(t);
      const err = await errorOf(t, (s) => s`update lead_activity set rule_id = ${other} where id = ${send.id}`);
      expect(err?.code).toBe("23514");
      expect(err?.message).toMatch(FIXED);
    }));

  it("stops an agent adding a call-task rule to a hand-made call task", () =>
    tx(async (t) => {
      const { a, leadId, callRule, entry } = await withRules(t);
      const [task] = await activity(a, leadId, "call_task", null, null)(t);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const err = await errorOf(
        t,
        (s) => s`update lead_activity set rule_id = ${callRule}, stage_history_id = ${entry} where id = ${task.id}`,
      );
      expect(err?.code).toBe("23514");
      expect(err?.message).toMatch(FIXED);
    }));

  it("leaves the engine's send slot free after an agent's refused edit", () =>
    tx(async (t) => {
      const { a, leadId, sendRule, entry } = await withRules(t);
      const [task] = await activity(a, leadId, "call_task", null, null)(t);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      await errorOf(t, (s) => s`update lead_activity set rule_id = ${sendRule}, stage_history_id = ${entry} where id = ${task.id}`);
      await actAsSuperuser(t);
      expect(await errorOf(t, activity(a, leadId, "follow_up_send", sendRule, entry))).toBeNull();
    }));

  it("still lets an agent log a rule-made call task and keeps RLS's 42501 for sends", () =>
    tx(async (t) => {
      const { a, leadId, sendRule, callRule, entry } = await withRules(t);
      const [task] = await activity(a, leadId, "call_task", callRule, entry)(t);
      const [hand] = await activity(a, leadId, "call_task", null, null)(t);
      const later = await newEntry(t, a, leadId);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      expect((await t`update lead_activity set done_at = now() where id = ${task.id}`).count).toBe(1);
      const err = await errorOf(
        t,
        (s) => s`
          update lead_activity set kind = 'follow_up_send', rule_id = ${sendRule}, stage_history_id = ${later}
          where id = ${hand.id}`,
      );
      expect(err?.code).toBe("42501");
    }));
});

describe("a used follow-up rule's action (hidden)", () => {
  it("lets a used rule change its days, stage, template, label and active flag", () =>
    tx(async (t) => {
      const { a, leadId, sendRule, entry } = await withRules(t);
      await activity(a, leadId, "follow_up_send", sendRule, entry)(t);
      const err = await errorOf(
        t,
        (s) => s`update admissions_settings
                 set value = ${s.json({ stage: "visit_booked", days: 4, action: "send_template", template: "new_t" })},
                     label = 'Renamed', active = false
                 where id = ${sendRule}`,
      );
      expect(err).toBeNull();
    }));

  it("stops even an admin changing a used rule to dormant", () =>
    tx(async (t) => {
      const { a, leadId, callRule, entry } = await withRules(t);
      await activity(a, leadId, "call_task", callRule, entry)(t);
      const admin = await member(t, a.accountId, "admin");
      await actAs(t, admin);
      const err = await errorOf(
        t,
        (s) => s`update admissions_settings set value = ${s.json({ stage: "enquiry", days: 2, action: "dormant" })}
                 where id = ${callRule}`,
      );
      expect(err?.code).toBe("23514");
    }));

  it("leaves other settings' values alone", () =>
    tx(async (t) => {
      const a = await account(t);
      const campus = await setting(t, a, "campus", "baner");
      const { leadId } = await lead(t, a);
      await t`update leads set campus_id = ${campus} where id = ${leadId}`;
      expect(await errorOf(t, (s) => s`update admissions_settings set value = ${s.json({ city: "Pune" })} where id = ${campus}`)).toBeNull();
    }));

  it("doesn't stop a whole account being deleted", () =>
    tx(async (t) => {
      const { a, leadId, sendRule, callRule, entry } = await withRules(t);
      await activity(a, leadId, "follow_up_send", sendRule, entry)(t);
      await activity(a, leadId, "call_task", callRule, entry)(t);
      expect(await errorOf(t, (s) => s`delete from accounts where id = ${a.accountId}`)).toBeNull();
    }));
});
