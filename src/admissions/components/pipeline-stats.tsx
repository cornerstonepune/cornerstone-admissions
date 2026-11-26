"use client";

// The numbers above the Admissions board (ADR 0038), in place of upstream's deal values: each with a yardstick to read
// it against, and one line saying what to look at first.
import type { PipelineStats as Stats } from "@/admissions/lib/pipeline";

const vs = (now: number, before: number, period: string) =>
  now === before ? `same as ${period}` : `${now > before ? "up" : "down"} from ${before} ${period}`;

function Tile({ label, value, yardstick, alert }: { label: string; value: number; yardstick: string; alert?: boolean }) {
  return (
    <div
      data-alert={alert ? "" : undefined}
      className={`grid content-start gap-0.5 rounded-[var(--radius-card)] border p-3 ${
        alert ? "border-[var(--state-wait)] bg-[var(--state-wait-bg)]" : "border-border bg-card"
      }`}
    >
      <span className="text-eyebrow font-semibold uppercase text-muted-foreground">{label}</span>
      <b className="text-title-section tabular-nums">{value}</b>
      <span className="text-caption text-muted-foreground">{yardstick}</span>
    </div>
  );
}

export function PipelineStats({ stats: s, visits }: { stats: Stats; visits: { booked: number; nextWeek: number } }) {
  const takeaway = s.stuck
    ? `${s.stuck} ${s.stuck === 1 ? "lead is" : "leads are"} stuck: open the amber cards first.`
    : s.open
      ? "Nothing is stuck."
      : "No open leads yet.";
  return (
    <section aria-label="Admissions numbers" data-block="PipelineStats" className="grid gap-2">
      <p className="m-0 text-label font-semibold">{takeaway}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Stuck" value={s.stuck} yardstick={`of ${s.open} open`} alert={s.stuck > 0} />
        <Tile label="Open leads" value={s.open} yardstick="not admitted, lost or dormant" />
        <Tile label="New · 7 days" value={s.newThisWeek} yardstick={vs(s.newThisWeek, s.newLastWeek, "the week before")} />
        <Tile label="Visits booked" value={visits.booked} yardstick={`${visits.nextWeek} in the next 7 days`} />
        <Tile
          label="Admitted this month"
          value={s.admittedThisMonth}
          yardstick={`${s.admittedLastMonth} in all of last month`}
        />
        <Tile label="Lost this month" value={s.lostThisMonth} yardstick={`${s.lostLastMonth} in all of last month`} />
      </div>
    </section>
  );
}
