"use client";

// S-report (M7, #71): where families drop out, which sources bring admissions, how long each stage takes and why leads
// are lost. Every section opens with what to notice; the worst stage or source is marked; numbers carry a yardstick.
// Numbers come from admissions_report (migration 116) through the caller's own client, so RLS scopes them.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { PageHead } from "@/admissions/components/page-head";
import { StatusChip } from "@/admissions/components/parts";
import { stuckAfterByStage, type AlertSetting } from "@/admissions/lib/pipeline";
import { buildReport, PERIODS, periodRange, type Period, type RawReport } from "@/admissions/lib/report";

type Built = ReturnType<typeof buildReport> & { leads: number; lost: number; dormant: number; from: Date; to: Date };
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
    const [cur, prev, settings] = await Promise.all([
      call(r.from, r.to),
      call(r.prevFrom, r.prevTo),
      supabase.from("admissions_settings").select("id, kind, key, label, value").eq("account_id", accountId).in("kind", ["alert", "campus"]),
    ]);
    if (cur.error || prev.error || settings.error) return setFailed(true);
    const rows = settings.data ?? [];
    const now = cur.data as RawReport;
    setCampuses(rows.filter((s) => s.kind === "campus"));
    const stuckAfter = stuckAfterByStage(now.stages, rows.filter((s) => s.kind === "alert") as AlertSetting[]);
    setData({ ...buildReport(now, prev.data as RawReport, stuckAfter), leads: now.leads, lost: now.lost, dormant: now.dormant, from: r.from, to: r.to });
  }, [accountId, period, campus]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount and on each filter change
    void load();
  }, [load]);

  return (
    <div className="grid gap-[var(--space-4)]">
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
        <p className="flex items-center gap-[var(--space-2)]">
          <StatusChip tone="late">Couldn&apos;t load the report</StatusChip>
          <Button variant="link" onClick={() => void load()}>
            Try again
          </Button>
        </p>
      )}
      {!data && !failed && <div aria-busy="true" className="h-[var(--space-7)] animate-pulse rounded-[var(--radius-card)] bg-[var(--panel)]" />}
      {data && <Loaded r={data} />}
    </div>
  );
}

const card = "rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)]";
const th = "px-[var(--space-2)] py-[var(--space-1)] text-start font-semibold whitespace-nowrap text-[var(--ink-muted)]";
const td = "border-t border-[var(--line)] px-[var(--space-2)] py-[var(--space-2)] align-middle";
const num = `${td} text-end tabular-nums`;
const Yard = ({ children }: { children: ReactNode }) => <span className="block text-caption text-[var(--ink-muted)]">{children}</span>;
const Bar = ({ of }: { of: number | null }) => (
  <span className="block h-[var(--space-2)] rounded-[var(--radius-small)] bg-[var(--kind-child)]" style={{ width: `${Math.round((of ?? 0) * 100)}%` }} />
);

function Section({ title, meta, take, children }: { title: string; meta: string; take: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 content-start gap-[var(--space-2)]">
      <header className="flex flex-wrap items-baseline gap-[var(--space-2)]">
        <h2 className="font-[family-name:var(--font-title-section)] text-title-section text-[var(--ink)]">{title}</h2>
        <p className="text-label text-[var(--ink-muted)]">{meta}</p>
      </header>
      <p className="rounded-[var(--radius-control)] bg-[var(--highlight)] px-[var(--space-2)] py-[var(--space-1)] text-label">{take}</p>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full border-collapse text-label">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={i ? `${th} text-end` : th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Loaded({ r }: { r: Built }) {
  const lowSource = r.rates && r.sources.length > 1 ? r.sources.length - 1 : -1;
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(calc(var(--space-7)*2),1fr))] gap-[var(--space-3)]">
        {r.stats.map((s) => (
          <div key={s.label} className={`${card} grid gap-[var(--space-0)] p-[var(--space-3)]`}>
            <span className="text-title-page font-semibold tabular-nums">{s.value}</span>
            <span className="text-label font-semibold">{s.label}</span>
            {s.alert ? <StatusChip tone="wait">{s.yard}</StatusChip> : <Yard>{s.yard}</Yard>}
          </div>
        ))}
      </div>
      {!r.rates && <p className="text-caption text-[var(--ink-muted)]">Fewer than 20 leads in this period: rates are hidden, counts still show.</p>}

      <Section title="Funnel" meta="leads that reached each stage" take={r.funnelTake}>
        <Table head={["Stage", "Reached", "Share of leads", "Lost from previous", "On the board now"]}>
          {r.funnel.map((s, i) => (
            <tr key={s.id} data-state={i === r.worst ? "late" : undefined}>
              <td className={td}>{s.name}</td>
              <td className={num}>
                {s.reached}
                <Yard>last period {s.prevReached}</Yard>
              </td>
              <td className={`${td} min-w-[calc(var(--space-7)*1.5)]`}>
                <Bar of={s.share} />
              </td>
              <td className={num}>{i === r.worst && r.rates ? <StatusChip tone="late">{pct(s.lostFromPrev)}</StatusChip> : r.rates ? pct(s.lostFromPrev) : "—"}</td>
              <td className={num}>{s.on_board}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(calc(var(--space-7)*3.5),1fr))] items-start gap-[var(--space-4)]">
        <Section title="By source" meta="admitted per 100 leads · best first" take={r.sourceTake}>
          <Table head={["Source", "Leads", "Admitted", "Rate"]}>
            {r.sources.map((s, i) => (
              <tr key={s.label}>
                <td className={td}>{s.label}</td>
                <td className={num}>{s.leads}</td>
                <td className={num}>{s.admitted}</td>
                <td className={num}>
                  {!r.rates ? "—" : i === lowSource ? <StatusChip tone="wait">{pct(s.rate)}</StatusChip> : pct(s.rate)}
                  {r.rates && <Yard>last period {pct(s.prevRate)}</Yard>}
                </td>
              </tr>
            ))}
          </Table>
        </Section>

        <Section title="Days per stage" meta="median · against the stuck limit" take={r.daysTake}>
          <Table head={["Stage", "Median days", "Stuck limit"]}>
            {r.days.map((d) => (
              <tr key={d.id}>
                <td className={td}>{d.name}</td>
                <td className={num}>{d.over ? <StatusChip tone="wait">{d.median}</StatusChip> : (d.median ?? "—")}</td>
                <td className={num}>{d.limit ?? "—"}</td>
              </tr>
            ))}
          </Table>
        </Section>

        <Section title="Why leads were lost" meta={`${r.lost} Lost · ${r.dormant} Dormant`} take={r.lostTake}>
          <ul className={`${card} m-0 grid list-none gap-[var(--space-0)] p-[var(--space-2)]`}>
            {r.reasons.map((x) => (
              <li key={x.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-[var(--space-2)] py-[var(--space-1)] text-label">
                {x.label}
                <Bar of={x.share} />
                <span className="tabular-nums">{x.n}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
