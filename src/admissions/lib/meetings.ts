// Meetings (ADR 0040): a campus visit, a video call or a phone call with a family. Cal.com books most of them; staff
// book the rest while logging a call. All are visit rows, shown on the Calendar and reminded on WhatsApp alike.
// No server imports here: the call form and the Calendar use the kinds too.

export const MEETING_KINDS = { campus: "Campus visit", virtual: "Video call", phone: "Phone call" } as const;
export type MeetingKind = keyof typeof MEETING_KINDS;

export interface MeetingInput {
  startsAt: string; // ISO
  kind: MeetingKind;
  campusId: string | null;
  url: string | null;
}

/** A link we may store and show: https, no spaces, at most 500 characters (migration 128's check). */
export const safeUrl = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.length <= 500 && /^https:\/\/\S+$/.test(s) ? s : null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR = 3_600_000;

/** Checks a meeting a staff member sent: from an hour ago to a year ahead, a known kind, an https link for video. */
export function parseMeeting(raw: unknown, now = new Date()): MeetingInput | { error: string } {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const at = typeof m.starts_at === "string" ? Date.parse(m.starts_at) : NaN;
  if (Number.isNaN(at)) return { error: "Pick the meeting's date and time" };
  if (at < now.getTime() - HOUR || at > now.getTime() + 366 * 24 * HOUR) {
    return { error: "The meeting must be from now to a year ahead" };
  }
  if (typeof m.kind !== "string" || !(m.kind in MEETING_KINDS)) return { error: "Pick the kind of meeting" };
  const kind = m.kind as MeetingKind;
  const campusId = typeof m.campus_id === "string" && m.campus_id ? m.campus_id : null;
  if (campusId && !UUID.test(campusId)) return { error: "Not a valid campus" };
  const given = typeof m.url === "string" && m.url.trim() ? m.url.trim() : null;
  const url = kind === "virtual" && given ? safeUrl(given) : null;
  if (kind === "virtual" && given && !url) return { error: "The meeting link must start with https://" };
  return { startsAt: new Date(at).toISOString(), kind, campusId, url };
}

/** "Meeting set: Tue 2 Dec, 11:00 am · Video call", in India time, for the call's notes. */
export function meetingLine(m: Pick<MeetingInput, "startsAt" | "kind">): string {
  const when = new Date(m.startsAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Meeting set: ${when} · ${MEETING_KINDS[m.kind]}`;
}
