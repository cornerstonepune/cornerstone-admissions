// The admissions dashboard (ADR 0037): this week at a glance for counsellors and leadership. Pure: dashboard.tsx reads
// the rows with the caller's RLS client, plus the Today list (/api/admissions/today) for what needs attention and the
// funnel report (admissions_report) for the last 90 days; this file turns them into numbers with yardsticks, worst first.
import { startOfMonth, subDays, subMonths } from "date-fns";

import { buildFunnel, change, MIN_LEADS, type RawReport } from "./report";
import { familyOf, type Today, type VisitRow } from "./today";

const DAY = 86_400_000;
export const TREND_WEEKS = 12;

/** A lead as the dashboard counts it: open, new, admitted or closed lately. */
export interface DashLead {
  created_at: string;
  imported_at: string | null;
  admitted_at: string | null;
  exited_at: string | null;
  campus_id: string | null;
}

export interface DashInput {
  leads: DashLead[];
  visits: VisitRow[];
  calls: { assigned_to: string | null; done_at: string }[];
  moves: { moved_by: string; entered_at: string }[];
  members: { user_id: string; full_name: string }[];
  campuses: { id: string; label: string }[];
  funnel: RawReport;
  today: Today;
}

export type Tone = "ok" | "wait" | "late" | "quiet";
export interface Stat {
  label: string;
  value: number;
  yard: string;
  tone?: Tone;
}
export interface AttentionRow {
  key: string;
  leadId: string;
  family: string;
  tone: Tone;
  words: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ms = (iso: string | null) => (iso == null ? NaN : Date.parse(iso));
/** Was `iso` in [a, b)? */
const within = (iso: string | null, a: number, b: number) => ms(iso) >= a && ms(iso) < b;
const isOpen = (l: DashLead, t: number) => ms(l.created_at) < t && !(ms(l.admitted_at) < t) && !(ms(l.exited_at) < t);

export function buildDashboard(input: DashInput, now: Date = new Date()) {
  const t = now.getTime();
  const [d7, d14] = [t - 7 * DAY, t - 14 * DAY];
  const [month, lastMonth] = [startOfMonth(now).getTime(), startOfMonth(subMonths(now, 1)).getTime()];
  // New enquiries and admissions by date leave out imported leads: their dates are the import's (ADR 0036).
  const live = input.leads.filter((l) => !l.imported_at);
  const newIn = (a: number, b: number, campus?: string | null) =>
    live.filter((l) => within(l.created_at, a, b) && (campus === undefined || l.campus_id === campus)).length;
  const admittedIn = (a: number, b: number, campus?: string | null) =>
    live.filter((l) => within(l.admitted_at, a, b) && (campus === undefined || l.campus_id === campus)).length;
  const open = input.leads.filter((l) => isOpen(l, t + 1));
  const openWeekAgo = input.leads.filter((l) => isOpen(l, d7)).length;

  const held = input.visits.filter((v) => within(v.starts_at, d7, t) && v.status !== "cancelled" && v.status !== "rescheduled");
  const visited = held.filter((v) => v.status === "visited").length;
  const noShow = held.filter((v) => v.status === "no_show").length;
  const unmarked = held.filter((v) => v.status === "booked");
  const upcoming = input.visits
    .filter((v) => v.status === "booked" && within(v.starts_at, t, t + 7 * DAY))
    .sort((a, b) => ms(a.starts_at) - ms(b.starts_at));

  const stuck = input.today.stuck;
  const waiting = input.today.calls.filter((c) => c.why !== "due");
  const fresh = newIn(d7, t + 1);
  const before = newIn(d14, d7);

  const stats: Stat[] = [
    { label: "New enquiries, 7 days", value: fresh, yard: `7 days before: ${before}${change(fresh, before)}`, tone: fresh < before ? "wait" : undefined },
    { label: "Visits next 7 days", value: upcoming.length, yard: `last 7 days: ${held.length} held` },
    {
      label: "Visited, last 7 days",
      value: visited,
      yard: `${plural(noShow, "no-show")}${unmarked.length ? ` · ${unmarked.length} not marked` : ""}`,
      tone: noShow || unmarked.length ? "wait" : undefined,
    },
    {
      label: "Admitted this month",
      value: admittedIn(month, t + 1),
      yard: `last month: ${admittedIn(lastMonth, month)}`,
    },
    { label: "Open leads", value: open.length, yard: `7 days ago: ${openWeekAgo}` },
    {
      label: "Stuck",
      value: stuck.length,
      yard: stuck.length ? `of ${open.length} open · worst ${stuck[0].family}` : `of ${open.length} open`,
      tone: stuck.length ? "wait" : "ok",
    },
  ];

  // Needs attention: families waiting on a call (red), stuck leads, then past visits nobody marked (amber).
  const attention: AttentionRow[] = [
    ...waiting.map((c) => ({
      key: c.key,
      leadId: c.leadId,
      family: c.family,
      tone: "late" as const,
      words: c.why === "untouched" ? `Untouched ${c.hours} h: ${c.reason.toLowerCase()}` : `Call overdue: ${c.reason}`,
    })),
    ...stuck.map((s) => ({
      key: `s-${s.leadId}`,
      leadId: s.leadId,
      family: s.family,
      tone: "wait" as const,
      words: `Stuck ${s.days} days in ${s.stage} (limit ${s.limit})`,
    })),
    ...unmarked.map((v) => ({ key: `v-${v.id}`, leadId: v.lead_id, family: familyOf(v.lead), tone: "wait" as const, words: "Visit not marked Visited or No-show" })),
  ];

  const funnel = buildFunnel(input.funnel.stages, input.funnel.leads);

  // Campus split: every campus in Settings, and "No campus" only when a lead has none.
  const campusList = [...input.campuses, ...(input.leads.some((l) => !l.campus_id) ? [{ id: null, label: "No campus" }] : [])];
  const campuses = campusList.map((c) => {
    const id = c.id as string | null;
    return {
      label: c.label,
      fresh: newIn(d7, t + 1, id),
      before: newIn(d14, d7, id),
      open: open.filter((l) => l.campus_id === id).length,
      visits: upcoming.filter((v) => v.campus?.label === c.label).length,
      admitted: admittedIn(month, t + 1, id),
    };
  });
  const topOpen = [...campuses].sort((a, b) => b.open - a.open)[0];
  const topNew = [...campuses].sort((a, b) => b.fresh - a.fresh)[0];
  const campusTake = !campuses.length
    ? "No campus is set up in Settings yet."
    : fresh
      ? `${topNew.label} brought ${topNew.fresh} of the ${plural(fresh, "new enquiry", "new enquiries")} this week; ${topOpen.label} holds ${topOpen.open} of ${open.length} open leads.`
      : `No new enquiry this week; ${topOpen.label} holds ${topOpen.open} of ${open.length} open leads.`;

  // Enquiries per week, oldest first; the last week ends now.
  const weeks = Array.from({ length: TREND_WEEKS }, (_, i) => {
    const end = t - (TREND_WEEKS - 1 - i) * 7 * DAY;
    return { start: new Date(end - 7 * DAY), n: newIn(end - 7 * DAY, end + (i === TREND_WEEKS - 1 ? 1 : 0)) };
  });
  const earlier = weeks.slice(0, -1);
  const avg = earlier.reduce((n, w) => n + w.n, 0) / earlier.length;
  const peak = weeks.reduce((p, w, i) => (w.n > weeks[p].n ? i : p), 0);
  const trendTake = `This week ${plural(fresh, "enquiry", "enquiries")}, against ${avg.toFixed(1)} a week over the ${earlier.length} weeks before.`;

  // Counsellors, least activity first: calls logged (a call task marked done, by who logged it) and stage moves.
  const team = input.members
    .map((m) => ({
      id: m.user_id,
      name: m.full_name || "Member",
      calls: input.calls.filter((c) => c.assigned_to === m.user_id && within(c.done_at, d7, t + 1)).length,
      moves: input.moves.filter((x) => x.moved_by === m.user_id && within(x.entered_at, d7, t + 1)).length,
    }))
    .sort((a, b) => a.calls + a.moves - (b.calls + b.moves) || a.name.localeCompare(b.name));
  const calls = team.reduce((n, m) => n + m.calls, 0);
  const prevCalls = input.calls.filter((c) => within(c.done_at, d14, d7)).length;
  const idle = team.filter((m) => !m.calls && !m.moves).map((m) => m.name);
  const teamTake =
    `${plural(calls, "call")} logged and ${plural(team.reduce((n, m) => n + m.moves, 0), "move")} made in 7 days (calls the 7 days before: ${prevCalls}).` +
    (idle.length && idle.length < team.length ? ` Nothing logged by ${idle.join(", ")}.` : "");

  // What matters most right now, in one line.
  const takeaway = waiting.length
    ? `${plural(waiting.length, "family is", "families are")} waiting on a call. Start with ${waiting[0].family}.`
    : stuck.length
      ? `${plural(stuck.length, "lead is", "leads are")} stuck past the stage limit; the longest is ${stuck[0].family} (${stuck[0].days} days in ${stuck[0].stage}).`
      : unmarked.length
        ? `${plural(unmarked.length, "visit")} from the last 7 days ${unmarked.length === 1 ? "is" : "are"} not marked Visited or No-show yet.`
        : fresh < before
          ? `New enquiries fell to ${fresh} this week from ${before} the week before.`
          : funnel.worst >= 0 && input.funnel.leads >= MIN_LEADS
            ? `Nothing waiting. ${funnel.headline}`
            : "Nothing waiting: no family on hold, nothing stuck.";

  return {
    takeaway,
    stats,
    attention,
    upcoming,
    funnel: { ...funnel, leads: input.funnel.leads, rates: input.funnel.leads >= MIN_LEADS },
    campuses,
    campusTake,
    weeks,
    peak,
    trendTake,
    team,
    teamTake,
  };
}

export type Dashboard = ReturnType<typeof buildDashboard>;

/** The window the dashboard reads: 12 trend weeks, last month's admissions, and the funnel's 90 days. */
export function dashboardWindow(now: Date = new Date()) {
  return {
    trendFrom: subDays(now, TREND_WEEKS * 7),
    lastMonth: startOfMonth(subMonths(now, 1)),
    weekAgo: subDays(now, 7),
    twoWeeksAgo: subDays(now, 14),
    funnelFrom: subDays(now, 90),
    nextWeek: new Date(now.getTime() + 7 * DAY),
  };
}
