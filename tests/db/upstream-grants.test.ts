// Migration 112 (ADR 0012): upstream tables are granted to authenticated, and RLS still keeps each account to itself.
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, actAsSuperuser, errorOf, lead, member, sql, tx } from "./db";

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

  it("lets an agent's UPDATE and DELETE on another account's deal touch 0 rows", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { dealId: theirs } = await lead(t, b);
      await actAs(t, await member(t, a.accountId, "agent"));
      const updated = await t`update deals set title = 'Taken' where id = ${theirs} returning id`;
      const deleted = await t`delete from deals where id = ${theirs} returning id`;
      expect(updated).toHaveLength(0);
      expect(deleted).toHaveLength(0);
      await actAsSuperuser(t);
      const [d] = await t`select title from deals where id = ${theirs}`;
      expect(d.title).toBe("Lead");
    }));

  it("gives anon nothing", () =>
    tx(async (t) => {
      await actAs(t, null);
      await expect(t`select id from deals limit 1`).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("secret columns (migration 114)", () => {
  it("keeps webhook_endpoints.secret from every signed-in role, admin included, but shows the rest", () =>
    tx(async (t) => {
      const a = await account(t);
      await t`insert into webhook_endpoints (account_id, url, secret) values (${a.accountId}, 'https://example.test/h', 'enc')`;
      for (const role of ["admin", "agent", "viewer"] as const) {
        await actAs(t, await member(t, a.accountId, role));
        const err = await errorOf(t, (s) => s`select secret from webhook_endpoints`);
        expect(err?.code).toBe("42501");
        const rows = await t`select id, url from webhook_endpoints`;
        expect(rows).toHaveLength(1);
        await actAsSuperuser(t);
      }
    }));
});
