// M4 one door (#67, migration 119): intake_lead behind every door. Phones and dates go through the app's own parsing
// (src/admissions/lib/intake.ts) first, as the routes do. Every test builds its own accounts inside tx(), which rolls back.
import { afterAll, describe, expect, it } from "vitest";

import { phoneDigits, prefilledText, routeByDob, sourceCode, type Campus } from "@/admissions/lib/intake";
import postgres from "postgres";

import { account, actAs, actAsSuperuser, contact, DATABASE_URL, errorOf, member, setting, sql, tx, type Account, type Tx } from "./db";

afterAll(() => sql.end());

type Out = { contact_id: string; lead_id: string | null; created: boolean };
const intake = async (t: Tx, accountId: string, lead: Record<string, unknown>): Promise<Out> => {
  const [{ r }] = await t`select public.intake_lead(${accountId}, ${t.json(lead as never)}) as r`;
  return r as Out;
};
const openLeads = async (t: Tx, accountId: string) =>
  t`select l.* from leads l where l.account_id = ${accountId} and l.exit is null and l.admitted_at is null`;

describe("G4.1 the same phone through any door, in any format, gives one contact and one open lead", () => {
  it("quick-add, then the website form, then WhatsApp", () =>
    tx(async (t) => {
      const a = await account(t);
      const walkIn = await setting(t, a, "source", "walk_in");
      await setting(t, a, "source", "website");
      await setting(t, a, "source", "whatsapp");
      const staff = await member(t, a.accountId, "agent");

      await actAs(t, staff); // quick-add runs as the staff member, through RLS
      const first = await intake(t, a.accountId, {
        phone: phoneDigits("98765 43210"), parent: "Sunita Patil", child: "Aarav", source_keys: ["walk_in"], note: "Came in again",
      });
      expect(first.created).toBe(true);

      await actAsSuperuser(t); // the website form and the webhook run as the service
      const web = await intake(t, a.accountId, {
        phone: phoneDigits("+91 98765-43210"), parent: "S. Patil", child: "Someone else", source_keys: ["website"],
        note: "Enquired again on the website",
      });
      const wa = await intake(t, a.accountId, { contact_id: first.contact_id, source_keys: ["whatsapp"], reopen: false });

      expect(web).toEqual({ contact_id: first.contact_id, lead_id: first.lead_id, created: false });
      expect(wa).toEqual({ contact_id: first.contact_id, lead_id: first.lead_id, created: false });
      const contacts = await t`select name from contacts where account_id = ${a.accountId} and phone_normalized = '919876543210'`;
      expect(contacts).toHaveLength(1);
      expect(contacts[0].name).toBe("Sunita Patil"); // a later door never renames the parent
      const leads = await openLeads(t, a.accountId);
      expect(leads).toHaveLength(1);
      expect(leads[0]).toMatchObject({ child_name: "Aarav", source_id: walkIn }); // first source and child stay
      const notes = await t`select note_text from contact_notes where contact_id = ${first.contact_id}`;
      // what the second door sent (another child's name, its source) is kept in the note, not dropped (#91 review)
      expect(notes.map((n) => n.note_text)).toEqual(["Enquired again on the website Submitted: child Someone else, source website."]);
      const [stage] = await t`select d.stage_id, d.user_id from deals d join leads l on l.deal_id = d.id where l.id = ${first.lead_id}`;
      expect(stage).toEqual({ stage_id: a.stageIds[0], user_id: staff }); // in Enquiry, by whoever saved it
    }));

  it("a contact saved without 91 is the same family, as import and Cal.com match it", () =>
    tx(async (t) => {
      const a = await account(t);
      const saved = await contact(t, a, "98765 43211"); // typed in by hand, no country code
      const r = await intake(t, a.accountId, { phone: phoneDigits("+91 98765 43211") });
      expect(r.contact_id).toBe(saved);
      expect(await t`select 1 from contacts where account_id = ${a.accountId}`).toHaveLength(1);
    }));

  it("a reused lead fills only what it lacks", () =>
    tx(async (t) => {
      const a = await account(t);
      const wa = await intake(t, a.accountId, { phone: "919800000001" }); // first message, nothing known yet
      await intake(t, a.accountId, { contact_id: wa.contact_id, child: "Meera", child_dob: "2022-03-14", area: "Baner" });
      const [l] = await openLeads(t, a.accountId);
      expect(l.child_name).toBe("Meera");
      expect(l.area).toBe("Baner");
      expect(String(l.child_dob.toISOString?.() ?? l.child_dob).slice(0, 10)).toBe("2022-03-14");
    }));

  it("a closed family writing again on WhatsApp gets no new lead; one who scans a QR does", () =>
    tx(async (t) => {
      const a = await account(t);
      const gate = await setting(t, a, "source", "gate_qr");
      const first = await intake(t, a.accountId, { phone: "919800000002" });
      await t`update leads set exit = 'dormant', exited_at = now() where id = ${first.lead_id}`;
      const thanks = await intake(t, a.accountId, { contact_id: first.contact_id, source_keys: ["whatsapp"], reopen: false });
      expect(thanks.lead_id).toBeNull();
      expect(await openLeads(t, a.accountId)).toHaveLength(0);
      const back = await intake(t, a.accountId, { contact_id: first.contact_id, source_keys: ["gate_qr", "whatsapp"], reopen: true });
      expect(back.created).toBe(true);
      expect((await openLeads(t, a.accountId))[0].source_id).toBe(gate);
    }));

  it("a door can't open a lead in another account, nor reuse another account's contact", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      await actAs(t, await member(t, b.accountId, "agent"));
      expect((await errorOf(t, (s) => intake(s, a.accountId, { phone: "919800000003" })))?.code).toBe("42501");
      await actAsSuperuser(t);
      const theirs = await contact(t, b, "+919800000004");
      expect((await errorOf(t, (s) => intake(s, a.accountId, { contact_id: theirs })))?.code).toBe("23503");
      expect(await openLeads(t, a.accountId)).toHaveLength(0);
    }));
});

describe("G4.2 date of birth on, the day before and the day after the cut-off routes correctly", () => {
  it("routes by the campus settings Nimish enters", () =>
    tx(async (t) => {
      const a = await account(t);
      // cut-off 2022-06-01: born before it is Nursery, on or after it is Playgroup
      const nursery = await setting(t, a, "campus", "neev_nursery", { grades: "Nursery", born_from: "2021-06-01", born_before: "2022-06-01" });
      const playgroup = await setting(t, a, "campus", "neev_pg", { grades: "Playgroup", born_from: "2022-06-01", born_before: "2023-06-01" });
      const campuses = (await t`select id, value from admissions_settings where account_id = ${a.accountId} and kind = 'campus' and active`) as unknown as Campus[];
      const cases = [
        ["2022-05-31", nursery, "Nursery"],
        ["2022-06-01", playgroup, "Playgroup"],
        ["2022-06-02", playgroup, "Playgroup"],
      ] as const;
      for (const [i, [dob, campus, grade]] of cases.entries()) {
        const r = await intake(t, a.accountId, { phone: `91980000010${i}`, child_dob: dob, ...routeByDob(dob, campuses) });
        const [l] = await t`select campus_id, grade from leads where id = ${r.lead_id}`;
        expect({ dob, ...l }).toEqual({ dob, campus_id: campus, grade });
      }
    }));
});

describe("a source code maps to its source; an unknown or another account's code falls back to WhatsApp", () => {
  it("reads the code from the first message", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const whatsapp = await setting(t, a, "source", "whatsapp");
      const gate = await setting(t, a, "source", "gate_qr");
      await setting(t, b, "source", "insta"); // only account B has this tag
      const firstMessage = (text: string) => [sourceCode(text), "whatsapp"].filter(Boolean);
      const cases = [
        [prefilledText("gate_qr"), gate],
        [prefilledText("nope"), whatsapp],
        [prefilledText("insta"), whatsapp],
        ["Hi, is admission open for Sr KG?", whatsapp],
      ] as const;
      for (const [i, [text, source]] of cases.entries()) {
        const r = await intake(t, a.accountId, { phone: `91980000020${i}`, source_keys: firstMessage(text) });
        const [l] = await t`select source_id from leads where id = ${r.lead_id}`;
        expect({ text, source: l.source_id }).toEqual({ text, source });
      }
    }));
});

describe("review fixes (#91, migration 121)", () => {
  const notesOf = async (t: Tx, contactId: string) =>
    (await t`select note_text from contact_notes where contact_id = ${contactId} order by created_at, id`).map((n) => n.note_text);

  it("the public form never fills a known family's blanks; it only leaves a note with what was sent", () =>
    tx(async (t) => {
      const a = await account(t);
      await setting(t, a, "source", "website");
      const wa = await intake(t, a.accountId, { phone: "919800000301" }); // a WhatsApp first message: nothing known
      const web = await intake(t, a.accountId, {
        phone: "919800000301", parent: "Not the parent", child: "Typed by anyone", child_dob: "2022-03-14",
        source_keys: ["website"], note: "Enquired again on the website, 26 Nov.", fill: false,
      });
      expect(web).toMatchObject({ lead_id: wa.lead_id, created: false });
      const [l] = await t`select child_name, child_dob, source_id from leads where id = ${wa.lead_id}`;
      expect(l).toEqual({ child_name: null, child_dob: null, source_id: null });
      const [c] = await t`select name from contacts where id = ${wa.contact_id}`;
      expect(c.name).toBeNull();
      expect(await notesOf(t, wa.contact_id)).toEqual([
        "Enquired again on the website, 26 Nov. Submitted: child Typed by anyone, born 14/03/2022, source website.",
      ]);
    }));

  it("a sibling on WhatsApp is a note, once; the same child again writes nothing", () =>
    tx(async (t) => {
      const a = await account(t);
      const first = await intake(t, a.accountId, { phone: "919800000302", child: "Aarav" });
      for (let i = 0; i < 2; i++) await intake(t, a.accountId, { contact_id: first.contact_id, child: "Meera", child_dob: "2023-01-05" });
      await intake(t, a.accountId, { contact_id: first.contact_id, child: "Aarav" });
      expect(await notesOf(t, first.contact_id)).toEqual(["Another enquiry on this number: child Meera, born 05/01/2023."]);
      const [l] = await t`select child_name from leads where id = ${first.lead_id}`;
      expect(l.child_name).toBe("Aarav");
    }));

  it("a switched-off source is never set: the next tag that is on wins, else none", () =>
    tx(async (t) => {
      const a = await account(t);
      const gate = await setting(t, a, "source", "gate_qr");
      const whatsapp = await setting(t, a, "source", "whatsapp");
      await t`update admissions_settings set active = false where id = ${gate}`;
      const r1 = await intake(t, a.accountId, { phone: "919800000303", source_keys: ["gate_qr", "whatsapp"] });
      await t`update admissions_settings set active = false where id = ${whatsapp}`;
      const r2 = await intake(t, a.accountId, { phone: "919800000304", source_keys: ["gate_qr", "whatsapp"] });
      const got = await t`select id, source_id from leads where id in (${r1.lead_id}, ${r2.lead_id})`;
      expect(Object.fromEntries(got.map((l) => [l.id, l.source_id]))).toEqual({ [r1.lead_id!]: whatsapp, [r2.lead_id!]: null });
    }));
});

describe("two doors at the same moment", () => {
  it("two concurrent intake_lead calls for one new phone give one contact and one open lead", async () => {
    // Real concurrency needs committed rows in two sessions, so this test commits and deletes its own account.
    const one = postgres(DATABASE_URL, { onnotice: () => {}, max: 1 });
    const two = postgres(DATABASE_URL, { onnotice: () => {}, max: 1 });
    let a: Account | undefined;
    try {
      a = await sql.begin((t) => account(t));
      const accountId = a.accountId;
      const call = (c: Tx) => c`select public.intake_lead(${accountId}, ${c.json({ phone: "919800000399" })}) as r`;
      let second: Promise<postgres.Row[]> | undefined;
      const [{ r: r1 }] = await one.begin(async (t) => {
        const r = await call(t); // holds the new contact uncommitted…
        second = two.begin((u) => call(u)); // …so this one waits on the unique index until the first commits
        await new Promise((res) => setTimeout(res, 300));
        return r;
      });
      const [{ r: r2 }] = await second!;
      expect(r2.contact_id).toBe(r1.contact_id);
      expect(r2.lead_id).toBe(r1.lead_id);
      expect([r1.created, r2.created]).toEqual([true, false]);
      const [{ n }] = await sql`select count(*)::int as n from contacts where account_id = ${accountId}`;
      const open = await sql`select 1 from leads where account_id = ${accountId} and exit is null and admitted_at is null`;
      expect([n, open.length]).toEqual([1, 1]);
    } finally {
      if (a) {
        await sql`delete from leads where account_id = ${a.accountId}`;
        await sql`delete from deals where account_id = ${a.accountId}`;
        await sql`delete from accounts where id = ${a.accountId}`;
        await sql`delete from auth.users where id = ${a.ownerId}`;
      }
      await Promise.all([one.end(), two.end()]);
    }
  });
});
