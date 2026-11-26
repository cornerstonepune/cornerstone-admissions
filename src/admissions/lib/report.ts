// S-report (M7, #71, ADR 0027). The database counts (admissions_report, migration 116, from leads and stage history);
// this file only says what to notice: the takeaway line, the worst stage or source, and each number's yardstick,
// which is the same number for the period before.
import { addDays, addMonths, format, startOfMonth, startOfYear, subDays, subYears } from "date-fns";

import { isStuck } from "@/admissions/lib/pipeline";

export type Period = "30" | "90" | "year";
export const PERIODS: Record<Period, string> = { "30": "30 days", "90": "90 days", year: "This year" };
/** Below this many leads a rate means little: rates are hidden, counts still show (wireframe, "Too few leads"). */
export const MIN_LEADS = 20;

/** The period, and the period before it of the same length (last year's same dates for "This year"). */
export function periodRange(p: Period, now = new Date()) {
  const from = p === "year" ? startOfYear(now) : subDays(now, Number(p));
  return p === "year"
    ? { from, to: now, prevFrom: subYears(from, 1), prevTo: subYears(now, 1) }
    : { from, to: now, prevFrom: subDays(from, Number(p)), prevTo: from };
}

/** What admissions_report returns. */
export interface RawReport {
  leads: number;
  admitted: number;
  lost: number;
  dormant: number;
  days_to_admit: number | null;
  stages: { id: string; name: string; reached: number; on_board: number; median_days: number | null; open_days: number[] }[];
  sources: { label: string | null; leads: number; admitted: number }[];
  lost_reasons: { label: string; n: number }[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const share = (n: number, of: number) => (of > 0 ? n / of : null);
/** " (+25%)" against a yardstick; nothing when there is no yardstick to compare with. */
export const change = (n: number, was: number) => (was > 0 && n !== was ? ` (${n > was ? "+" : "−"}${pct(Math.abs(n - was) / was)})` : "");

/** The funnel: leads that reached each stage, the share lost from the stage before, the worst drop and what to say. */
export function buildFunnel(stages: RawReport["stages"], leads: number) {
  const funnel = stages.map((s, i) => {
    const before = stages[i - 1];
    return { ...s, share: share(s.reached, leads), lostFromPrev: before?.reached ? 1 - s.reached / before.reached : null };
  });
  const drops = funnel.map((s, i) => ({ i, d: s.lostFromPrev })).filter((x) => x.d != null).sort((a, b) => b.d! - a.d!);
  const worst = drops[0]?.d ? drops[0].i : -1;
  const dropWords = (x: { i: number; d: number | null }) => `${funnel[x.i - 1].name} → ${funnel[x.i].name} (${pct(x.d!)} lost)`;
  const funnelTake = !leads
    ? "No leads in this period yet."
    : worst < 0
      ? "Every lead is still in its first stage or went all the way."
      : `Biggest drop: ${dropWords(drops[0])}.` + (drops[1]?.d ? ` Next: ${dropWords(drops[1])}.` : "");
  const headline = worst < 0 ? funnelTake : `${funnel[worst].name} is the leak: ${pct(drops[0].d!)} of leads that reach ${funnel[worst - 1].name} go no further.`;
  return { funnel, worst, funnelTake, headline };
}

export function buildReport(cur: RawReport, prev: RawReport, stuckAfter: Record<string, number>) {
  const rates = cur.leads >= MIN_LEADS;
  const prevRates = prev.leads >= MIN_LEADS;
  const lastPeriod = (x: number | null) => (prevRates && x != null ? `last period ${pct(x)}` : "last period: too few leads");

  const f = buildFunnel(cur.stages, cur.leads);
  const { worst, funnelTake, headline } = f;
  const funnel = f.funnel.map((s) => ({ ...s, prevReached: prev.stages.find((x) => x.id === s.id)?.reached ?? 0 }));

  const booked = cur.stages[1];
  const open = cur.leads - cur.admitted - cur.lost - cur.dormant;
  const stuck = cur.stages.reduce((n, s) => n + s.open_days.filter((d) => isStuck(d, stuckAfter[s.id])).length, 0);
  const stats = [
    { label: "Admitted", value: String(cur.admitted), yard: `${rates ? `${pct(cur.admitted / cur.leads)} of leads · ` : ""}${lastPeriod(share(prev.admitted, prev.leads))}` },
    {
      label: `Reached ${booked?.name ?? "stage 2"}`,
      value: rates && booked ? pct(booked.reached / cur.leads) : "—",
      yard: lastPeriod(prev.stages[1] ? share(prev.stages[1].reached, prev.leads) : null),
    },
    {
      label: "Days to admit",
      value: cur.days_to_admit == null ? "—" : String(Math.round(cur.days_to_admit)),
      yard: `median · last period ${prev.days_to_admit == null ? "—" : Math.round(prev.days_to_admit)}`,
    },
    { label: "Still open", value: String(open), yard: `${stuck} stuck`, alert: stuck > 0 },
  ];

  const sources = cur.sources
    .map((s) => {
      const before = prev.sources.find((x) => x.label === s.label);
      const prevRate = prevRates && before ? before.admitted / before.leads : null;
      return { label: s.label ?? "No source", leads: s.leads, admitted: s.admitted, rate: s.admitted / s.leads, prevRate };
    })
    .sort((a, b) => b.rate - a.rate || b.leads - a.leads);
  const [best, low] = [sources[0], sources.at(-1)];
  const sourceTake = !rates
    ? "Too few leads to compare sources: counts only."
    : sources.length < 2 || !best.rate
      ? "No source has an admission yet."
      : low!.rate
        ? `${best.label} converts ${(best.rate / low!.rate).toFixed(1)}× better than ${low!.label}.`
        : `${best.label} converts best (${pct(best.rate)}); ${low!.label} has no admission yet.`;

  const days = cur.stages.slice(0, -1).map((s) => {
    const median = s.median_days == null ? null : Math.round(s.median_days);
    const limit = stuckAfter[s.id] ?? null;
    return { id: s.id, name: s.name, median, limit, over: isStuck(median, limit ?? undefined) };
  });
  const over = days.filter((d) => d.over);
  const slowest = [...days].filter((d) => d.median != null).sort((a, b) => b.median! - a.median!)[0];
  const daysTake = over.length
    ? `${over.map((d) => d.name).join(", ")} ${over.length === 1 ? "runs" : "run"} over the stuck limit.`
    : slowest
      ? `All stages within their stuck limit; ${slowest.name} is the slowest (${slowest.median} days).`
      : "No stage has a finished stay yet.";

  const lostTotal = cur.lost_reasons.reduce((n, r) => n + r.n, 0);
  const reasons = cur.lost_reasons.map((r) => ({ ...r, share: r.n / lostTotal }));
  const lostTake = reasons.length ? `${reasons[0].label} is ${pct(reasons[0].share)} of all lost reasons.` : "No lead was lost in this period.";

  const leadsStat = { label: "Leads", value: String(cur.leads), yard: `last period ${prev.leads}${change(cur.leads, prev.leads)}` };

  return { rates, headline, leadsStat, stats, funnel, worst, funnelTake, sources, sourceTake, days, daysTake, reasons, lostTake };
}

/** A lead as the grade, campus and trend sections read it (any lead created or admitted in the period). */
export interface LeadRow {
  created_at: string;
  admitted_at: string | null;
  imported_at: string | null;
  grade: string | null;
  campus_id: string | null;
}

export interface Group {
  label: string;
  leads: number;
  admitted: number;
  rate: number;
}

/** Leads and admitted per label, most leads first; under MIN_LEADS the takeaway names admissions instead of rates. */
export function groupLeads(cohort: LeadRow[], labelOf: (r: LeadRow) => string, rates: boolean) {
  const by = new Map<string, Group>();
  for (const r of cohort) {
    const label = labelOf(r);
    const g = by.get(label) ?? { label, leads: 0, admitted: 0, rate: 0 };
    g.leads++;
    if (r.admitted_at) g.admitted++;
    by.set(label, g);
  }
  const groups = [...by.values()]
    .map((g) => ({ ...g, rate: g.admitted / g.leads }))
    .sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label));
  const best = [...groups].filter((g) => g.admitted).sort((a, b) => b.rate - a.rate || b.leads - a.leads)[0];
  const top = groups[0];
  const take = !top
    ? "No leads in this period yet."
    : `Most leads: ${top.label} (${top.leads} of ${cohort.length}).` +
      (!best
        ? " No admission yet."
        : rates
          ? ` Best conversion: ${best.label} (${pct(best.rate)}).`
          : ` Admitted: ${groups.filter((g) => g.admitted).map((g) => `${g.label} ${g.admitted}`).join(", ")}.`);
  return { groups, best: best?.label ?? null, take };
}

const DAY = 86_400_000;

/** Grades, campuses and the trend for a period. Imported leads count in grades and campuses (they are leads of the
 *  period, as in the funnel) but not in the trend: their dates are the import's, not the family's (ADR 0036). */
export function buildBreakdowns(rows: LeadRow[], campuses: { id: string; label: string }[], p: Period, from: Date, to: Date) {
  const at = (iso: string | null) => (iso == null ? NaN : Date.parse(iso));
  const within = (iso: string | null, a: Date, b: Date) => at(iso) >= a.getTime() && at(iso) < b.getTime();
  const cohort = rows.filter((r) => within(r.created_at, from, to));
  const rates = cohort.length >= MIN_LEADS;
  const campusName = new Map(campuses.map((c) => [c.id, c.label]));
  const grades = groupLeads(cohort, (r) => r.grade?.trim() || "No grade", rates);
  const byCampus = groupLeads(cohort, (r) => campusName.get(r.campus_id ?? "") ?? "No campus", rates);

  // Months for the year; otherwise 7-day weeks ending now (the first one may start before the period).
  const starts: Date[] = [];
  if (p === "year") for (let m = startOfMonth(from); m < to; m = addMonths(m, 1)) starts.push(m);
  else for (let w = Math.ceil((to.getTime() - from.getTime()) / (7 * DAY)); w > 0; w--) starts.push(subDays(to, w * 7));
  const live = rows.filter((r) => !r.imported_at);
  const count = (pick: (r: LeadRow) => string | null, a: Date, b: Date) =>
    live.filter((r) => within(pick(r), a < from ? from : a, b > to ? to : b)).length;
  const trend = starts.map((s, i) => {
    const end = starts[i + 1] ?? (p === "year" ? addMonths(s, 1) : addDays(s, 7));
    return {
      label: format(s < from ? from : s, p === "year" ? "MMM" : "d MMM"),
      enquiries: count((r) => r.created_at, s, end),
      admitted: count((r) => r.admitted_at, s, end),
    };
  });
  const busiest = [...trend].sort((a, b) => b.enquiries - a.enquiries)[0];
  const admittedIn = trend.reduce((n, t) => n + t.admitted, 0);
  const imported = cohort.filter((r) => r.imported_at).length;
  const trendTake = !busiest?.enquiries && !admittedIn
    ? "No new enquiry or admission in this period."
    : `Busiest ${p === "year" ? "month" : "week from"} ${busiest.label}: ${busiest.enquiries} new ${busiest.enquiries === 1 ? "enquiry" : "enquiries"}. ` +
      `${admittedIn} admitted in the period.`;
  return {
    grades,
    campuses: byCampus,
    trend,
    trendPeak: busiest?.enquiries ? trend.indexOf(busiest) : -1,
    trendTake,
    trendNote: imported ? `${imported} leads imported from the old sheet are left out: they have no real enquiry date.` : null,
  };
}
