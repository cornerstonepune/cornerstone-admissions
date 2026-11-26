// Meetings (ADR 0040, migration 128): staff book a campus visit, video call or phone call for a lead; Cal.com bookings
// carry their kind and link. Every test builds its own accounts inside tx(), which rolls back.
import { afterAll, describe, expect, it } from "vitest";

import { type Tx, account, actAs, actAsSuperuser, errorOf, lead, member, setting, sql, tx } from "./db";

afterAll(() => sql.end());

const AT = "2026-12-10T05:00:00Z";
const stageOf = async (t: Tx, leadId: string) =>
  (await t`select d.stage_id from leads l join deals d on d.id = l.deal_id where l.id = ${leadId}`)[0].stage_id;
const book = (t: Tx, leadId: string, kind: string, o: { at?: string; campus?: string | null; url?: string | null } = {}) =>
  t`select * from book_meeting(${leadId}, ${o.at ?? AT}, ${kind}, ${o.campus ?? null}, ${o.url ?? null})`;

describe("staff book a meeting", () => {
  it("an agent books a video call: one visit with its kind, link and author; the lead moves to Visit booked", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, contactId } = await lead(t, a);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      const [r] = await book(t, leadId, "virtual", { url: "https://meet.google.com/abc-defg-hij" });
      expect(r).toMatchObject({ created: true, account_id: a.accountId, contact_id: contactId, owner_id: a.ownerId });
      await actAsSuperuser(t);
      const [v] = await t`select * from visits where id = ${r.visit_id}`;
      expect(v).toMatchObject({ kind: "virtual", meeting_url: "https://meet.google.com/abc-defg-hij", created_by: agent, status: "booked", cal_booking_id: null });
      expect(await stageOf(t, leadId)).toBe(a.stageIds[1]);
    }));

  it("the same lead at the same time is one meeting (a retried save)", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await actAs(t, await member(t, a.accountId, "agent"));
      const [first] = await book(t, leadId, "phone");
      const [again] = await book(t, leadId, "phone");
      expect(again).toMatchObject({ visit_id: first.visit_id, created: false });
      await actAsSuperuser(t);
      expect((await t`select count(*)::int as n from visits where lead_id = ${leadId}`)[0].n).toBe(1);
    }));

  it("a lead further on keeps its stage; a phone call gets no link even if one is sent", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a, { stageId: a.stageIds[3] });
      await actAs(t, await member(t, a.accountId, "agent"));
      const [r] = await book(t, leadId, "phone", { url: "https://example.com/x" });
      await actAsSuperuser(t);
      expect((await t`select meeting_url from visits where id = ${r.visit_id}`)[0].meeting_url).toBeNull();
      expect(await stageOf(t, leadId)).toBe(a.stageIds[3]);
    }));

  it("the campus given is used; otherwise the lead's", () =>
    tx(async (t) => {
      const a = await account(t);
      const neev = await setting(t, a, "campus", "neev");
      const gurukul = await setting(t, a, "campus", "gurukul");
      const { leadId } = await lead(t, a);
      await t`update leads set campus_id = ${gurukul} where id = ${leadId}`;
      await actAs(t, await member(t, a.accountId, "agent"));
      const [x] = await book(t, leadId, "campus", { campus: neev });
      const [y] = await book(t, leadId, "campus", { at: "2026-12-11T05:00:00Z" });
      await actAsSuperuser(t);
      expect((await t`select campus_id from visits where id = ${x.visit_id}`)[0].campus_id).toBe(neev);
      expect((await t`select campus_id from visits where id = ${y.visit_id}`)[0].campus_id).toBe(gurukul);
    }));

  it("refuses: a viewer, another account's lead, another account's campus, a closed lead, a bad kind or link", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { leadId } = await lead(t, a);
      const other = await lead(t, b);
      const theirCampus = await setting(t, b, "campus", "theirs");
      const closed = await lead(t, a);
      await t`update leads set exit = 'dormant', exited_at = now() where id = ${closed.leadId}`;
      const viewer = await member(t, a.accountId, "viewer");
      const agent = await member(t, a.accountId, "agent");

      await actAs(t, viewer);
      expect((await errorOf(t, (s) => book(s, leadId, "campus")))?.code).toBe("42501");
      await actAs(t, agent);
      expect((await errorOf(t, (s) => book(s, other.leadId, "campus")))?.code).toBe("23514"); // invisible: reads as missing
      expect((await errorOf(t, (s) => book(s, leadId, "campus", { campus: theirCampus })))?.code).toBe("23514");
      expect((await errorOf(t, (s) => book(s, closed.leadId, "campus")))?.code).toBe("23514");
      expect((await errorOf(t, (s) => book(s, leadId, "dinner")))?.code).toBe("23514");
      expect((await errorOf(t, (s) => book(s, leadId, "virtual", { url: "http://insecure.example" })))?.code).toBe("23514");
      await actAs(t, null);
      expect((await errorOf(t, (s) => book(s, leadId, "campus")))?.code).toBe("42501"); // anon may not call it
      await actAsSuperuser(t);
      const admitted = await lead(t, a);
      await t`update leads set admitted_at = now() where id = ${admitted.leadId}`;
      const off = await setting(t, a, "campus", "closed");
      await t`update admissions_settings set active = false where id = ${off}`;
      await actAs(t, agent);
      expect((await errorOf(t, (s) => book(s, admitted.leadId, "campus")))?.code).toBe("23514");
      expect((await errorOf(t, (s) => book(s, leadId, "campus", { campus: off })))?.code).toBe("23514");
      await actAsSuperuser(t);
      expect((await t`select count(*)::int as n from visits where account_id in (${a.accountId}, ${b.accountId})`)[0].n).toBe(0);
    }));

  it("a hand-booked meeting gets the same RSVP reminder as a Cal.com booking", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await actAs(t, await member(t, a.accountId, "agent"));
      const [r] = await book(t, leadId, "virtual", { at: "2030-01-10T05:00:00Z", url: "https://zoom.us/j/1" });
      await actAsSuperuser(t);
      await t`update visits set created_at = '2030-01-01T00:00:00Z' where id = ${r.visit_id}`;
      const due = await t`select * from claim_visit_reminders('2030-01-09T06:00:00Z')`;
      expect(due.map((d) => d.template)).toContain("visit_rsvp_24h");
    }));
});

describe("who booked it, and one meeting per moment", () => {
  it("created_by is whoever is signed in, whatever the client sends; Cal.com's rows have none", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const agent = await member(t, a.accountId, "agent");
      await actAs(t, agent);
      await t`insert into visits (account_id, lead_id, starts_at, created_by) values (${a.accountId}, ${leadId}, ${AT}, ${a.ownerId})`;
      await actAsSuperuser(t);
      await t`select * from calcom_book('bk_c1', '2026-12-12T05:00:00Z', ${leadId}, null, null)`;
      const rows = await t`select cal_booking_id, created_by from visits where lead_id = ${leadId} order by starts_at`;
      expect(rows).toEqual([
        { cal_booking_id: null, created_by: agent },
        { cal_booking_id: "bk_c1", created_by: null },
      ]);
    }));

  it("staff setting the moment Cal.com already booked get that meeting back, not a second one", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const [cal] = await t`select * from calcom_book('bk_same', ${AT}, ${leadId}, null, null)`;
      expect(cal).toBeTruthy();
      await actAs(t, await member(t, a.accountId, "agent"));
      const [r] = await book(t, leadId, "campus");
      expect(r.created).toBe(false);
      await actAsSuperuser(t);
      expect((await t`select count(*)::int as n from visits where lead_id = ${leadId}`)[0].n).toBe(1);
    }));

  it("the database itself refuses a second staff meeting at the same moment (two saves racing past the check)", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await t`insert into visits (account_id, lead_id, starts_at) values (${a.accountId}, ${leadId}, ${AT})`;
      const err = await errorOf(t, (s) => s`insert into visits (account_id, lead_id, starts_at) values (${a.accountId}, ${leadId}, ${AT})`);
      expect(err?.code).toBe("23505");
    }));
});

describe("Cal.com bookings carry their kind and link", () => {
  it("a video booking is stored as virtual with its link; the old call shape is still a campus visit", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await t`select * from calcom_book('bk_v1', ${AT}, ${leadId}, null, null, null, 'virtual', 'https://app.cal.com/video/x')`;
      await t`select * from calcom_book('bk_v2', '2026-12-11T05:00:00Z', ${leadId}, null, null)`;
      const rows = await t`select cal_booking_id, kind, meeting_url from visits where lead_id = ${leadId} order by cal_booking_id`;
      expect(rows).toEqual([
        { cal_booking_id: "bk_v1", kind: "virtual", meeting_url: "https://app.cal.com/video/x" },
        { cal_booking_id: "bk_v2", kind: "campus", meeting_url: null },
      ]);
    }));

  it("staff can't call calcom_book", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      await actAs(t, await member(t, a.accountId, "admin"));
      expect((await errorOf(t, (s) => s`select * from calcom_book('bk_s', ${AT}, ${leadId}, null)`))?.code).toBe("42501");
    }));
});
