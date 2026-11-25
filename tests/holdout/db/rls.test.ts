// Hidden: RLS edge cases for the admissions tables (ticket 101).
import { afterAll, describe, expect, it } from "vitest";
import { type Tx, account, actAs, actAsSuperuser, errorOf, lead, member, setting, signUp, sql, tx } from "../../db/db";

afterAll(() => sql.end());

/** One row in each of the six admissions tables for account `a`. */
async function fill(t: Tx, a: Awaited<ReturnType<typeof account>>) {
  const { leadId } = await lead(t, a);
  const settingId = await setting(t, a, "campus", "baner");
  await t`insert into visits (account_id, lead_id, cal_booking_id, starts_at) values (${a.accountId}, ${leadId}, ${"cal_" + leadId}, now())`;
  const [h] = await t`insert into lead_stage_history (account_id, lead_id, stage_id) values (${a.accountId}, ${leadId}, ${a.stageIds[0]}) returning id`;
  await t`insert into lead_activity (account_id, lead_id, kind) values (${a.accountId}, ${leadId}, 'call_task')`;
  await t`
    insert into settings_changes (account_id, setting_id, kind, key, action)
    values (${a.accountId}, ${settingId}, 'campus', 'baner', 'insert')`;
  return { leadId, settingId, historyId: h.id as string };
}

const SIX = ["admissions_settings", "leads", "visits", "lead_stage_history", "lead_activity", "settings_changes"];

/** Rows visible in `table` to the current role; a permission error counts as zero visible. */
async function visible(t: Tx, table: string): Promise<number> {
  let n = 0;
  const err = await errorOf(t, async (s) => {
    const [r] = await s.unsafe(`select count(*)::int as n from public."${table}"`);
    n = r.n as number;
  });
  return err ? 0 : n;
}

describe("RLS edge cases (hidden)", () => {
  it("lets a viewer read every admissions table of their own account", () =>
    tx(async (t) => {
      const a = await account(t);
      await fill(t, a);
      const viewer = await member(t, a.accountId, "viewer");
      await actAs(t, viewer);
      for (const table of SIX) expect([table, await visible(t, table)]).toEqual([table, 1]);
    }));

  it("hides another account's rows from a member", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      await fill(t, b);
      const owner = await member(t, a.accountId, "owner");
      await actAs(t, owner);
      for (const table of SIX) expect([table, await visible(t, table)]).toEqual([table, 0]);
    }));

  it("shows anon and a profile-less user zero rows in every public table", () =>
    tx(async (t) => {
      const a = await account(t);
      await fill(t, a);
      const tables = (
        await t`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`
      ).map((r) => r.relname as string);
      const stranger = await signUp(t);
      await t`delete from profiles where user_id = ${stranger}`;
      for (const who of [null, stranger]) {
        await actAs(t, who);
        const leaks = [];
        for (const table of tables) if ((await visible(t, table)) > 0) leaks.push(table);
        expect(leaks).toEqual([]);
        await actAsSuperuser(t);
      }
    }));

  it("stops an agent writing into another account", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { leadId } = await lead(t, b);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const err = await errorOf(
        t,
        (s) => s`insert into visits (account_id, lead_id, cal_booking_id, starts_at) values (${b.accountId}, ${leadId}, 'cal_x', now())`,
      );
      expect(err?.code).toBe("42501");
    }));

  it("lets an agent edit a lead but not a viewer", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const agent = await member(t, a.accountId, "agent");
      const viewer = await member(t, a.accountId, "viewer");
      await actAs(t, viewer);
      expect((await t`update leads set child_name = 'Viewer' where id = ${leadId}`).count).toBe(0);
      await actAsSuperuser(t);
      await actAs(t, agent);
      expect((await t`update leads set child_name = 'Agent' where id = ${leadId}`).count).toBe(1);
    }));

  it("lets an admin delete a lead but not an agent", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const agent = await member(t, a.accountId, "agent");
      const admin = await member(t, a.accountId, "admin");
      await actAs(t, agent);
      expect((await t`delete from leads where id = ${leadId}`).count).toBe(0);
      await actAsSuperuser(t);
      await actAs(t, admin);
      expect((await t`delete from leads where id = ${leadId}`).count).toBe(1);
    }));

  it("lets an agent log a call task and record its outcome", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const [task] = await t`insert into lead_activity (account_id, lead_id, kind) values (${a.accountId}, ${leadId}, 'call_task') returning id`;
      expect((await t`update lead_activity set outcome = 'answered', done_at = now() where id = ${task.id}`).count).toBe(1);
    }));

  it("keeps stage history append-only, even for the owner", () =>
    tx(async (t) => {
      const a = await account(t);
      const { historyId } = await fill(t, a);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const { leadId } = (await t`select lead_id as "leadId" from lead_stage_history where id = ${historyId}`)[0];
      const add = (s: Tx) =>
        s`insert into lead_stage_history (account_id, lead_id, stage_id) values (${a.accountId}, ${leadId}, ${a.stageIds[1]})`;
      expect(await errorOf(t, add)).toBeNull();
      await actAsSuperuser(t);
      await actAs(t, a.ownerId);
      expect((await t`update lead_stage_history set stage_id = ${a.stageIds[2]} where id = ${historyId}`).count).toBe(0);
      expect((await t`delete from lead_stage_history where id = ${historyId}`).count).toBe(0);
    }));

  it("lets members read the settings audit but nobody write it", () =>
    tx(async (t) => {
      const a = await account(t);
      const { settingId } = await fill(t, a);
      await actAs(t, a.ownerId);
      expect(await t`select id from settings_changes`).toHaveLength(1);
      const err = await errorOf(
        t,
        (s) => s`
          insert into settings_changes (account_id, setting_id, kind, key, action)
          values (${a.accountId}, ${settingId}, 'campus', 'baner', 'update')`,
      );
      expect(err?.code).toBe("42501");
      expect((await t`delete from settings_changes`).count).toBe(0);
    }));

  it("stops an admin moving a setting into another account", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const id = await setting(t, a, "source", "walk_in");
      const admin = await member(t, a.accountId, "admin");
      await actAs(t, admin);
      const err = await errorOf(t, (s) => s`update admissions_settings set account_id = ${b.accountId} where id = ${id}`);
      expect(err?.code).toBe("42501");
    }));
});
