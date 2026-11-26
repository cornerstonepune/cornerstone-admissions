// M6 follow-ups review fixes (migration 118, ADR 0028 §9): imported leads aren't new, no catch-up burst, 50 per run.
// Every test rolls back and reads only its own account's rows (the local database is shared).
import { afterAll, describe, expect, it } from "vitest";
import { type Account, type Tx, account, lead, setting, sql, tx } from "./db";

afterAll(() => sql.end());

const VISITED = 2;
const rule = (t: Tx, a: Account, key: string, v: Record<string, unknown>, stage = VISITED) =>
  setting(t, a, "follow_up_rule", key, { stage: a.stageIds[stage], ...v });
/** Puts a lead's stage entry `days` days in the past. */
const enteredAgo = (t: Tx, leadId: string, days: number) =>
  t`update lead_stage_history set entered_at = now() - make_interval(days => ${days}) where lead_id = ${leadId}`;
const claim = (t: Tx, a: Account, at = t`now()`) =>
  t`select activity_id, template from claim_due_follow_ups(${at}) where account_id = ${a.accountId}`;
const madeFor = (t: Tx, leadId: string) =>
  t`select a.kind, s.key from lead_activity a join admissions_settings s on s.id = a.rule_id
    where a.lead_id = ${leadId} order by s.key`;

describe("(a) an imported lead is not new", () => {
  it("gets no follow-up from the stage entry the import made, then follows up once staff move it", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a, { stageId: a.stageIds[VISITED] });
      // As import_leads does (117): imported_at and the first stage entry are the import's moment; created_at the sheet's.
      await t`update leads set imported_at = now() - interval '5 days', created_at = now() - interval '60 days'
              where id = ${leadId}`;
      await enteredAgo(t, leadId, 5);
      await rule(t, a, "visited_call", { days: 0, action: "call_task" });
      await rule(t, a, "visited_send", { days: 3, action: "send_template", template: "visit_feedback" });
      await rule(t, a, "deciding_call", { days: 0, action: "call_task" }, VISITED + 1);
      expect(await claim(t, a)).toEqual([]);
      expect(await madeFor(t, leadId)).toEqual([]);

      await t`select public.move_lead(${leadId}, ${a.stageIds[VISITED + 1]})`;
      await claim(t, a);
      expect(await madeFor(t, leadId)).toEqual([{ kind: "call_task", key: "deciding_call" }]);
    }));
});

describe("(b) no catch-up burst", () => {
  it("fires only the latest due day of a stage entry, and never the earlier ones", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a, { stageId: a.stageIds[VISITED] });
      await enteredAgo(t, leadId, 10);
      await rule(t, a, "d3_send", { days: 3, action: "send_template", template: "early" });
      await rule(t, a, "d7_send", { days: 7, action: "send_template", template: "late" });
      await rule(t, a, "d7_call", { days: 7, action: "call_task" });
      await rule(t, a, "d9_later", { days: 12, action: "send_template", template: "not_yet" });
      expect((await claim(t, a)).map((r) => r.template)).toEqual(["late"]);
      expect(await madeFor(t, leadId)).toEqual([
        { kind: "call_task", key: "d7_call" },
        { kind: "follow_up_send", key: "d7_send" },
      ]);
      expect(await claim(t, a)).toEqual([]);
      expect(await madeFor(t, leadId)).toHaveLength(2);
    }));

  it("still fires each rule on its own day when the cron keeps up", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a, { stageId: a.stageIds[VISITED] });
      await enteredAgo(t, leadId, 4);
      await rule(t, a, "d3_send", { days: 3, action: "send_template", template: "early" });
      await rule(t, a, "d7_send", { days: 7, action: "send_template", template: "late" });
      expect((await claim(t, a)).map((r) => r.template)).toEqual(["early"]);
      expect((await claim(t, a, t`now() + interval '3 days'`)).map((r) => r.template)).toEqual(["late"]);
    }));

  it("sends nothing in the run a Dormant rule closes the lead", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a, { stageId: a.stageIds[VISITED] });
      await enteredAgo(t, leadId, 10);
      await rule(t, a, "d3_send", { days: 3, action: "send_template", template: "early" });
      await rule(t, a, "d10_send", { days: 10, action: "send_template", template: "last_word" });
      await rule(t, a, "d10_call", { days: 10, action: "call_task" });
      await rule(t, a, "d5_dormant", { days: 5, action: "dormant" });
      expect(await claim(t, a)).toEqual([]);
      expect(await madeFor(t, leadId)).toEqual([]);
      const [l] = await t`select exit from leads where id = ${leadId}`;
      expect(l.exit).toBe("dormant");
    }));
});

describe("(c) at most 50 follow-ups per run", () => {
  it("claims 50, then the rest on the next run, oldest stage entry first", () =>
    tx(async (t) => {
      const a = await account(t);
      await rule(t, a, "d0_send", { days: 0, action: "send_template", template: "hello" });
      for (let i = 0; i < 60; i++) {
        const { leadId } = await lead(t, a, { stageId: a.stageIds[VISITED] });
        await enteredAgo(t, leadId, 1000 + i); // older than anything else in a shared database: these go first
      }
      const runs = [(await claim(t, a)).length, (await claim(t, a)).length, (await claim(t, a)).length];
      expect(runs).toEqual([50, 10, 0]);
    }));
});
