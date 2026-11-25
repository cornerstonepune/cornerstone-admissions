// G0.4, the invariants the tables themselves enforce (migration 100): 3, 4 and 6.
import { afterAll, describe, expect, it } from "vitest";
import { account, contact, errorOf, lead, setting, sql, tx } from "./db";

afterAll(() => sql.end());

describe("invariant 3: one open lead per contact", () => {
  it("rejects a second open lead for the same contact", () =>
    tx(async (t) => {
      const a = await account(t);
      const { contactId } = await lead(t, a);
      const err = await errorOf(t, (s) => lead(s, a, { contactId }));
      expect(err?.code).toBe("23505");
    }));

  it("allows a new lead once the old one has exited", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, contactId } = await lead(t, a);
      await t`update leads set exit = 'dormant', exited_at = now() where id = ${leadId}`;
      expect(await errorOf(t, (s) => lead(s, a, { contactId }))).toBeNull();
    }));

  it("rejects a second contact with the same phone in the account", () =>
    tx(async (t) => {
      const a = await account(t);
      await contact(t, a, "+91 98765 43210");
      const err = await errorOf(t, (s) => contact(s, a, "+919876543210"));
      expect(err?.code).toBe("23505");
    }));
});

describe("invariant 4: Lost needs a lost reason", () => {
  it("rejects Lost without a reason", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const err = await errorOf(t, (s) => s`update leads set exit = 'lost', exited_at = now() where id = ${leadId}`);
      expect(err?.code).toBe("23514");
    }));

  it("accepts Lost with a reason", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const reason = await setting(t, a, "lost_reason", "chose_other_school");
      const err = await errorOf(
        t,
        (s) => s`update leads set exit = 'lost', exited_at = now(), lost_reason_id = ${reason} where id = ${leadId}`,
      );
      expect(err).toBeNull();
    }));

  it("rejects a lost reason on a lead that is not Lost", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const reason = await setting(t, a, "lost_reason", "fees");
      const err = await errorOf(t, (s) => s`update leads set lost_reason_id = ${reason} where id = ${leadId}`);
      expect(err?.code).toBe("23514");
    }));
});

describe("invariant 6: no double sends, no double bookings", () => {
  it("rejects a repeated Cal.com booking id", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const insert = (s: typeof t) =>
        s`insert into visits (account_id, lead_id, cal_booking_id, starts_at) values (${a.accountId}, ${leadId}, 'cal_123', now())`;
      await insert(t);
      expect((await errorOf(t, insert))?.code).toBe("23505");
    }));

  it("rejects a second send for the same lead, rule and stage entry", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      const rule = await setting(t, a, "follow_up_rule", "enquiry_day_2", { stage: "enquiry", days: 2, action: "send_template", template: "enquiry_day_2" });
      const [h] = await t`
        insert into lead_stage_history (account_id, lead_id, stage_id) values (${a.accountId}, ${leadId}, ${a.stageIds[0]})
        returning id`;
      const send = (s: typeof t) => s`
        insert into lead_activity (account_id, lead_id, kind, rule_id, stage_history_id)
        values (${a.accountId}, ${leadId}, 'follow_up_send', ${rule}, ${h.id})`;
      await send(t);
      expect((await errorOf(t, send))?.code).toBe("23505");
    }));

  it("rejects a follow-up rule whose day count is not a whole number", () =>
    tx(async (t) => {
      const a = await account(t);
      const err = await errorOf(t, (s) => setting(s as typeof t, a, "follow_up_rule", "bad", { stage: "enquiry", days: -1, action: "call_task" }));
      expect(err?.code).toBe("23514");
    }));
});
