// Hidden: settings audit edge cases (ticket 105).
import { afterAll, describe, expect, it } from "vitest";
import { account, setting, sql, tx } from "../../db/db";

afterAll(() => sql.end());

describe("settings audit edge cases (hidden)", () => {
  it("records who made the change", () =>
    tx(async (t) => {
      const a = await account(t);
      await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: a.ownerId, role: "authenticated" })}, true)`;
      const id = await setting(t, a, "campus", "baner");
      const [r] = await t`select changed_by, account_id from settings_changes where setting_id = ${id}`;
      expect(r).toEqual({ changed_by: a.ownerId, account_id: a.accountId });
    }));

  it("writes one row per setting when one statement changes several", () =>
    tx(async (t) => {
      const a = await account(t);
      await setting(t, a, "source", "walk_in");
      await setting(t, a, "source", "website");
      await t`update admissions_settings set active = false where account_id = ${a.accountId}`;
      const [{ n }] = await t`select count(*)::int as n from settings_changes where account_id = ${a.accountId} and action = 'update'`;
      expect(n).toBe(2);
    }));

  it("keeps kind and key on a delete and the whole row in old_value", () =>
    tx(async (t) => {
      const a = await account(t);
      const id = await setting(t, a, "alert", "untouched_hours", { threshold: 24 });
      await t`delete from admissions_settings where id = ${id}`;
      const [r] = await t`
        select kind, key, account_id, (old_value->'value'->>'threshold')::int as threshold, old_value->>'id' as old_id
        from settings_changes where setting_id = ${id} and action = 'delete'`;
      expect(r).toEqual({ kind: "alert", key: "untouched_hours", account_id: a.accountId, threshold: 24, old_id: id });
    }));

  it("writes the audit as the function owner, not the caller", () =>
    tx(async (t) => {
      const [f] = await t`select prosecdef from pg_proc where proname = 'audit_admissions_settings'`;
      expect(f.prosecdef).toBe(true);
    }));

  it("writes nothing for changes to other tables", () =>
    tx(async (t) => {
      const a = await account(t);
      await t`update accounts set name = 'Renamed' where id = ${a.accountId}`;
      const [{ n }] = await t`select count(*)::int as n from settings_changes where account_id = ${a.accountId}`;
      expect(n).toBe(0);
    }));
});
