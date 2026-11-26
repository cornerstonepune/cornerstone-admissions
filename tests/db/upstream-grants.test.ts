// Migration 112 (ADR 0012): upstream tables are granted to authenticated, and RLS still keeps each account to itself.
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, lead, member, sql, tx } from "./db";

afterAll(() => sql.end());

describe("upstream table grants", () => {
  it("lets a member read their own account's deal but not another account's", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { dealId: own } = await lead(t, a);
      const { dealId: theirs } = await lead(t, b);
      await actAs(t, await member(t, a.accountId, "viewer"));
      const rows = await t`select id from deals where id in (${own}, ${theirs})`;
      expect(rows.map((r) => r.id)).toEqual([own]);
    }));

  it("gives anon nothing", () =>
    tx(async (t) => {
      await actAs(t, null);
      await expect(t`select id from deals limit 1`).rejects.toMatchObject({ code: "42501" });
    }));
});
