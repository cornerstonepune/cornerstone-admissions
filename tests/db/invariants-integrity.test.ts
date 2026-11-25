// Lead integrity (migration 103): settings of the right kind, and a lead always matches its deal.
import { afterAll, describe, expect, it } from "vitest";
import { account, contact, errorOf, lead, setting, sql, tx } from "./db";

afterAll(() => sql.end());

describe("lead integrity", () => {
  it("accepts a campus that is a campus setting", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const campus = await setting(t, a, "campus", "baner");
      expect(await errorOf(t, (s) => s`update leads set campus_id = ${campus} where id = ${leadId}`)).toBeNull();
    }));

  it("rejects a campus that is a source setting", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const source = await setting(t, a, "source", "walk_in");
      const err = await errorOf(t, (s) => s`update leads set campus_id = ${source} where id = ${leadId}`);
      expect(err?.code).toBe("23514");
    }));

  it("rejects a lead whose contact is not its deal's contact", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const other = await contact(t, a);
      const err = await errorOf(t, (s) => s`update leads set contact_id = ${other} where id = ${leadId}`);
      expect(err?.code).toBe("23514");
    }));

  it("carries a deal's new contact over to its lead", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, dealId } = await lead(t, a);
      const other = await contact(t, a);
      await t`update deals set contact_id = ${other} where id = ${dealId}`;
      const [l] = await t`select contact_id from leads where id = ${leadId}`;
      expect(l.contact_id).toBe(other);
    }));
});
