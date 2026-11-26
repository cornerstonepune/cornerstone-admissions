// The few charts S-report and the admissions dashboard need (ADR 0037), after the platform's StatTile, LevelBars and Spark
// (design/platform/components), drawn with token utilities. Every chart sits in a Section that opens with its takeaway;
// the stand-out row carries a StatusChip with words, never colour alone.
import type { ReactNode } from "react";

import { StatusChip, type Tone } from "./parts";

export const CARD = "rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)]";
const pct = (x: number) => `${Math.round(x * 100)}%`;
const width = (n: number, max: number) => ({ width: `${max > 0 ? Math.min(100, (n / max) * 100) : 0}%` });

/** A titled block: what it counts, then the one line to notice, then the chart. */
export function Section({ title, meta, take, children }: { title: string; meta: string; take: string; children: ReactNode }) {
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

/** StatTile: the number, what it counts, and its yardstick (amber or red when it needs a look). */
export function Tiles({ stats }: { stats: readonly { label: string; value: ReactNode; yard: string; tone?: Tone }[] }) {
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-[var(--space-2)] p-0 md:grid-cols-3 xl:grid-cols-6">
      {stats.map((s) => (
        <li key={s.label} className={`${CARD} grid content-start gap-[var(--space-0)] p-[var(--space-2)]`}>
          <span className="text-title-page font-semibold tabular-nums">{s.value}</span>
          <span className="text-label font-semibold">{s.label}</span>
          {s.tone && s.tone !== "ok" ? (
            <span>
              <StatusChip tone={s.tone}>{s.yard}</StatusChip>
            </span>
          ) : (
            <span className="text-caption text-[var(--ink-muted)]">{s.yard}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface BarRow {
  key: string;
  label: ReactNode;
  /** The bar's length against `max`; `inner` is drawn over it in green (admitted out of leads). */
  n: number;
  inner?: number;
  /** A marker on the track, e.g. the stuck limit. */
  limit?: number | null;
  value: ReactNode;
  note?: string;
  mark?: { tone: Tone; words: string };
}

/** LevelBars, sideways: one row per thing, its bar, its number; the stand-out row gets a chip. */
export function Bars({ rows, max, empty, legend }: { rows: readonly BarRow[]; max?: number; empty: string; legend?: ReactNode }) {
  if (!rows.length) return <p className={`${CARD} p-[var(--space-2)] text-label text-[var(--ink-muted)]`}>{empty}</p>;
  const top = max ?? Math.max(...rows.map((r) => Math.max(r.n, r.limit ?? 0)));
  return (
    <div className={`${CARD} grid gap-[var(--space-1)] p-[var(--space-2)]`}>
      {legend && <p className="text-caption text-[var(--ink-muted)]">{legend}</p>}
      <ul className="m-0 grid list-none gap-[var(--space-2)] p-0">
        {rows.map((r) => (
          <li key={r.key} className="grid gap-[var(--space-0)] text-label">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-[var(--space-2)]">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="relative block h-[var(--space-2)] rounded-[var(--radius-small)] bg-[var(--line)]">
                <span
                  className={`absolute inset-y-0 left-0 rounded-[var(--radius-small)] ${r.mark?.tone === "late" ? "bg-[var(--state-late)]" : r.inner === undefined ? "bg-[var(--kind-child)]" : "bg-[var(--kind-period)]"}`}
                  style={width(r.n, top)}
                />
                {r.inner !== undefined && (
                  <span className="absolute inset-y-0 left-0 rounded-[var(--radius-small)] bg-[var(--state-ok)]" style={width(r.inner, top)} />
                )}
                {r.limit != null && (
                  <span aria-hidden className="absolute -inset-y-1 border-l-2 border-[var(--ink)]" style={{ left: width(r.limit, top).width }} />
                )}
              </span>
              <span className="text-end tabular-nums">{r.value}</span>
            </div>
            {(r.mark || r.note) && (
              <div className="flex flex-wrap items-center gap-[var(--space-1)]">
                {r.mark && <StatusChip tone={r.mark.tone}>{r.mark.words}</StatusChip>}
                {r.note && <span className="text-caption text-[var(--ink-muted)]">{r.note}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The funnel: each stage's bar is its share of all leads; the note is how many of the stage before went on. */
export function Funnel({
  stages,
  worst,
  leads,
  rates,
}: {
  stages: readonly { id: string; name: string; reached: number; lostFromPrev: number | null; prevReached?: number }[];
  worst: number;
  leads: number;
  rates: boolean;
}) {
  return (
    <Bars
      empty="No leads in this period yet."
      max={leads}
      rows={stages.map((s, i) => ({
        key: s.id,
        label: s.name,
        n: s.reached,
        value: s.reached,
        note: [
          rates && s.lostFromPrev != null ? `${pct(1 - s.lostFromPrev)} of ${stages[i - 1].name} went on` : null,
          s.prevReached != null ? `last period ${s.prevReached}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        mark: i === worst && rates && s.lostFromPrev != null ? { tone: "late" as const, words: `Biggest drop: ${pct(s.lostFromPrev)} lost` } : undefined,
      }))}
    />
  );
}

/** Columns over time (weeks or months), oldest first; `b` is drawn beside `a` in green; the peak is labelled. */
export function Columns({
  cols,
  peak,
  label,
  legend,
}: {
  cols: readonly { key: string; label: string; a: number; b?: number }[];
  peak: number;
  label: string;
  legend: ReactNode;
}) {
  const max = Math.max(1, ...cols.flatMap((c) => [c.a, c.b ?? 0]));
  return (
    <figure className={`${CARD} m-0 grid gap-[var(--space-1)] p-[var(--space-2)]`}>
      <div role="img" aria-label={`${label}: ${cols.map((c) => `${c.label} ${c.a}${c.b != null ? ` and ${c.b}` : ""}`).join(", ")}`} className="grid grid-flow-col auto-cols-fr items-end gap-[var(--space-0)]">
        {cols.map((c, i) => (
          <div key={c.key} className="grid min-w-0 justify-items-center gap-[var(--space-0)]">
            <span className={`text-caption tabular-nums ${i === peak ? "font-semibold text-[var(--ink)]" : "text-[var(--ink-muted)]"}`}>{c.a}</span>
            <div className="flex h-[calc(var(--space-7)*1.25)] w-full items-end justify-center gap-px">
              <span className={`block w-full max-w-[var(--space-3)] rounded-t-[var(--radius-small)] ${i === peak ? "bg-[var(--kind-child)]" : "bg-[var(--kind-period)]"}`} style={{ height: `${(c.a / max) * 100}%` }} />
              {c.b != null && <span className="block w-full max-w-[var(--space-3)] rounded-t-[var(--radius-small)] bg-[var(--state-ok)]" style={{ height: `${(c.b / max) * 100}%` }} />}
            </div>
            <span className="w-full truncate text-center text-caption text-[var(--ink-muted)]">{c.label}</span>
          </div>
        ))}
      </div>
      <figcaption className="text-caption text-[var(--ink-muted)]">{legend}</figcaption>
    </figure>
  );
}

/** Loading: grey blocks where the tiles and sections will be. */
export function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid gap-[var(--space-3)]">
      <div className="grid grid-cols-2 gap-[var(--space-2)] md:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="block h-[var(--space-7)] animate-pulse rounded-[var(--radius-card)] bg-[var(--surface)]" />
        ))}
      </div>
      {[0, 1].map((i) => (
        <span key={i} className="block h-[calc(var(--space-7)*2)] animate-pulse rounded-[var(--radius-card)] bg-[var(--surface)]" />
      ))}
    </div>
  );
}
