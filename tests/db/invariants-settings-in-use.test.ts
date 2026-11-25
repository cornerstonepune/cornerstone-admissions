// A setting in use keeps its kind and account (migration 108, ADR 0015 §1).
import { afterAll, describe, expect, it } from "vitest";
import { account, errorOf, lead, setting, sql, tx } from "./db";

afterAll(() => sql.end());

const IN_USE = /A setting in use cannot change its kind or account/;

describe("settings in use", () => {
  it("rejects changing the kind of a campus a lead uses", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const campus = await setting(t, a, "campus", "baner");
      await t`update leads set campus_id = ${campus} where id = ${leadId}`;
      const err = await errorOf(t, (s) => s`update admissions_settings set kind = 'source' where id = ${campus}`);
      expect(err?.code).toBe("23514");
      expect(err?.message).toMatch(IN_USE);
    }));

  it("rejects moving a source a lead uses to another account", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { leadId } = await lead(t, a);
      const source = await setting(t, a, "source", "walk_in");
      await t`update leads set source_id = ${source} where id = ${leadId}`;
      const err = await errorOf(t, (s) => s`update admissions_settings set account_id = ${b.accountId} where id = ${source}`);
      expect(err?.code).toBe("23514");
      expect(err?.message).toMatch(IN_USE);
    }));

  it("lets a used setting change its label", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const campus = await setting(t, a, "campus", "baner");
      await t`update leads set campus_id = ${campus} where id = ${leadId}`;
      expect(await errorOf(t, (s) => s`update admissions_settings set label = 'Baner campus' where id = ${campus}`)).toBeNull();
    }));

  it("lets an unused setting change its kind", () =>
    tx(async (t) => {
      const a = await account(t);
      const campus = await setting(t, a, "campus", "baner");
      expect(await errorOf(t, (s) => s`update admissions_settings set kind = 'source' where id = ${campus}`)).toBeNull();
    }));
});
