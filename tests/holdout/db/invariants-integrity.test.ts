// Hidden: lead integrity edge cases (ticket 103).
import { afterAll, describe, expect, it } from "vitest";
import { account, contact, errorOf, lead, setting, sql, tx } from "../../db/db";

afterAll(() => sql.end());

describe("lead integrity edge cases (hidden)", () => {
  it("rejects a campus from another account", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { leadId } = await lead(t, a);
      const theirs = await setting(t, b, "campus", "baner");
      const err = await errorOf(t, (s) => s`update leads set campus_id = ${theirs} where id = ${leadId}`);
      expect(err?.code).toBe("23514");
    }));

  it("rejects a source of the wrong kind and accepts a real source", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const campus = await setting(t, a, "campus", "baner");
      const source = await setting(t, a, "source", "walk_in");
      expect((await errorOf(t, (s) => s`update leads set source_id = ${campus} where id = ${leadId}`))?.code).toBe("23514");
      expect(await errorOf(t, (s) => s`update leads set source_id = ${source} where id = ${leadId}`)).toBeNull();
    }));

  it("rejects a lost reason of the wrong kind", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const campus = await setting(t, a, "campus", "baner");
      const err = await errorOf(
        t,
        (s) => s`update leads set exit = 'lost', exited_at = now(), lost_reason_id = ${campus} where id = ${leadId}`,
      );
      expect(err?.code).toBe("23514");
    }));

  it("checks the settings on insert as well as update", () =>
    tx(async (t) => {
      const a = await account(t);
      const c = await contact(t, a);
      const source = await setting(t, a, "source", "walk_in");
      const [d] = await t`
        insert into deals (user_id, account_id, pipeline_id, stage_id, contact_id, title)
        values (${a.ownerId}, ${a.accountId}, ${a.pipelineId}, ${a.stageIds[0]}, ${c}, 'Lead') returning id`;
      const err = await errorOf(
        t,
        (s) => s`insert into leads (account_id, deal_id, contact_id, campus_id) values (${a.accountId}, ${d.id}, ${c}, ${source})`,
      );
      expect(err?.code).toBe("23514");
    }));

  it("rejects a new lead whose contact or account is not its deal's", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const c = await contact(t, a);
      const stranger = await contact(t, a);
      const [d] = await t`
        insert into deals (user_id, account_id, pipeline_id, stage_id, contact_id, title)
        values (${a.ownerId}, ${a.accountId}, ${a.pipelineId}, ${a.stageIds[0]}, ${c}, 'Lead') returning id`;
      const wrongContact = await errorOf(
        t,
        (s) => s`insert into leads (account_id, deal_id, contact_id) values (${a.accountId}, ${d.id}, ${stranger})`,
      );
      expect(wrongContact?.code).toBe("23514");
      const wrongAccount = await errorOf(
        t,
        (s) => s`insert into leads (account_id, deal_id, contact_id) values (${b.accountId}, ${d.id}, ${c})`,
      );
      expect(wrongAccount?.code).toBe("23514");
    }));

  it("rejects a visit campus of the wrong kind, accepts none or a real campus", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const campus = await setting(t, a, "campus", "baner");
      const source = await setting(t, a, "source", "walk_in");
      const book = (id: string, campusId: string | null) => (s: typeof t) =>
        s`insert into visits (account_id, lead_id, cal_booking_id, starts_at, campus_id)
          values (${a.accountId}, ${leadId}, ${id}, now(), ${campusId})`;
      expect((await errorOf(t, book("cal_a", source)))?.code).toBe("23514");
      expect(await errorOf(t, book("cal_b", campus))).toBeNull();
      expect(await errorOf(t, book("cal_c", null))).toBeNull();
    }));

  it("rejects an activity whose rule is not a follow-up rule", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const campus = await setting(t, a, "campus", "baner");
      const rule = await setting(t, a, "follow_up_rule", "enquiry_day_2", { stage: "enquiry", days: 2, action: "call_task" });
      const task = (ruleId: string) => (s: typeof t) =>
        s`insert into lead_activity (account_id, lead_id, kind, rule_id) values (${a.accountId}, ${leadId}, 'call_task', ${ruleId})`;
      expect((await errorOf(t, task(campus)))?.code).toBe("23514");
      expect(await errorOf(t, task(rule))).toBeNull();
    }));

  it("stops a deal with a lead losing its contact", () =>
    tx(async (t) => {
      const a = await account(t);
      const { dealId } = await lead(t, a);
      const err = await errorOf(t, (s) => s`update deals set contact_id = null where id = ${dealId}`);
      expect(err?.code).toBe("23514");
    }));

  it("leaves a deal without a lead free to change or drop its contact", () =>
    tx(async (t) => {
      const a = await account(t);
      const c = await contact(t, a);
      const [d] = await t`
        insert into deals (user_id, account_id, pipeline_id, stage_id, contact_id, title)
        values (${a.ownerId}, ${a.accountId}, ${a.pipelineId}, ${a.stageIds[0]}, ${c}, 'Plain deal') returning id`;
      expect(await errorOf(t, (s) => s`update deals set contact_id = ${null} where id = ${d.id}`)).toBeNull();
    }));

  it("refuses to move a lead onto a contact that already has an open lead", () =>
    tx(async (t) => {
      const a = await account(t);
      const first = await lead(t, a);
      const second = await lead(t, a);
      const err = await errorOf(t, (s) => s`update deals set contact_id = ${first.contactId} where id = ${second.dealId}`);
      expect(err?.code).toBe("23505");
    }));
});
