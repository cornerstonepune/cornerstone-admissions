// Invariant 7 (migration 105): every change to an admissions setting leaves one audit row.
import { afterAll, describe, expect, it } from "vitest";
import { account, setting, sql, tx } from "./db";

afterAll(() => sql.end());

describe("settings audit (invariant 7)", () => {
  it("records a new setting", () =>
    tx(async (t) => {
      const a = await account(t);
      const id = await setting(t, a, "campus", "baner");
      const rows = await t`select action, kind, key, old_value, new_value->>'label' as label from settings_changes where setting_id = ${id}`;
      expect(rows).toEqual([{ action: "insert", kind: "campus", key: "baner", old_value: null, label: "baner" }]);
    }));

  it("records a change with the row before and after", () =>
    tx(async (t) => {
      const a = await account(t);
      const id = await setting(t, a, "campus", "baner");
      await t`update admissions_settings set label = 'Baner campus' where id = ${id}`;
      const rows = await t`
        select old_value->>'label' as before, new_value->>'label' as after from settings_changes
        where setting_id = ${id} and action = 'update'`;
      expect(rows).toEqual([{ before: "baner", after: "Baner campus" }]);
    }));

  it("keeps the record of a deleted setting", () =>
    tx(async (t) => {
      const a = await account(t);
      const id = await setting(t, a, "source", "walk_in");
      await t`delete from admissions_settings where id = ${id}`;
      const rows = await t`
        select old_value->>'key' as key, new_value from settings_changes where setting_id = ${id} and action = 'delete'`;
      expect(rows).toEqual([{ key: "walk_in", new_value: null }]);
    }));
});
