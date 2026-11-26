"use client";

// S-report (M7, #71; charts ADR 0037): where families drop out, which sources bring admissions, which grades and campuses
// fill, how long each stage takes, why leads are lost, and the trend. Every section opens with what to notice; the worst
// stage or source is marked; headline numbers carry last period as their yardstick. Numbers come from admissions_report
// (migration 116) and the period's leads, through the caller's own client, so RLS scopes them.
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { PageHead } from "@/admissions/components/page-head";
import { StatusChip } from "@/admissions/components/parts";
import { Bars, CARD, Columns, Funnel, Section, Skeleton, Tiles } from "@/admissions/components/charts";
import { stuckAfterByStage, type AlertSetting } from "@/admissions/lib/pipeline";
import { buildBreakdowns, buildReport, PERIODS, periodRange, type Group, type LeadRow, type Period, type RawReport } from "@/admissions/lib/report";

type Built = ReturnType<typeof buildReport> &
  ReturnType<typeof buildBreakdowns> & { leads: number; lost: number; dormant: number; from: Date; to: Date; period: Period };
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export function ReportScreen() {
  const { accountId } = useAuth();
  const [period, setPeriod] = useState<Period>("year");
  const [campus, setCampus] = useState("");
  const [campuses, setCampuses] = useState<{ id: string; label: string }[]>([]);
  const [data, setData] = useState<Built | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setFailed(false);
    setData(null);
    const supabase = createClient();
    const r = periodRange(period);
    const call = (from: Date, to: Date) =>
      supabase.rpc("admissions_report", { p_account_id: accountId, p_from: from.toISOString(), p_to: to.toISOString(), p_campus_id: campus || null });
    const [from, to] = [r.from.toISOString(), r.to.toISOString()];
    // shortcut: one request, so PostgREST's row cap (1000 by default) bounds the leads of one period; page it past that.
    let rowsQuery = supabase
      .from("leads")
      .select("created_at, admitted_at, imported_at, grade, campus_id")
      .eq("account_id", accountId)
      .or(`and(created_at.gte.${from},created_at.lt.${to}),and(admitted_at.gte.${from},admitted_at.lt.${to})`);
    if (campus) rowsQuery = rowsQuery.eq("campus_id", campus);
    const [cur, prev, settings, rows] = await Promise.all([
      call(r.from, r.to),
      call(r.prevFrom, r.prevTo),
      supabase.from("admissions_settings").select("id, kind, key, label, value").eq("account_id", accountId).in("kind", ["alert", "campus"]),
      rowsQuery,
    ]);
    if (cur.error || prev.error || settings.error || rows.error) return setFailed(true);
    const all = settings.data ?? [];
    const now = cur.data as RawReport;
    const campusRows = all.filter((s) => s.kind === "campus");
    setCampuses(campusRows);
    const stuckAfter = stuckAfterByStage(now.stages, all.filter((s) => s.kind === "alert") as AlertSetting[]);
    setData({
      ...buildReport(now, prev.data as RawReport, stuckAfter),
      ...buildBreakdowns((rows.data ?? []) as LeadRow[], campusRows, period, r.from, r.to),
      leads: now.leads,
      lost: now.lost,
      dormant: now.dormant,
      from: r.from,
      to: r.to,
      period,
    });
  }, [accountId, period, campus]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount and on each filter change
    void load();
  }, [load]);

  return (
    <div className="grid min-w-0 gap-[var(--space-4)]">
      <p className="text-caption text-[var(--ink-muted)]">Report</p>
      <div className="flex flex-wrap items-end gap-[var(--space-3)]">
        <PageHead
          eyebrow={data ? `Leads · ${format(data.from, "d MMM")} – ${format(data.to, "d MMM yyyy")} · ${data.leads} leads` : "Leads"}
          title="Admissions report"
          purpose={data?.headline ?? "Where families drop out, which sources bring admissions, and why leads are lost."}
        />
        <span className="grow" />
        <div role="group" aria-label="Period" className="inline-flex overflow-hidden rounded-[var(--radius-control)] border border-[var(--line-control)]">
          {(Object.keys(PERIODS) as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === period}
              onClick={() => setPeriod(p)}
              className="min-h-[var(--tap)] px-[var(--space-2)] text-label text-[var(--ink-muted)] aria-pressed:bg-[var(--action-soft)] aria-pressed:font-semibold aria-pressed:text-[var(--action-soft-ink)]"
            >
              {PERIODS[p]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-[var(--space-1)] text-label text-[var(--ink-muted)]">
          Campus
          <select
            value={campus}
            onChange={(e) => setCampus(e.target.value)}
            className="min-h-[var(--tap)] rounded-[var(--radius-control)] border border-[var(--line-control)] bg-[var(--ground)] px-[var(--space-2)] text-[var(--ink)]"
          >
            <option value="">All</option>
            {campuses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {failed && (
        <div className={`${CARD} flex flex-wrap items-center gap-[var(--space-2)] p-[var(--space-2)]`}>
          <StatusChip tone="late">Couldn&apos;t load the report</StatusChip>
          <Button variant="link" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}
      {!data && !failed && <Skeleton />}
      {data && <Loaded r={data} />}
    </div>
  );
}

/** Leads per group with admitted drawn over them; the best converter is marked. */
function GroupBars({ g, rates, empty }: { g: { groups: Group[]; best: string | null }; rates: boolean; empty: string }) {
  return (
    <Bars
      empty={empty}
      legend="Grey: leads · green: admitted"
      rows={g.groups.map((x) => ({
        key: x.label,
        label: x.label,
        n: x.leads,
        inner: x.admitted,
        value: `${x.admitted}/${x.leads}`,
        note: rates ? `${pct(x.rate)} admitted` : undefined,
        mark: rates && x.label === g.best ? { tone: "ok" as const, words: "Best conversion" } : undefined,
      }))}
    />
  );
}

const GRID = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,calc(var(--space-7)*3.5)),1fr))] items-start gap-[var(--space-4)]";

function Loaded({ r }: { r: Built }) {
  const lowSource = r.rates && r.sources.length > 1 ? r.sources.length - 1 : -1;
  const lostTop = r.reasons[0]?.n ?? 0;
  return (
    <>
      <Tiles stats={[r.leadsStat, ...r.stats.map((s) => ({ ...s, tone: s.alert ? ("wait" as const) : undefined }))]} />
      {!r.rates && <p className="text-caption text-[var(--ink-muted)]">Fewer than 20 leads in this period: rates are hidden, counts still show.</p>}

      <Section title="Funnel" meta="leads that reached each stage · bar = share of all leads" take={r.funnelTake}>
        <Funnel stages={r.funnel} worst={r.worst} leads={r.leads} rates={r.rates} />
        <p className="text-caption text-[var(--ink-muted)]">
          On the board now: {r.funnel.map((s) => `${s.name} ${s.on_board}`).join(" · ")}
        </p>
      </Section>

      <Section
        title="Trend"
        meta={`new enquiries and admissions by ${r.period === "year" ? "month" : "week"}`}
        take={r.trendTake}
      >
        <Columns
          label="Enquiries and admissions"
          peak={r.trendPeak}
          cols={r.trend.map((t) => ({ key: t.label, label: t.label, a: t.enquiries, b: t.admitted }))}
          legend={`Grey: new enquiries (busiest in teal) · green: admitted${r.trendNote ? ` · ${r.trendNote}` : ""}`}
        />
      </Section>

      <div className={GRID}>
        <Section title="By source" meta="admitted per 100 leads · best first" take={r.sourceTake}>
          <Bars
            empty="No leads in this period yet."
            legend="Grey: leads · green: admitted"
            rows={r.sources.map((s, i) => ({
              key: s.label,
              label: s.label,
              n: s.leads,
              inner: s.admitted,
              value: `${s.admitted}/${s.leads}`,
              note: r.rates ? `${pct(s.rate)} admitted · last period ${pct(s.prevRate)}` : undefined,
              mark: !r.rates ? undefined : i === 0 && s.admitted ? { tone: "ok" as const, words: "Best" } : i === lowSource ? { tone: "wait" as const, words: "Lowest" } : undefined,
            }))}
          />
        </Section>

        <Section title="By grade" meta="leads and admitted · most leads first" take={r.grades.take}>
          <GroupBars g={r.grades} rates={r.rates} empty="No leads in this period yet." />
        </Section>

        <Section title="By campus" meta="leads and admitted" take={r.campuses.take}>
          <GroupBars g={r.campuses} rates={r.rates} empty="No leads in this period yet." />
        </Section>

        <Section title="Days per stage" meta="median days · line = stuck limit" take={r.daysTake}>
          <Bars
            empty="No stage yet."
            rows={r.days.map((d) => ({
              key: d.id,
              label: d.name,
              n: d.median ?? 0,
              limit: d.limit,
              value: d.median ?? "—",
              note: d.limit != null ? `stuck after ${d.limit} days` : "no stuck limit set",
              mark: d.over ? { tone: "wait" as const, words: "Over the limit" } : undefined,
            }))}
          />
        </Section>

        <Section title="Why leads were lost" meta={`${r.lost} Lost · ${r.dormant} Dormant · most first`} take={r.lostTake}>
          <Bars
            empty="No lead was lost in this period."
            max={lostTop}
            rows={r.reasons.map((x, i) => ({
              key: x.label,
              label: x.label,
              n: x.n,
              value: x.n,
              note: `${pct(x.share)} of lost`,
              mark: i === 0 && r.reasons.length > 1 ? { tone: "late" as const, words: "Top reason" } : undefined,
            }))}
          />
        </Section>
      </div>
    </>
  );
}
