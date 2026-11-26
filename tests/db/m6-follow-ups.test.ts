// M6 follow-ups (#69, migration 115, ADR 0028): the cron claims each due follow-up once. Every test rolls back, and only
// looks at its own account's rows (the local database is shared).
import { afterAll, describe, expect, it } from "vitest";
import { type Account, type Tx, account, actAs, errorOf, lead, member, setting, sql, tx } from "./db";

afterAll(() => sql.end());

/** A lead that entered Visited (stage 2) `daysAgo` days ago, and a rule on that stage. */
async function setUp(t: Tx, rule: Record<string, unknown>, daysAgo = 3) {
  const a = await account(t);
  const { leadId, contactId } = await lead(t, a, { stageId: a.stageIds[2] });
  await t`update lead_stage_history set entered_at = now() - make_interval(days => ${daysAgo}) where lead_id = ${leadId}`;
  const ruleId = await setting(t, a, "follow_up_rule", `rule_${rule.action}_${rule.days}`, { stage: a.stageIds[2], ...rule });
  return { a, leadId, contactId, ruleId };
}

const SEND = { days: 3, action: "send_template", template: "visit_feedback" };

/** Runs the cron's claim and returns what it claimed for this account. */
const claim = (t: Tx, a: Account) =>
  t`select activity_id, contact_id, owner_id, template from claim_due_follow_ups() where account_id = ${a.accountId}`;
const activityOf = (t: Tx, leadId: string) => t`select kind, rule_id, done_at from lead_activity where lead_id = ${leadId}`;

/** The parent writes on WhatsApp `hoursAgo` hours ago (the messages trigger stamps conversations.last_inbound_at). */
async function parentWrites(t: Tx, a: Account, contactId: string, hoursAgo: number) {
  const [c] = await t`
    insert into conversations (user_id, account_id, contact_id) values (${a.ownerId}, ${a.accountId}, ${contactId}) returning id`;
  await t`
    insert into messages (conversation_id, sender_type, content_text, created_at)
    values (${c.id}, 'customer', 'Fees?', now() - make_interval(hours => ${hoursAgo}))`;
}

describe("G6.3 a follow-up is claimed once per rule and stage entry", () => {
  it("claims a due send once; the second run claims nothing", () =>
    tx(async (t) => {
      const { a, leadId, contactId, ruleId } = await setUp(t, SEND);
      const first = await claim(t, a);
      expect(first).toEqual([{ activity_id: expect.any(String), contact_id: contactId, owner_id: a.ownerId, template: "visit_feedback" }]);
      expect(await claim(t, a)).toEqual([]);
      expect(await activityOf(t, leadId)).toEqual([{ kind: "follow_up_send", rule_id: ruleId, done_at: null }]);
    }));

  it("a new stage entry is a new slot: the rule can follow up again after the lead comes back", () =>
    tx(async (t) => {
      const { a, leadId } = await setUp(t, SEND);
      expect(await claim(t, a)).toHaveLength(1);
      await t`insert into lead_stage_history (account_id, lead_id, stage_id, entered_at)
              values (${a.accountId}, ${leadId}, ${a.stageIds[2]}, now() + interval '1 second')`;
      expect(await t`select * from claim_due_follow_ups(now() + interval '4 days') where account_id = ${a.accountId}`).toHaveLength(1);
      expect(await activityOf(t, leadId)).toHaveLength(2);
    }));
});

describe("G6.2 the day count is read when the cron runs", () => {
  it("is not due before its day, and is due as soon as the rule is shortened", () =>
    tx(async (t) => {
      const { a, ruleId } = await setUp(t, { ...SEND, days: 5 });
      expect(await claim(t, a)).toEqual([]);
      await t`update admissions_settings set value = value || '{"days": 3}' where id = ${ruleId}`;
      expect(await claim(t, a)).toHaveLength(1);
    }));

  it("counts India calendar days, like days in stage", () =>
    tx(async (t) => {
      const { a } = await setUp(t, SEND, 2);
      expect(await claim(t, a)).toEqual([]);
      expect(await t`select * from claim_due_follow_ups(now() + interval '1 day') where account_id = ${a.accountId}`).toHaveLength(1);
    }));
});

describe("G6.4 a rule switched off does nothing", () => {
  it("sends nothing and makes no activity", () =>
    tx(async (t) => {
      const { a, leadId, ruleId } = await setUp(t, SEND);
      await t`update admissions_settings set active = false where id = ${ruleId}`;
      expect(await claim(t, a)).toEqual([]);
      expect(await activityOf(t, leadId)).toEqual([]);
    }));
});

describe("G6.1 a parent's reply pauses the lead's follow-ups", () => {
  it("claims nothing once the parent has written since the lead entered its stage", () =>
    tx(async (t) => {
      const { a, leadId, contactId } = await setUp(t, SEND);
      await parentWrites(t, a, contactId, 24);
      expect(await claim(t, a)).toEqual([]);
      expect(await activityOf(t, leadId)).toEqual([]);
    }));

  it("still follows up when the parent's last message came before the stage entry", () =>
    tx(async (t) => {
      const { a, contactId } = await setUp(t, SEND);
      await parentWrites(t, a, contactId, 24 * 4);
      expect(await claim(t, a)).toHaveLength(1);
    }));

  it("pauses call tasks and Dormant too", () =>
    tx(async (t) => {
      const { a, leadId, contactId } = await setUp(t, { days: 3, action: "call_task" });
      await setting(t, a, "follow_up_rule", "rule_dormant", { stage: a.stageIds[2], days: 3, action: "dormant" });
      await parentWrites(t, a, contactId, 1);
      await claim(t, a);
      expect(await activityOf(t, leadId)).toEqual([]);
      const [l] = await t`select exit from leads where id = ${leadId}`;
      expect(l.exit).toBeNull();
    }));
});

describe("the other actions", () => {
  it("a call-task rule makes one call task and nothing to send", () =>
    tx(async (t) => {
      const { a, leadId, ruleId } = await setUp(t, { days: 3, action: "call_task" });
      expect(await claim(t, a)).toEqual([]);
      expect(await claim(t, a)).toEqual([]);
      expect(await activityOf(t, leadId)).toEqual([{ kind: "call_task", rule_id: ruleId, done_at: null }]);
    }));

  it("a Dormant rule closes the lead as Dormant", () =>
    tx(async (t) => {
      const { a, leadId } = await setUp(t, { days: 3, action: "dormant" });
      await claim(t, a);
      const [l] = await t`select exit, exited_at from leads where id = ${leadId}`;
      expect(l.exit).toBe("dormant");
      expect(l.exited_at).not.toBeNull();
      expect(await activityOf(t, leadId)).toEqual([]);
    }));

  it("leaves a closed lead and another stage's lead alone", () =>
    tx(async (t) => {
      const { a, leadId } = await setUp(t, SEND);
      await t`update leads set exit = 'dormant', exited_at = now() where id = ${leadId}`;
      const other = await lead(t, a, { stageId: a.stageIds[1] });
      await t`update lead_stage_history set entered_at = now() - interval '9 days' where lead_id = ${other.leadId}`;
      expect(await claim(t, a)).toEqual([]);
    }));
});

describe("only the server claims follow-ups", () => {
  it("refuses a signed-in owner", () =>
    tx(async (t) => {
      const a = await account(t);
      await actAs(t, await member(t, a.accountId, "owner"));
      expect((await errorOf(t, (s) => s`select * from claim_due_follow_ups()`))?.code).toBe("42501");
    }));
});
