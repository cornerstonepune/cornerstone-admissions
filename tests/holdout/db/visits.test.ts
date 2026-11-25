// Hidden: current visit edge cases (ticket 106).
import { afterAll, describe, expect, it } from "vitest";
import { type Account, type Tx, account, actAs, lead, member, sql, tx } from "../../db/db";

afterAll(() => sql.end());

type Status = "booked" | "rescheduled" | "cancelled" | "no_show" | "visited";

async function visit(t: Tx, a: Account, leadId: string, status: Status, minutesAgo: number, id?: string): Promise<string> {
  const [v] = await t`
    insert into visits (id, account_id, lead_id, cal_booking_id, starts_at, status, created_at)
    values (${id ?? sql`gen_random_uuid()`}, ${a.accountId}, ${leadId}, ${`cal_${Math.random()}`}, now(), ${status},
            date_trunc('minute', now()) - make_interval(mins => ${minutesAgo}))
    returning id`;
  return v.id as string;
}

const current = async (t: Tx, leadId: string) =>
  (await t`select visit_id from lead_current_visit where lead_id = ${leadId}`).map((r) => r.visit_id);

describe("current visit edge cases (hidden)", () => {
  it("counts a visit that happened", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const v = await visit(t, a, leadId, "visited", 5);
      expect(await current(t, leadId)).toEqual([v]);
    }));

  it("skips a later cancelled visit and keeps the earlier live one", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const v = await visit(t, a, leadId, "booked", 60);
      await visit(t, a, leadId, "cancelled", 5);
      expect(await current(t, leadId)).toEqual([v]);
    }));

  it("breaks a tie on creation time by the higher id", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await visit(t, a, leadId, "booked", 5, "00000000-0000-4000-8000-000000000001");
      const high = await visit(t, a, leadId, "booked", 5, "ffffffff-0000-4000-8000-000000000001");
      expect(await current(t, leadId)).toEqual([high]);
    }));

  it("gives one row per lead, and each lead its own visit", () =>
    tx(async (t) => {
      const a = await account(t);
      const one = await lead(t, a);
      const two = await lead(t, a);
      await visit(t, a, one.leadId, "rescheduled", 90);
      await visit(t, a, one.leadId, "rescheduled", 60);
      const v1 = await visit(t, a, one.leadId, "booked", 30);
      const v2 = await visit(t, a, two.leadId, "no_show", 10);
      expect(await current(t, one.leadId)).toEqual([v1]);
      expect(await current(t, two.leadId)).toEqual([v2]);
    }));

  it("has exactly the agreed columns, in order", () =>
    tx(async (t) => {
      const cols = await t`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'lead_current_visit' order by ordinal_position`;
      expect(cols.map((c) => c.column_name)).toEqual([
        "lead_id", "visit_id", "account_id", "cal_booking_id", "starts_at", "campus_id", "status", "created_at",
      ]);
    }));

  it("runs as the reader, so RLS on visits applies", () =>
    tx(async (t) => {
      const [v] = await t`select reloptions from pg_class where relname = 'lead_current_visit'`;
      expect(v.reloptions).toContain("security_invoker=true");
    }));

  it("shows another account's visits to nobody", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { leadId } = await lead(t, a);
      await visit(t, a, leadId, "booked", 5);
      const outsider = await member(t, b.accountId, "owner");
      await actAs(t, outsider);
      expect(await t`select 1 from lead_current_visit`).toHaveLength(0);
    }));
});
