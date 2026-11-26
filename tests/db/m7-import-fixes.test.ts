// #71 review (migration 117): import_leads is admin-only in the database too, finds a parent saved with or without 91,
// marks imported leads and dates them by the sheet's enquiry date. Every test rolls back; counts are per test account.
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, actAsSuperuser, contact, lead, member, sql, tx, type Account, type Tx } from "./db";

afterAll(() => sql.end());

const run = async (t: Tx, a: Account, rows: Record<string, unknown>[]) =>
  (await t`select public.import_leads(${a.accountId}, ${t.json(rows as never)}) as out`)[0].out as { status: string; error?: string }[];
const row = (a: Account, phone: string, extra: Record<string, unknown> = {}) => ({ phone, parent: "P", child: "C", stage_id: a.stageIds[0], ...extra });

describe("import_leads checks the role itself", () => {
  it("refuses an agent calling it directly: every row failed, nothing written", () =>
    tx(async (t) => {
      const a = await account(t);
      await actAs(t, await member(t, a.accountId, "agent"));
      const out = await run(t, a, [row(a, "919800000011"), row(a, "919800000012")]);
      expect(out).toEqual([
        { status: "failed", error: "Only an owner or admin can import leads" },
        { status: "failed", error: "Only an owner or admin can import leads" },
      ]);
      await actAsSuperuser(t);
      expect(await t`select 1 from contacts where account_id = ${a.accountId}`).toHaveLength(0);
      expect(await t`select 1 from deals where account_id = ${a.accountId}`).toHaveLength(0);
    }));
});

describe("import_leads finds a parent saved with or without 91", () => {
  it("reuses a contact saved as 10 digits, and sees an open lead behind a 91 number", () =>
    tx(async (t) => {
      const a = await account(t);
      const bare = await contact(t, a, "98000 00021"); // no country code, no lead
      await lead(t, a, { contactId: await contact(t, a, "9800000022") }); // no country code, open lead
      await actAs(t, await member(t, a.accountId, "admin"));
      const out = await run(t, a, [row(a, "919800000021"), row(a, "919800000022")]);
      expect(out.map((o) => o.status)).toEqual(["imported", "duplicate"]);
      await actAsSuperuser(t);
      const contacts = await t`select id from contacts where account_id = ${a.accountId} and phone_normalized like '%9800000021'`;
      expect(contacts.map((c) => c.id)).toEqual([bare]);
      expect(await t`select 1 from leads where contact_id = ${bare}`).toHaveLength(1);
    }));
});

describe("imported leads carry the marker and their enquiry date", () => {
  it("sets imported_at; created_at is the enquiry date, never later than now; other leads stay unmarked", () =>
    tx(async (t) => {
      const a = await account(t);
      const plain = await lead(t, a);
      await actAs(t, await member(t, a.accountId, "admin"));
      await run(t, a, [
        row(a, "919800000031", { enquired_at: "2026-06-01T00:00:00+05:30" }),
        row(a, "919800000032"),
        row(a, "919800000033", { enquired_at: "2999-01-01T00:00:00+05:30" }),
      ]);
      await actAsSuperuser(t);
      const leads = await t`
        select c.phone_normalized as phone, l.imported_at is not null as marked, l.created_at,
               l.created_at > now() - interval '1 minute' as made_now
        from leads l join contacts c on c.id = l.contact_id where l.account_id = ${a.accountId} order by c.phone_normalized`;
      const by = Object.fromEntries(leads.map((l) => [l.phone, l]));
      expect(by["919800000031"].marked).toBe(true);
      expect((by["919800000031"].created_at as Date).toISOString()).toBe("2026-05-31T18:30:00.000Z");
      expect(by["919800000032"]).toMatchObject({ marked: true, made_now: true });
      expect(by["919800000033"]).toMatchObject({ marked: true, made_now: true });
      const [p] = await t`select imported_at from leads where id = ${plain.leadId}`;
      expect(p.imported_at).toBeNull();
    }));

  it("reports a date the database can't read on its row and imports the rest", () =>
    tx(async (t) => {
      const a = await account(t);
      await actAs(t, await member(t, a.accountId, "admin"));
      const out = await run(t, a, [row(a, "919800000041", { enquired_at: "not a date" }), row(a, "919800000042")]);
      expect(out.map((o) => o.status)).toEqual(["failed", "imported"]);
    }));
});
