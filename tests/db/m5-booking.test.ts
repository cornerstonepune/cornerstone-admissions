// M5 booking (#68, migration 120, ADR 0030): what each Cal.com event does to visits and the lead, and the reminders.
// Runs as the superuser, as the webhook's service role does; the last block checks no signed-in user can call these.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { type Account, type Tx, DATABASE_URL, account, actAs, contact, errorOf, lead, member, sql, tx } from "./db";

afterAll(() => sql.end());

const VISIT_AT = "2026-12-10T05:00:00Z"; // 10:30 in India

/** A lead whose first stage entry is a day old, so its history has a clear order inside one test transaction. */
async function oldLead(t: Tx, a: Account, opts: { phone?: string; stageId?: string; contactId?: string } = {}) {
  const contactId = opts.contactId ?? (opts.phone ? await contact(t, a, opts.phone) : undefined);
  const l = await lead(t, a, { contactId, stageId: opts.stageId });
  await t`update lead_stage_history set entered_at = now() - interval '1 day' where lead_id = ${l.leadId}`;
  return l;
}

const book = (t: Tx, booking: string, o: { lead?: string | null; phone?: string | null; from?: string | null; at?: string } = {}) =>
  t`select * from calcom_book(${booking}, ${o.at ?? VISIT_AT}, ${o.lead ?? null}, ${o.phone ?? null}, ${o.from ?? null})`;

const cancel = async (t: Tx, booking: string, o: { lead?: string | null; phone?: string | null; at?: string | null } = {}) =>
  (await t`select calcom_cancel(${booking}, ${o.at ?? null}, ${o.lead ?? null}, ${o.phone ?? null}) as l`)[0].l as string | null;

const stageOf = async (t: Tx, leadId: string) =>
  (await t`select d.stage_id from leads l join deals d on d.id = l.deal_id where l.id = ${leadId}`)[0].stage_id;
const historyCount = async (t: Tx, leadId: string) =>
  Number((await t`select count(*) from lead_stage_history where lead_id = ${leadId}`)[0].count);
const visitsOf = (t: Tx, leadId: string) =>
  t`select cal_booking_id, status from visits where lead_id = ${leadId} order by created_at, cal_booking_id`;
const callTasks = async (t: Tx, leadId: string) =>
  Number((await t`select count(*) from lead_activity where lead_id = ${leadId} and kind = 'call_task'`)[0].count);

describe("G5.1 a booking moves the lead to Visit booked once, even when the webhook repeats", () => {
  it("records one visit and one stage move for the same booking twice", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, contactId } = await oldLead(t, a);
      const first = await book(t, "bk_1", { lead: leadId });
      expect(first).toEqual([{ lead_id: leadId, account_id: a.accountId, contact_id: contactId, owner_id: a.ownerId }]);
      expect(await book(t, "bk_1", { lead: leadId })).toEqual([]);
      expect(await visitsOf(t, leadId)).toEqual([{ cal_booking_id: "bk_1", status: "booked" }]);
      expect(await stageOf(t, leadId)).toBe(a.stageIds[1]);
      expect(await historyCount(t, leadId)).toBe(2);
    }));

  it("still finds Visit booked after the stage is renamed in Pipeline (it is the second stage)", () =>
    tx(async (t) => {
      const a = await account(t);
      await t`update pipeline_stages set name = 'Campus visit' where id = ${a.stageIds[1]}`;
      const { leadId } = await oldLead(t, a);
      await book(t, "bk_rn", { lead: leadId });
      expect(await stageOf(t, leadId)).toBe(a.stageIds[1]);
    }));

  it("matches the parent's phone however it is written, when the booking has no lead id", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await oldLead(t, a, { phone: "+919812345678" });
      expect(await book(t, "bk_2", { phone: "+91 98123 45678" })).toHaveLength(1);
      expect(await stageOf(t, leadId)).toBe(a.stageIds[1]);
    }));

  it("records a second visit for a lead already past Visit booked without moving it back", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await oldLead(t, a, { stageId: a.stageIds[2] });
      expect(await book(t, "bk_3", { lead: leadId })).toHaveLength(1);
      expect(await stageOf(t, leadId)).toBe(a.stageIds[2]);
      expect(await historyCount(t, leadId)).toBe(1);
    }));

  it("writes nothing for an unknown phone, a closed lead, or no lead and no phone", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await oldLead(t, a, { phone: "+919800000001" });
      await t`update leads set exit = 'dormant', exited_at = now() where id = ${leadId}`;
      expect(await book(t, "bk_4", { phone: "+919800000009" })).toEqual([]);
      expect(await book(t, "bk_5", { lead: leadId, phone: "+919800000001" })).toEqual([]);
      expect(await book(t, "bk_6")).toEqual([]);
      expect(Number((await t`select count(*) from visits where cal_booking_id in ('bk_4','bk_5','bk_6')`)[0].count)).toBe(0);
    }));
});

describe("which lead (ADR 0030 §3)", () => {
  it("a closed lead from the link falls through to the parent's open lead by phone", () =>
    tx(async (t) => {
      const a = await account(t);
      const closed = await oldLead(t, a, { phone: "+919833333333" });
      await t`update leads set exit = 'dormant', exited_at = now() where id = ${closed.leadId}`;
      const open = await oldLead(t, a, { contactId: closed.contactId });
      expect(await book(t, "bk_f", { lead: closed.leadId, phone: "+91 98333 33333" })).toMatchObject([{ lead_id: open.leadId }]);
      expect(await stageOf(t, open.leadId)).toBe(a.stageIds[1]);
    }));

  it("siblings: two open leads with the same number in one account -> the most recent one", () =>
    tx(async (t) => {
      const a = await account(t);
      // the sheet import keeps 10 digits; WhatsApp keeps 91 + 10: one family, two contacts, two open leads
      const older = await oldLead(t, a, { phone: "9844444444" });
      const newer = await oldLead(t, a, { phone: "+919844444444" });
      await t`update leads set created_at = now() - interval '2 days' where id = ${older.leadId}`;
      expect(await book(t, "bk_sib", { phone: "+919844444444" })).toMatchObject([{ lead_id: newer.leadId }]);
      expect(await stageOf(t, older.leadId)).toBe(a.stageIds[0]);
    }));

  it("matches a +91 booking to a parent the sheet import stored as 10 digits", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await oldLead(t, a, { phone: "9855555555" });
      expect(await book(t, "bk_10", { lead: leadId, phone: "+91 98555 55555" })).toHaveLength(1);
    }));
});

describe("reschedule", () => {
  it("adds the new booking, marks the old one rescheduled, and doesn't move the lead again", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await oldLead(t, a);
      await book(t, "bk_old", { lead: leadId });
      await t`update visits set created_at = now() - interval '1 hour' where cal_booking_id = 'bk_old'`;
      // Cal.com's reschedule may carry no lead id: the old booking names the lead
      expect(await book(t, "bk_new", { from: "bk_old", at: "2026-12-11T06:00:00Z" })).toHaveLength(1);
      expect(await visitsOf(t, leadId)).toEqual([
        { cal_booking_id: "bk_old", status: "rescheduled" },
        { cal_booking_id: "bk_new", status: "booked" },
      ]);
      const [cur] = await t`select cal_booking_id, starts_at from lead_current_visit where lead_id = ${leadId}`;
      expect(cur.cal_booking_id).toBe("bk_new");
      expect(new Date(cur.starts_at).toISOString()).toBe("2026-12-11T06:00:00.000Z");
      expect(await historyCount(t, leadId)).toBe(2);
    }));
});

describe("G5.2 a cancel moves the lead back to its previous stage", () => {
  it("cancels the visit and moves the lead back to Enquiry; a repeat changes nothing", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await oldLead(t, a);
      await book(t, "bk_c", { lead: leadId });
      expect((await cancel(t, "bk_c"))).toBe(leadId);
      expect(await visitsOf(t, leadId)).toEqual([{ cal_booking_id: "bk_c", status: "cancelled" }]);
      expect(await stageOf(t, leadId)).toBe(a.stageIds[0]);
      expect(await historyCount(t, leadId)).toBe(3);
      expect((await cancel(t, "bk_c"))).toBeNull();
      expect(await historyCount(t, leadId)).toBe(3);
    }));

  it("keeps the lead in Visit booked while another booking is still on", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await oldLead(t, a);
      await book(t, "bk_a", { lead: leadId });
      await book(t, "bk_b", { lead: leadId, at: "2026-12-12T05:00:00Z" });
      await cancel(t, "bk_a");
      expect(await stageOf(t, leadId)).toBe(a.stageIds[1]);
    }));

  it("leaves a lead staff already moved on", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await oldLead(t, a);
      await book(t, "bk_d", { lead: leadId });
      await t`select move_lead(${leadId}, ${a.stageIds[3]})`;
      await cancel(t, "bk_d");
      expect(await stageOf(t, leadId)).toBe(a.stageIds[3]);
    }));

  it("goes back to the latest stage before Visit booked, not to a later stage it passed through", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await oldLead(t, a);
      await book(t, "bk_e1", { lead: leadId });
      await t`update lead_stage_history set entered_at = now() - interval '3 hours' where lead_id = ${leadId} and stage_id = ${a.stageIds[1]}`;
      await t`select move_lead(${leadId}, ${a.stageIds[3]})`; // staff: Deciding
      await t`update lead_stage_history set entered_at = now() - interval '2 hours' where lead_id = ${leadId} and stage_id = ${a.stageIds[3]}`;
      await t`select move_lead(${leadId}, ${a.stageIds[1]})`; // staff: back to Visit booked
      await cancel(t, "bk_e1");
      expect(await stageOf(t, leadId)).toBe(a.stageIds[0]);
      expect((await t`select admitted_at from leads where id = ${leadId}`)[0].admitted_at).toBeNull();
    }));

  it("stores a cancel that arrives before its booking, so the late booking changes nothing", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await oldLead(t, a);
      expect(await cancel(t, "bk_early", { lead: leadId, at: VISIT_AT })).toBe(leadId);
      expect(await book(t, "bk_early", { lead: leadId })).toEqual([]);
      expect(await visitsOf(t, leadId)).toEqual([{ cal_booking_id: "bk_early", status: "cancelled" }]);
      expect(await stageOf(t, leadId)).toBe(a.stageIds[0]);
      expect(await historyCount(t, leadId)).toBe(1);
    }));

  it("ignores an unknown booking", () =>
    tx(async (t) => {
      expect((await cancel(t, "bk_never"))).toBeNull();
    }));
});

describe("no-show", () => {
  it("marks the visit no-show and makes one call task, once", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, contactId } = await oldLead(t, a);
      await book(t, "bk_n", { lead: leadId });
      expect(await t`select * from calcom_no_show('bk_n')`).toEqual([
        { lead_id: leadId, account_id: a.accountId, contact_id: contactId, owner_id: a.ownerId },
      ]);
      expect(await t`select * from calcom_no_show('bk_n')`).toEqual([]);
      expect(await visitsOf(t, leadId)).toEqual([{ cal_booking_id: "bk_n", status: "no_show" }]);
      expect(await callTasks(t, leadId)).toBe(1);
    }));
});

describe("no-show of a closed lead", () => {
  it("changes nothing and makes no call task", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await oldLead(t, a);
      await book(t, "bk_nc", { lead: leadId });
      await t`update leads set exit = 'dormant', exited_at = now() where id = ${leadId}`;
      expect(await t`select * from calcom_no_show('bk_nc')`).toEqual([]);
      expect(await visitsOf(t, leadId)).toEqual([{ cal_booking_id: "bk_nc", status: "booked" }]);
      expect(await callTasks(t, leadId)).toBe(0);
    }));
});

describe("reminders (claim_visit_reminders)", () => {
  /** A booked visit at VISIT_AT (10:30 India on 10 Dec), booked three days before. */
  async function booked(t: Tx, a: Account) {
    const l = await oldLead(t, a);
    await book(t, `bk_r_${l.leadId}`, { lead: l.leadId });
    await t`update visits set created_at = '2026-12-07T05:00:00Z' where lead_id = ${l.leadId}`;
    return l;
  }
  const claim = (t: Tx, at: string) => t`select visit_id, template from claim_visit_reminders(${at})`;

  it("sends the RSVP at T-24h and the morning reminder at 08:00 on the day, each once", () =>
    tx(async (t) => {
      const a = await account(t);
      await booked(t, a);
      expect(await claim(t, "2026-12-09T04:00:00Z")).toEqual([]); // T-25h
      const rsvp = await claim(t, "2026-12-09T05:00:00Z");
      expect(rsvp.map((r) => r.template)).toEqual(["visit_rsvp_24h"]);
      expect(await claim(t, "2026-12-09T05:01:00Z")).toEqual([]);
      expect(await claim(t, "2026-12-10T02:29:00Z")).toEqual([]); // 07:59 India
      expect((await claim(t, "2026-12-10T02:30:00Z")).map((r) => r.template)).toEqual(["visit_reminder_morning"]);
      expect(await claim(t, "2026-12-10T02:31:00Z")).toEqual([]);
    }));

  it("G5.3 a parent who hasn't replied to the RSVP by the evening before gets a call task, once", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await booked(t, a);
      await claim(t, "2026-12-09T05:00:00Z");
      await claim(t, "2026-12-09T12:29:00Z"); // 17:59 India
      expect(await callTasks(t, leadId)).toBe(0);
      await claim(t, "2026-12-09T12:30:00Z"); // 18:00 India
      expect(await callTasks(t, leadId)).toBe(1);
      await claim(t, "2026-12-09T13:00:00Z");
      expect(await callTasks(t, leadId)).toBe(1);
    }));

  it("a parent who replied after the RSVP gets no call task", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, contactId } = await booked(t, a);
      await claim(t, "2026-12-09T05:00:00Z");
      await t`insert into conversations (user_id, account_id, contact_id, last_inbound_at)
              values (${a.ownerId}, ${a.accountId}, ${contactId}, '2026-12-09T06:00:00Z')`;
      await claim(t, "2026-12-09T13:00:00Z");
      expect(await callTasks(t, leadId)).toBe(0);
    }));

  it("skips a cancelled or rescheduled visit, and a moment already past when the visit was booked", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await booked(t, a);
      await t`update visits set status = 'cancelled' where lead_id = ${leadId}`;
      expect(await claim(t, "2026-12-09T05:00:00Z")).toEqual([]);

      const late = await oldLead(t, a);
      await book(t, "bk_late", { lead: late.leadId });
      await t`update visits set created_at = '2026-12-09T15:00:00Z' where cal_booking_id = 'bk_late'`; // booked the night before
      const got = await claim(t, "2026-12-10T02:30:00Z");
      expect(got.map((r) => r.template)).toEqual(["visit_reminder_morning"]); // no RSVP, so no call task either
      await claim(t, "2026-12-10T04:00:00Z");
      expect(await callTasks(t, late.leadId)).toBe(0);
    }));
});

describe("reminder claims: a cap per run, and overlapping runs", () => {
  it("claims at most 50 RSVPs a run, soonest visit first; the next run takes the rest", () =>
    tx(async (t) => {
      const a = await account(t);
      const mine: string[] = [];
      for (let i = 0; i < 53; i++) {
        const l = await oldLead(t, a);
        // 53 visits on 10 Dec, a minute apart, all due for their RSVP by 9 Dec 06:00 UTC
        const [v] = await t`
          insert into visits (account_id, lead_id, cal_booking_id, starts_at, created_at)
          values (${a.accountId}, ${l.leadId}, ${`bk_cap_${i}`}, ${VISIT_AT}::timestamptz + make_interval(mins => ${i}),
                  '2026-12-01T00:00:00Z')
          returning id`;
        mine.push(v.id as string);
      }
      const run = async () =>
        (await t`select visit_id from claim_visit_reminders('2026-12-09T06:00:00Z') where template = 'visit_rsvp_24h'`)
          .map((r) => r.visit_id as string)
          .filter((id) => mine.includes(id));
      const first = await run();
      expect(first).toHaveLength(50);
      expect(first).toEqual(mine.slice(0, 50));
      expect((await run()).sort()).toEqual(mine.slice(50).sort());
      expect(await run()).toEqual([]);
    }));

  it("two runs at once never claim the same visit: the second skips what the first holds", async () => {
    // Real concurrency needs committed rows and two connections; this account is deleted afterwards.
    let a: Account | undefined;
    const ids: string[] = [];
    await sql.begin(async (t) => {
      a = await account(t);
      for (let i = 0; i < 3; i++) {
        const l = await oldLead(t, a);
        const [v] = await t`
          insert into visits (account_id, lead_id, cal_booking_id, starts_at, created_at)
          values (${a.accountId}, ${l.leadId}, ${`bk_ovl_${l.leadId}`}, ${VISIT_AT}, '2026-12-01T00:00:00Z') returning id`;
        ids.push(v.id as string);
      }
    });
    const pool = postgres(DATABASE_URL, { max: 2, onnotice: () => {} });
    const one = await pool.reserve();
    const two = await pool.reserve();
    try {
      const claim = async (c: typeof one) =>
        (await c`select visit_id from claim_visit_reminders('2026-12-09T06:00:00Z')`)
          .map((r) => r.visit_id as string)
          .filter((id) => ids.includes(id));
      await one`begin`;
      await two`begin`;
      await two`set local statement_timeout = '5s'`; // a run that waited on the lock would fail here, not hang
      expect((await claim(one)).sort()).toEqual([...ids].sort());
      expect(await claim(two)).toEqual([]);
    } finally {
      // never keep a claim: the shared local DB may hold real visits due at that moment
      await one`rollback`.catch(() => {});
      await two`rollback`.catch(() => {});
      one.release();
      two.release();
      await pool.end();
      if (a) {
        await sql`delete from leads where account_id = ${a.accountId}`;
        await sql`delete from accounts where id = ${a.accountId}`;
        await sql`delete from auth.users where id = ${a.ownerId}`;
      }
    }
  });
});

describe("account scoping", () => {
  it("a phone that has open leads in two accounts matches neither; the link's lead id picks its own account only", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const la = await oldLead(t, a, { phone: "+919811111111" });
      const lb = await oldLead(t, b, { phone: "+919811111111" });
      expect(await book(t, "bk_s1", { phone: "+919811111111" })).toEqual([]);
      // a lead id with someone else's phone is refused, in any account
      expect(await book(t, "bk_s3", { lead: lb.leadId, phone: "+919899999999" })).toEqual([]);
      expect(await book(t, "bk_s4", { lead: la.leadId, phone: "+919899999999" })).toEqual([]);
      expect(Number((await t`select count(*) from visits where cal_booking_id in ('bk_s3', 'bk_s4')`)[0].count)).toBe(0);
      const got = await book(t, "bk_s2", { lead: lb.leadId, phone: "+919811111111" });
      expect(got[0]).toMatchObject({ lead_id: lb.leadId, account_id: b.accountId });
      expect(await stageOf(t, la.leadId)).toBe(a.stageIds[0]);
      expect(await stageOf(t, lb.leadId)).toBe(b.stageIds[1]);
      expect((await t`select account_id from visits where cal_booking_id = 'bk_s2'`)[0].account_id).toBe(b.accountId);
    }));

  it("no signed-in user, even an owner, can call the webhook's functions", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await oldLead(t, a);
      await actAs(t, await member(t, a.accountId, "owner"));
      for (const call of [
        (s: Tx) => s`select * from calcom_book('bk_x', now(), ${leadId}, null, null)`,
        (s: Tx) => s`select calcom_cancel('bk_x', now(), null, null)`,
        (s: Tx) => s`select * from calcom_no_show('bk_x')`,
        (s: Tx) => s`select * from claim_visit_reminders()`,
      ]) {
        expect((await errorOf(t, call))?.code).toBe("42501");
      }
    }));
});
