// G0.3, invariant 2: who reads and writes the six admissions tables (migration 101, ADR 0006).
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, actAsSuperuser, errorOf, lead, member, setting, signUp, sql, tx } from "./db";

afterAll(() => sql.end());

describe("RLS on the admissions tables (G0.3)", () => {
  it("lets any member read their account's leads and settings", () =>
    tx(async (t) => {
      const a = await account(t);
      await lead(t, a);
      await setting(t, a, "campus", "baner");
      const viewer = await member(t, a.accountId, "viewer");
      await actAs(t, viewer);
      expect(await t`select id from leads`).toHaveLength(1);
      expect(await t`select id from admissions_settings`).toHaveLength(1);
    }));

  it("lets an agent book a visit for a lead", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const err = await errorOf(
        t,
        (s) => s`insert into visits (account_id, lead_id, cal_booking_id, starts_at) values (${a.accountId}, ${leadId}, 'cal_rls_1', now())`,
      );
      expect(err).toBeNull();
    }));

  it("stops a viewer booking a visit", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const viewer = await member(t, a.accountId, "viewer");
      await actAs(t, viewer);
      const err = await errorOf(
        t,
        (s) => s`insert into visits (account_id, lead_id, cal_booking_id, starts_at) values (${a.accountId}, ${leadId}, 'cal_rls_2', now())`,
      );
      expect(err?.code).toBe("42501");
    }));

  it("lets an admin add a setting but not an agent", () =>
    tx(async (t) => {
      const a = await account(t);
      const admin = await member(t, a.accountId, "admin");
      const agent = await member(t, a.accountId, "agent");
      const add = (key: string) => (s: typeof t) =>
        s`insert into admissions_settings (account_id, kind, key, label) values (${a.accountId}, 'source', ${key}, ${key})`;
      await actAs(t, admin);
      expect(await errorOf(t, add("walk_in"))).toBeNull();
      await actAsSuperuser(t);
      await actAs(t, agent);
      expect((await errorOf(t, add("website")))?.code).toBe("42501");
    }));

  it("shows a signed-in user with no profile zero leads", () =>
    tx(async (t) => {
      const a = await account(t);
      await lead(t, a);
      const stranger = await signUp(t);
      await t`delete from profiles where user_id = ${stranger}`;
      await actAs(t, stranger);
      expect(await t`select id from leads`).toHaveLength(0);
    }));
});
