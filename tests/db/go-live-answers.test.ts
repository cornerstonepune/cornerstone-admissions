// Go-live answers (ADR 0033, migration 122): the Cal.com location picks the visit's campus, and a repeat family
// notifies everyone in the account. Every test builds its own accounts inside tx(), which rolls back.
import { afterAll, describe, expect, it } from "vitest";

import { type Account, type Tx, account, actAs, actAsSuperuser, errorOf, lead, member, setting, sql, tx } from "./db";

afterAll(() => sql.end());

const VISIT_AT = "2026-12-10T05:00:00Z";

describe("the Cal.com location picks the visit's campus", () => {
  const campuses = async (t: Tx, a: Account) => ({
    gurukul: await setting(t, a, "campus", "gurukul"),
    neev: await setting(t, a, "campus", "neev"),
  });
  const book = (t: Tx, booking: string, leadId: string, location?: string | null) =>
    location === undefined
      ? t`select * from calcom_book(${booking}, ${VISIT_AT}, ${leadId}, null, null)`
      : t`select * from calcom_book(${booking}, ${VISIT_AT}, ${leadId}, null, null, ${location})`;
  const visitCampus = async (t: Tx, booking: string) =>
    (await t`select campus_id from visits where cal_booking_id = ${booking}`)[0].campus_id;
  const leadCampus = async (t: Tx, leadId: string) => (await t`select campus_id from leads where id = ${leadId}`)[0].campus_id;

  it("the campus named in the location, in any case, goes on the visit and on a lead that has none", () =>
    tx(async (t) => {
      const a = await account(t);
      const c = await campuses(t, a);
      const { leadId } = await lead(t, a);
      expect(await book(t, "bk_loc1", leadId, "Cornerstone NEEV campus, Pune")).toHaveLength(1);
      expect(await visitCampus(t, "bk_loc1")).toBe(c.neev);
      expect(await leadCampus(t, leadId)).toBe(c.neev);
    }));

  it("a lead's own campus is kept; the visit still goes where the parent booked", () =>
    tx(async (t) => {
      const a = await account(t);
      const c = await campuses(t, a);
      const { leadId } = await lead(t, a);
      await t`update leads set campus_id = ${c.gurukul} where id = ${leadId}`;
      await book(t, "bk_loc2", leadId, "Neev campus");
      expect(await visitCampus(t, "bk_loc2")).toBe(c.neev);
      expect(await leadCampus(t, leadId)).toBe(c.gurukul);
    }));

  it("no location, no match, two matches or a switched-off campus: the lead's campus, as before", () =>
    tx(async (t) => {
      const a = await account(t);
      const c = await campuses(t, a);
      const { leadId } = await lead(t, a);
      await t`update leads set campus_id = ${c.gurukul} where id = ${leadId}`;
      await book(t, "bk_loc3", leadId); // the 5-argument call of 120 still works
      await book(t, "bk_loc4", leadId, "Main office");
      await book(t, "bk_loc5", leadId, "Gurukul or Neev");
      await book(t, "bk_loc6", leadId, null);
      await t`update admissions_settings set active = false where id = ${c.neev}`;
      await book(t, "bk_loc7", leadId, "Neev campus");
      for (const b of ["bk_loc3", "bk_loc4", "bk_loc5", "bk_loc6", "bk_loc7"]) expect(await visitCampus(t, b)).toBe(c.gurukul);
    }));

  it("never another account's campus", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      await campuses(t, b);
      const { leadId } = await lead(t, a);
      await book(t, "bk_loc8", leadId, "Neev campus");
      expect(await visitCampus(t, "bk_loc8")).toBeNull();
      expect(await leadCampus(t, leadId)).toBeNull();
    }));

  it("a cancel that arrives before its booking stores the booked campus and leaves the lead alone", () =>
    tx(async (t) => {
      const a = await account(t);
      const c = await campuses(t, a);
      const { leadId } = await lead(t, a);
      const [{ l }] = await t`select calcom_cancel('bk_loc9', ${VISIT_AT}, ${leadId}, null, 'Gurukul campus') as l`;
      expect(l).toBe(leadId);
      expect(await visitCampus(t, "bk_loc9")).toBe(c.gurukul);
      expect(await leadCampus(t, leadId)).toBeNull();
    }));

  it("no signed-in user can call the new signatures or the campus lookup", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await actAs(t, await member(t, a.accountId, "owner"));
      for (const call of [
        (s: Tx) => s`select * from calcom_book('bk_x', now(), ${leadId}, null, null, 'Neev')`,
        (s: Tx) => s`select calcom_cancel('bk_x', now(), null, null, 'Neev')`,
        (s: Tx) => s`select calcom_campus(${a.accountId}, 'Neev')`,
      ]) {
        expect((await errorOf(t, call))?.code).toBe("42501");
      }
    }));
});

describe("a repeat family notifies the office", () => {
  type Out = { contact_id: string; lead_id: string | null; created: boolean };
  const intake = async (t: Tx, accountId: string, lead: Record<string, unknown>): Promise<Out> => {
    const [{ r }] = await t`select public.intake_lead(${accountId}, ${t.json(lead as never)}) as r`;
    return r as Out;
  };
  const notes = (t: Tx, accountId: string) =>
    t`select user_id, type, contact_id, title, body from notifications where account_id = ${accountId} order by user_id`;

  it("a first enquiry notifies no one; the family enquiring again notifies every member once", () =>
    tx(async (t) => {
      const a = await account(t);
      const other = await account(t);
      await setting(t, a, "source", "website");
      const agent = await member(t, a.accountId, "agent");
      const viewer = await member(t, a.accountId, "viewer");
      const first = await intake(t, a.accountId, { phone: "919800000401", parent: "Sunita Patil", child: "Aarav" });
      expect(first.created).toBe(true);
      expect(await notes(t, a.accountId)).toEqual([]);

      const again = {
        phone: "919800000401", parent: "S. Patil", child: "Meera", child_dob: "2023-01-05", source_keys: ["website"],
        note: "Enquired again on the website.", fill: false,
      };
      for (let i = 0; i < 2; i++) expect((await intake(t, a.accountId, again)).created).toBe(false); // same submission twice

      const body = "Enquired again on the website. Submitted: child Meera, born 05/01/2023, source website.";
      const expected = [a.ownerId, agent, viewer].sort().map((user_id) => ({
        user_id, type: "repeat_family", contact_id: first.contact_id, title: "Repeat enquiry: Sunita Patil", body,
      }));
      expect(await notes(t, a.accountId)).toEqual(expected);
      expect(await notes(t, other.accountId)).toEqual([]);
    }));

  it("the same child again on WhatsApp is not a new enquiry: no note, no notification", () =>
    tx(async (t) => {
      const a = await account(t);
      const first = await intake(t, a.accountId, { phone: "919800000402", child: "Aarav" });
      await intake(t, a.accountId, { contact_id: first.contact_id, child: "Aarav" });
      expect(await notes(t, a.accountId)).toEqual([]);
    }));

  it("staff quick-add of a known family, through RLS, notifies the others and not the one who saved it", () =>
    tx(async (t) => {
      const a = await account(t);
      const staff = await member(t, a.accountId, "agent");
      const first = await intake(t, a.accountId, { phone: "919800000403", child: "Aarav" });
      await actAs(t, staff);
      await intake(t, a.accountId, { phone: "919800000403", child: "Meera", note: "Walked in for a sibling." });
      await actAsSuperuser(t);
      const got = await notes(t, a.accountId);
      expect(got.map((n) => n.user_id)).toEqual([a.ownerId]);
      expect(got[0]).toMatchObject({ contact_id: first.contact_id, title: "Repeat enquiry: +919800000403" });
    }));

  it("a signed-in user outside the account can't notify its members", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { contactId } = await lead(t, a);
      await actAs(t, await member(t, b.accountId, "owner"));
      expect((await errorOf(t, (s) => s`select notify_repeat_family(${a.accountId}, ${contactId}, 'x')`))?.code).toBe("42501");
      await actAsSuperuser(t);
      expect(await notes(t, a.accountId)).toEqual([]);
    }));
});
