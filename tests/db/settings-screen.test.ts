// #70 · The writes the Admissions Settings API makes, as the caller (RLS on): an agent changes nothing; an admin's
// change leaves exactly one settings_changes row, written by the trigger (migration 105) with who and when.
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, actAsSuperuser, errorOf, member, setting, sql, tx, type Tx } from "./db";

afterAll(() => sql.end());

const changesOf = async (t: Tx, id: string) =>
  t`select action, changed_by, changed_at, old_value->'value' as old, new_value->'value' as new
    from settings_changes where setting_id = ${id} order by changed_at`;

describe("Admissions Settings: permission", () => {
  it("an agent can't add a setting", () =>
    tx(async (t) => {
      const a = await account(t);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const err = await errorOf(t, (s) => s`insert into admissions_settings (account_id, kind, key, label) values (${a.accountId}, 'source', 'gate', 'Gate QR')`);
      expect(err?.code).toBe("42501");
    }));

  it("an agent's change to a setting touches no row and writes no audit row", () =>
    tx(async (t) => {
      const a = await account(t);
      const id = await setting(t, a, "alert", "untouched", { threshold: 24 });
      const before = (await changesOf(t, id)).length;
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const rows = await t`update admissions_settings set value = '{"threshold": 48}' where id = ${id} returning id`;
      expect(rows).toHaveLength(0);
      await actAsSuperuser(t);
      const [s] = await t`select value from admissions_settings where id = ${id}`;
      expect(s.value).toEqual({ threshold: 24 });
      expect(await changesOf(t, id)).toHaveLength(before);
    }));

  it("an agent can't forge an audit row", () =>
    tx(async (t) => {
      const a = await account(t);
      const id = await setting(t, a, "source", "gate");
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const err = await errorOf(t, (s) => s`insert into settings_changes (account_id, setting_id, kind, key, action) values (${a.accountId}, ${id}, 'source', 'gate', 'update')`);
      expect(err?.code).toBe("42501");
    }));
});

describe("Admissions Settings: audit", () => {
  it("an admin's change writes one settings_changes row with who, when, before and after", () =>
    tx(async (t) => {
      const a = await account(t);
      const id = await setting(t, a, "alert", "untouched", { threshold: 24 });
      const before = (await changesOf(t, id)).length;
      const admin = await member(t, a.accountId, "admin");
      await actAs(t, admin);
      const rows = await t`update admissions_settings set value = '{"threshold": 48}' where id = ${id} returning id`;
      expect(rows).toHaveLength(1);
      const changes = await changesOf(t, id);
      expect(changes).toHaveLength(before + 1);
      // one transaction = one now(), so pick the update by its action, not by time
      const updates = changes.filter((c) => c.action === "update");
      expect(updates).toHaveLength(1);
      const last = updates[0];
      expect(last).toMatchObject({ action: "update", changed_by: admin, old: { threshold: 24 }, new: { threshold: 48 } });
      expect(last.changed_at).toBeInstanceOf(Date);
    }));

  it("an owner adding a setting writes one insert row, and a viewer can read the change log", () =>
    tx(async (t) => {
      const a = await account(t);
      await actAs(t, a.ownerId);
      const [s] = await t`insert into admissions_settings (account_id, kind, key, label) values (${a.accountId}, 'lost_reason', 'fees', 'Fees') returning id`;
      expect(await changesOf(t, s.id)).toEqual([expect.objectContaining({ action: "insert", changed_by: a.ownerId })]);
      await actAsSuperuser(t);
      const viewer = await member(t, a.accountId, "viewer");
      await actAs(t, viewer);
      expect(await t`select id from settings_changes where setting_id = ${s.id}`).toHaveLength(1);
    }));

  it("switching a setting off is one audited update", () =>
    tx(async (t) => {
      const a = await account(t);
      const id = await setting(t, a, "follow_up_rule", "applied_day_3_call_task", { stage: "Applied", days: 3, action: "call_task" });
      const admin = await member(t, a.accountId, "admin");
      await actAs(t, admin);
      await t`update admissions_settings set active = false where id = ${id}`;
      const updates = await t`select old_value->>'active' as was, new_value->>'active' as now from settings_changes
                              where setting_id = ${id} and action = 'update'`;
      expect(updates).toEqual([{ was: "true", now: "false" }]);
    }));
});

describe("Admissions Settings: the audit can't be forged (#81 review)", () => {
  it.each(["admin", "owner"] as const)("an %s can't insert, change or delete an audit row", (role) =>
    tx(async (t) => {
      const a = await account(t);
      const id = await setting(t, a, "source", "gate");
      const who = role === "owner" ? a.ownerId : await member(t, a.accountId, "admin");
      await actAs(t, who);
      const err = await errorOf(t, (s) => s`insert into settings_changes (account_id, setting_id, kind, key, action, changed_by)
                                           values (${a.accountId}, ${id}, 'source', 'gate', 'delete', ${who})`);
      expect(err?.code).toBe("42501");
      // no UPDATE or DELETE policy: RLS makes both touch no row, so the trigger's row stays as written
      expect(await t`update settings_changes set changed_by = ${who} where setting_id = ${id} returning id`).toHaveLength(0);
      expect(await t`delete from settings_changes where setting_id = ${id} returning id`).toHaveLength(0);
      await actAsSuperuser(t);
      expect(await t`select action, changed_by from settings_changes where setting_id = ${id}`).toEqual([
        { action: "insert", changed_by: null },
      ]);
    }));
});
