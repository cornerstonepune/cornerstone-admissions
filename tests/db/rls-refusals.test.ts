// G0.3, invariant 2: refused writes touch 0 rows instead of raising (migration 101, ADR 0012, ADR 0013 §4).
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, lead, member, setting, sql, tx } from "./db";

afterAll(() => sql.end());

describe("RLS refusals on the admissions tables", () => {
  it("stops an agent changing or deleting a setting", () =>
    tx(async (t) => {
      const a = await account(t);
      const id = await setting(t, a, "campus", "baner");
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      expect((await t`update admissions_settings set label = 'Agent' where id = ${id}`).count).toBe(0);
      expect((await t`delete from admissions_settings where id = ${id}`).count).toBe(0);
    }));

  it("stops an agent deleting a visit or an activity", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const [v] = await t`
        insert into visits (account_id, lead_id, cal_booking_id, starts_at)
        values (${a.accountId}, ${leadId}, ${"cal_" + leadId}, now()) returning id`;
      const [act] = await t`
        insert into lead_activity (account_id, lead_id, kind) values (${a.accountId}, ${leadId}, 'call_task') returning id`;
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      expect((await t`delete from visits where id = ${v.id}`).count).toBe(0);
      expect((await t`delete from lead_activity where id = ${act.id}`).count).toBe(0);
    }));
});
