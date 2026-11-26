// S-report (M7, #71, ADR 0027). The database counts (admissions_report, migration 116, from leads and stage history);
// this file only says what to notice: the takeaway line, the worst stage or source, and each number's yardstick,
// which is the same number for the period before.
import { startOfYear, subDays, subYears } from "date-fns";

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

export function buildReport(cur: RawReport, prev: RawReport, stuckAfter: Record<string, number>) {
  const rates = cur.leads >= MIN_LEADS;
  const prevRates = prev.leads >= MIN_LEADS;
  const lastPeriod = (x: number | null) => (prevRates && x != null ? `last period ${pct(x)}` : "last period: too few leads");

  const funnel = cur.stages.map((s, i) => {
    const before = cur.stages[i - 1];
    const prevReached = prev.stages.find((x) => x.id === s.id)?.reached ?? 0;
    return { ...s, prevReached, share: share(s.reached, cur.leads), lostFromPrev: before?.reached ? 1 - s.reached / before.reached : null };
  });
  const drops = funnel.map((s, i) => ({ i, d: s.lostFromPrev })).filter((x) => x.d != null).sort((a, b) => b.d! - a.d!);
  const worst = drops[0]?.d ? drops[0].i : -1;
  const dropWords = (x: { i: number; d: number | null }) => `${funnel[x.i - 1].name} → ${funnel[x.i].name} (${pct(x.d!)} lost)`;
  const funnelTake = !cur.leads
    ? "No leads in this period yet."
    : worst < 0
      ? "Every lead is still in its first stage or went all the way."
      : `Biggest drop: ${dropWords(drops[0])}.` + (drops[1]?.d ? ` Next: ${dropWords(drops[1])}.` : "");
  const headline = worst < 0 ? funnelTake : `${funnel[worst].name} is the leak: ${pct(drops[0].d!)} of leads that reach ${funnel[worst - 1].name} go no further.`;

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

  return { rates, headline, stats, funnel, worst, funnelTake, sources, sourceTake, days, daysTake, reasons, lostTake };
}
