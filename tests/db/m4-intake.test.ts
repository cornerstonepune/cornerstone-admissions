// M4 one door (#67, migration 119): intake_lead behind every door. Phones and dates go through the app's own parsing
// (src/admissions/lib/intake.ts) first, as the routes do. Every test builds its own accounts inside tx(), which rolls back.
import { afterAll, describe, expect, it } from "vitest";

import { phoneDigits, prefilledText, routeByDob, sourceCode, type Campus } from "@/admissions/lib/intake";
import { account, actAs, actAsSuperuser, errorOf, member, setting, sql, tx, contact, type Tx } from "./db";

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
      expect(notes.map((n) => n.note_text)).toEqual(["Enquired again on the website"]);
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
