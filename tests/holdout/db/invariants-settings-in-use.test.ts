// Hidden: settings in use, edge cases (ticket 108).
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, errorOf, lead, member, setting, sql, tx } from "../../db/db";

afterAll(() => sql.end());

const IN_USE = /A setting in use cannot change its kind or account/;

describe("settings in use (hidden)", () => {
  it("counts a campus used only by a visit", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const campus = await setting(t, a, "campus", "baner");
      await t`insert into visits (account_id, lead_id, cal_booking_id, starts_at, campus_id)
              values (${a.accountId}, ${leadId}, 'cal_1', now(), ${campus})`;
      const err = await errorOf(t, (s) => s`update admissions_settings set kind = 'source' where id = ${campus}`);
      expect(err?.code).toBe("23514");
      expect(err?.message).toMatch(IN_USE);
    }));

  it("counts a follow-up rule used only by a lead activity", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { leadId } = await lead(t, a);
      const rule = await setting(t, a, "follow_up_rule", "enquiry_day_2", { stage: "Enquiry", days: 2, action: "call_task" });
      await t`insert into lead_activity (account_id, lead_id, kind, rule_id) values (${a.accountId}, ${leadId}, 'call_task', ${rule})`;
      const err = await errorOf(t, (s) => s`update admissions_settings set account_id = ${b.accountId} where id = ${rule}`);
      expect(err?.code).toBe("23514");
      expect(err?.message).toMatch(IN_USE);
    }));

  it("counts a lost reason a lead uses", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const reason = await setting(t, a, "lost_reason", "fees");
      await t`update leads set lost_reason_id = ${reason}, exit = 'lost' where id = ${leadId}`;
      const err = await errorOf(t, (s) => s`update admissions_settings set kind = 'source' where id = ${reason}`);
      expect(err?.code).toBe("23514");
    }));

  it("refuses an admin too, through RLS", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const campus = await setting(t, a, "campus", "baner");
      await t`update leads set campus_id = ${campus} where id = ${leadId}`;
      const admin = await member(t, a.accountId, "admin");
      await actAs(t, admin);
      const err = await errorOf(t, (s) => s`update admissions_settings set kind = 'source' where id = ${campus}`);
      expect(err?.code).toBe("23514");
      expect(await errorOf(t, (s) => s`update admissions_settings set active = false where id = ${campus}`)).toBeNull();
    }));

  it("allows an update that leaves kind and account as they are", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const campus = await setting(t, a, "campus", "baner");
      await t`update leads set campus_id = ${campus} where id = ${leadId}`;
      expect(
        await errorOf(t, (s) => s`update admissions_settings set kind = 'campus', account_id = ${a.accountId} where id = ${campus}`),
      ).toBeNull();
    }));
});
