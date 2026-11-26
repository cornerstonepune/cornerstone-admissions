// #68 · The Cal.com webhook: only a correctly signed request gets in (fails closed with no secret), each event reaches
// its database function once with what Cal.com sent, and the confirmation / rebook message goes out only when the
// database recorded something new. The database side (replays, moves, scoping) is tests/db/m5-booking.test.ts.
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn() }));

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: () => {
    const q: Record<string, unknown> = {};
    for (const m of ["from", "select", "eq"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data: { id: "conv-1" }, error: null });
    // the approved-template language lookup awaits the query itself
    q.then = (resolve: (v: unknown) => void) => resolve({ data: [{ language: "mr" }], error: null });
    q.rpc = h.rpc;
    return q;
  },
}));
vi.mock("@/lib/automations/meta-send", () => ({ engineSendTemplate: h.send }));

import { visitLink } from "@/admissions/lib/booking";
import { POST } from "./route";

const SECRET = "whsec-test-123";
const LEAD = "3f0c2a8e-4b7d-4c1e-9a55-0d6b2f1e7a90";
const sign = (body: string, secret = SECRET) => crypto.createHmac("sha256", secret).update(body).digest("hex");

/** Shaped like Cal.com's documented webhook payloads (cal.com/help/webhooks, version 2021-10-20). */
function calPayload(triggerEvent: string, extra: Record<string, unknown> = {}) {
  return {
    triggerEvent,
    createdAt: "2026-12-01T05:30:12.000Z",
    payload: {
      type: "neev-visit",
      title: "Neev campus visit between Cornerstone Admissions and Priya Sharma",
      description: "",
      additionalNotes: "",
      customInputs: {},
      startTime: "2026-12-04T05:00:00Z",
      endTime: "2026-12-04T05:45:00Z",
      organizer: {
        id: 7,
        name: "Cornerstone Admissions",
        email: "admissions@example.org",
        username: "cornerstone",
        timeZone: "Asia/Kolkata",
        language: { locale: "en" },
        timeFormat: "h:mma",
        utcOffset: 330,
      },
      responses: {
        name: { label: "your_name", value: "Priya Sharma" },
        email: { label: "email_address", value: "priya@example.com" },
        attendeePhoneNumber: { label: "phone_number", value: "+91 98765 43210" },
        location: { label: "location", value: { optionValue: "", value: "inPerson" } },
      },
      userFieldsResponses: {},
      attendees: [
        {
          email: "priya@example.com",
          name: "Priya Sharma",
          firstName: "",
          lastName: "",
          timeZone: "Asia/Kolkata",
          phoneNumber: "+919876543210",
          language: { locale: "en" },
          utcOffset: 330,
        },
      ],
      location: "Cornerstone Neev campus",
      eventTypeId: 1201,
      bookingId: 901,
      uid: "bk_7Qm2xVgH1aZc",
      iCalUID: "bk_7Qm2xVgH1aZc@Cal.com",
      length: 45,
      price: 0,
      currency: "inr",
      status: "ACCEPTED",
      metadata: { lead: LEAD },
      ...extra,
    },
  };
}

const post = (body: unknown, signature?: string | null) => {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json", "x-cal-webhook-version": "2021-10-20" };
  if (signature !== null) headers["x-cal-signature-256"] = signature ?? sign(raw);
  return POST(new Request("http://localhost/api/admissions/calcom", { method: "POST", headers, body: raw }));
};

const recipient = [{ lead_id: LEAD, account_id: "acc-1", contact_id: "con-1", owner_id: "own-1" }];

beforeEach(() => {
  vi.stubEnv("CALCOM_WEBHOOK_SECRET", SECRET);
  h.rpc.mockReset().mockResolvedValue({ data: recipient, error: null });
  h.send.mockReset().mockResolvedValue({ whatsapp_message_id: "wamid.1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("signature: an unsigned webhook is refused and writes nothing", () => {
  it("is 401 with no signature", async () => {
    expect((await post(calPayload("BOOKING_CREATED"), null)).status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("is 401 with a wrong signature, a signature for another body, or one made with another secret", async () => {
    const body = calPayload("BOOKING_CREATED");
    expect((await post(body, "deadbeef")).status).toBe(401);
    expect((await post(body, sign(JSON.stringify(calPayload("BOOKING_CANCELLED"))))).status).toBe(401);
    expect((await post(body, sign(JSON.stringify(body), "other-secret"))).status).toBe(401);
    expect((await post(body, "no-secret-provided")).status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("fails closed when CALCOM_WEBHOOK_SECRET is not set, even for a body signed with an empty secret", async () => {
    vi.stubEnv("CALCOM_WEBHOOK_SECRET", "");
    const body = calPayload("BOOKING_CREATED");
    expect((await post(body, sign(JSON.stringify(body), ""))).status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("accepts the right signature in upper case too (hex)", async () => {
    const body = calPayload("BOOKING_CREATED");
    expect((await post(body, sign(JSON.stringify(body)).toUpperCase())).status).toBe(200);
  });
});

describe("events", () => {
  it("BOOKING_CREATED books with the lead id from the link and the parent's phone, and confirms once", async () => {
    const res = await post(calPayload("BOOKING_CREATED"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, event: "booked", changed: true });
    expect(h.rpc).toHaveBeenCalledWith("calcom_book", {
      p_booking: "bk_7Qm2xVgH1aZc",
      p_starts_at: "2026-12-04T05:00:00Z",
      p_lead_id: LEAD,
      p_phone: "+91 98765 43210",
      p_from_booking: null,
      p_location: "Cornerstone Neev campus",
    });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toMatchObject({
      templateName: "visit_confirmed",
      contactId: "con-1",
      accountId: "acc-1",
      language: "mr", // the approved template's language, not wacrm's en_US default
    });
  });

  it("a replay the database ignores sends nothing", async () => {
    h.rpc.mockResolvedValue({ data: [], error: null });
    const res = await post(calPayload("BOOKING_CREATED"));
    expect(await res.json()).toEqual({ ok: true, event: "booked", changed: false });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("a booking without our link falls back to the attendee's phone; a lead id that isn't a uuid is dropped", async () => {
    await post(calPayload("BOOKING_CREATED", { metadata: { lead: "1; drop table leads" }, responses: {} }));
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_lead_id: null, p_phone: "+919876543210" });
  });

  it("passes the location the parent picked (it names the campus); a missing or non-text location is null (ADR 0033)", async () => {
    await post(calPayload("BOOKING_CREATED", { location: "  Gurukul campus, Baner Road, Pune " }));
    await post(calPayload("BOOKING_CREATED", { location: undefined }));
    await post(calPayload("BOOKING_CREATED", { location: { type: "inPerson" } }));
    expect(h.rpc.mock.calls.map((c) => c[1].p_location)).toEqual(["Gurukul campus, Baner Road, Pune", null, null]);
  });

  it("BOOKING_RESCHEDULED books the new uid and names the booking it replaces", async () => {
    await post(
      calPayload("BOOKING_RESCHEDULED", {
        uid: "bk_new_9Hd3",
        bookingId: 902,
        startTime: "2026-12-05T06:00:00Z",
        rescheduleUid: "bk_7Qm2xVgH1aZc",
        rescheduleId: 901,
        rescheduleStartTime: "2026-12-04T05:00:00Z",
      }),
    );
    expect(h.rpc).toHaveBeenCalledWith(
      "calcom_book",
      expect.objectContaining({ p_booking: "bk_new_9Hd3", p_starts_at: "2026-12-05T06:00:00Z", p_from_booking: "bk_7Qm2xVgH1aZc" }),
    );
  });

  it("BOOKING_CANCELLED cancels the booking and sends nothing", async () => {
    h.rpc.mockResolvedValue({ data: LEAD, error: null });
    const res = await post(calPayload("BOOKING_CANCELLED", { status: "CANCELLED", cancellationReason: "Travelling" }));
    expect(await res.json()).toEqual({ ok: true, event: "cancelled", changed: true });
    expect(h.rpc).toHaveBeenCalledWith("calcom_cancel", {
      p_booking: "bk_7Qm2xVgH1aZc",
      p_starts_at: "2026-12-04T05:00:00Z",
      p_lead_id: LEAD,
      p_phone: "+91 98765 43210",
      p_location: "Cornerstone Neev campus",
    });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("BOOKING_NO_SHOW_UPDATED marks the no-show and sends the rebook message; un-marking does nothing", async () => {
    const noShow = (flag: boolean) => ({
      triggerEvent: "BOOKING_NO_SHOW_UPDATED",
      createdAt: "2026-12-04T07:00:00.000Z",
      payload: {
        message: `priya@example.com ${flag ? "marked" : "unmarked"} as no-show`,
        attendees: [{ email: "priya@example.com", noShow: flag }],
        bookingUid: "bk_7Qm2xVgH1aZc",
        bookingId: 901,
      },
    });
    await post(noShow(true));
    expect(h.rpc).toHaveBeenCalledWith("calcom_no_show", { p_booking: "bk_7Qm2xVgH1aZc" });
    expect(h.send.mock.calls[0][0]).toMatchObject({ templateName: "visit_missed_rebook" });

    h.rpc.mockClear();
    const res = await post(noShow(false));
    expect(await res.json()).toEqual({ ok: true, event: "ignored", changed: false });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("other events and Cal.com's ping are acknowledged and ignored", async () => {
    expect((await post(calPayload("MEETING_ENDED"))).status).toBe(200);
    expect((await post({ triggerEvent: "PING", payload: {} })).status).toBe(200);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("is 500 when the database fails, so Cal.com shows the delivery as failed", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await post(calPayload("BOOKING_CREATED"))).status).toBe(500);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("is 413 for a body over 4 MB, before the signature is even checked", async () => {
    const raw = JSON.stringify({ ...calPayload("BOOKING_CREATED"), pad: "x".repeat(4 * 1024 * 1024) });
    const res = await POST(
      new Request("http://localhost/api/admissions/calcom", { method: "POST", headers: { "x-cal-signature-256": sign(raw) }, body: raw }),
    );
    expect(res.status).toBe(413);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("is 400 for a signed body that isn't JSON", async () => {
    const raw = "not json";
    const res = await POST(
      new Request("http://localhost/api/admissions/calcom", { method: "POST", headers: { "x-cal-signature-256": sign(raw) }, body: raw }),
    );
    expect(res.status).toBe(400);
  });
});

describe("visitLink", () => {
  it("prefills the parent's name and phone and carries the lead id", () => {
    const url = new URL(visitLink("https://cal.com/cornerstone/neev-visit", { id: LEAD, parentName: "Priya Sharma", phone: "919876543210" }));
    expect(url.origin + url.pathname).toBe("https://cal.com/cornerstone/neev-visit");
    expect(url.searchParams.get("name")).toBe("Priya Sharma");
    expect(url.searchParams.get("attendeePhoneNumber")).toBe("+919876543210");
    expect(url.searchParams.get("metadata[lead]")).toBe(LEAD);
  });

  it("leaves out what it doesn't know", () => {
    const url = new URL(visitLink("https://cal.com/cornerstone/gurukul-visit?month=2026-12", { id: LEAD }));
    expect(url.searchParams.get("month")).toBe("2026-12");
    expect(url.searchParams.has("name")).toBe(false);
    expect(url.searchParams.has("attendeePhoneNumber")).toBe(false);
  });
});
