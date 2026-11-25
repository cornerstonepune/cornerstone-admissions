// The current visit (migration 106, ADR 0011 §3): latest visit that wasn't cancelled or rescheduled.
import { afterAll, describe, expect, it } from "vitest";
import { type Account, type Tx, account, actAs, lead, member, sql, tx } from "./db";

afterAll(() => sql.end());

type Status = "booked" | "rescheduled" | "cancelled" | "no_show" | "visited";

/** A visit for the lead, `minutesAgo` minutes old; returns its id. */
async function visit(t: Tx, a: Account, leadId: string, status: Status, minutesAgo: number): Promise<string> {
  const [v] = await t`
    insert into visits (account_id, lead_id, cal_booking_id, starts_at, status, created_at)
    values (${a.accountId}, ${leadId}, ${`cal_${Math.random()}`}, now() + interval '2 days', ${status},
            now() - make_interval(mins => ${minutesAgo}))
    returning id`;
  return v.id as string;
}

const current = async (t: Tx, leadId: string) =>
  (await t`select visit_id from lead_current_visit where lead_id = ${leadId}`).map((r) => r.visit_id);

describe("current visit", () => {
  it("is the booked visit", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const v = await visit(t, a, leadId, "booked", 5);
      expect(await current(t, leadId)).toEqual([v]);
    }));

  it("moves to the new booking after a reschedule", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await visit(t, a, leadId, "rescheduled", 60);
      const v = await visit(t, a, leadId, "booked", 5);
      expect(await current(t, leadId)).toEqual([v]);
    }));

  it("is none when the only visit was cancelled", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await visit(t, a, leadId, "cancelled", 5);
      expect(await current(t, leadId)).toEqual([]);
    }));

  it("counts a no-show, so the Today list can chase it", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await visit(t, a, leadId, "booked", 60);
      const v = await visit(t, a, leadId, "no_show", 5);
      expect(await current(t, leadId)).toEqual([v]);
    }));

  it("shows an account member their lead's current visit, and another account's member nothing", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { leadId } = await lead(t, a);
      const v = await visit(t, a, leadId, "booked", 5);
      const viewer = await member(t, a.accountId, "viewer");
      const outsider = await member(t, b.accountId, "admin");
      await actAs(t, viewer);
      expect(await current(t, leadId)).toEqual([v]);
      await actAs(t, outsider);
      expect(await current(t, leadId)).toEqual([]);
    }));
});
