// Ported from design/platform/components (markup and roles only, ADR 0003): StatusChip, KindTile, KeyValue, Stepper,
// Timeline — just what S-board and S-lead use. Styled with token utilities here because blocks.css isn't in src/ yet.
import type { ReactNode } from "react";
import { AlertTriangle, Check, Circle, Clock, type LucideIcon } from "lucide-react";

/** ok = green, wait = amber (stuck), late = red (untouched), quiet = grey (Lost, Dormant, not yet). Never colour alone. */
export type Tone = "ok" | "wait" | "late" | "quiet";

const TONE: Record<Tone, { cls: string; icon: LucideIcon }> = {
  ok: { cls: "text-[var(--state-ok)] bg-[var(--state-ok-bg)] border-[var(--state-ok)]", icon: Check },
  wait: { cls: "text-[var(--state-wait)] bg-[var(--state-wait-bg)] border-[var(--state-wait)]", icon: Clock },
  late: { cls: "text-[var(--state-late)] bg-[var(--state-late-bg)] border-[var(--state-late)]", icon: AlertTriangle },
  quiet: { cls: "text-[var(--state-quiet)] bg-[var(--state-quiet-bg)] border-[var(--state-quiet)]", icon: Circle },
};

/** A state: its icon, its words and its tone. */
export function StatusChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  const { cls, icon: Icon } = TONE[tone];
  return (
    <span
      data-block="StatusChip"
      data-state={tone}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-caption font-semibold ${cls}`}
    >
      <Icon aria-hidden className="size-3" />
      {children}
    </span>
  );
}

/** Kind colours (GLOSSARY, ADR 0014): a lead is `child`, a visit or campus `period`, a call `note`. */
export type Kind = "child" | "period" | "note";
const KIND: Record<Kind, string> = {
  child: "text-[var(--kind-child)] bg-[var(--kind-child-bg)]",
  period: "text-[var(--kind-period)] bg-[var(--kind-period-bg)]",
  note: "text-[var(--kind-note)] bg-[var(--kind-note-bg)]",
};

/** Category colours from the token palette (design/tokens.css), one per stage by its position (ADR 0038): no data
 * change needed, and a seventh stage wraps round. Admitted, the last of six, lands on green. */
const STAGE_COLOURS = ["--kind-assessment", "--kind-activity", "--kind-objective", "--kind-skill", "--kind-child", "--state-ok"];
export const stageColour = (position: number) => `var(${STAGE_COLOURS[position % STAGE_COLOURS.length]})`;

/** A campus's tag colour by its sort order, so Gurukul and Neev differ at a glance. */
const CAMPUS_TONES = ["child", "objective", "assessment", "note"];
export const campusTone = (sortOrder: number) => {
  const k = CAMPUS_TONES[Math.abs(sortOrder) % CAMPUS_TONES.length];
  return { color: `var(--kind-${k})`, background: `var(--kind-${k}-bg)` };
};

/** A small fact on a card (grade, campus): quiet grey unless given a tone. */
export function Tag({ tone, children }: { tone?: { color: string; background: string }; children: ReactNode }) {
  return (
    <span
      data-block="Tag"
      style={tone}
      className="inline-block max-w-full truncate rounded-full bg-[var(--state-quiet-bg)] px-2 py-0.5 text-caption font-semibold text-[var(--state-quiet)]"
    >
      {children}
    </span>
  );
}

export function KindTile({ kind, icon: Icon }: { kind: Kind; icon: LucideIcon }) {
  return (
    <span
      data-block="KindTile"
      data-kind={kind}
      className={`grid size-8 flex-none place-items-center rounded-[var(--radius-control)] ${KIND[kind]}`}
    >
      <Icon aria-hidden className="size-4" />
    </span>
  );
}

/** Facts as label: value pairs. */
export function KeyValue({ rows }: { rows: readonly { label: string; value: ReactNode }[] }) {
  return (
    <dl data-block="KeyValue" className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-label">
      {rows.flatMap((r) => [
        <dt key={`${r.label}-t`} className="text-muted-foreground">
          {r.label}
        </dt>,
        <dd key={`${r.label}-d`} className="m-0 min-w-0">
          {r.value ?? "—"}
        </dd>,
      ])}
    </dl>
  );
}

/** The stages of a lead: passed green, current amber, the rest grey. */
export function Stepper({
  steps,
  label,
}: {
  steps: readonly { tone: Tone; words: string; colour?: string }[];
  label: string;
}) {
  return (
    <ol data-block="Stepper" aria-label={label} className="m-0 flex list-none flex-wrap gap-2 p-0">
      {steps.map((s) => {
        const { cls, icon: Icon } = TONE[s.tone];
        return (
          <li
            key={s.words}
            data-state={s.tone}
            aria-current={s.tone === "wait" ? "step" : undefined}
            className={`flex items-center gap-1 rounded-full border px-2 py-1 text-label font-semibold ${cls}`}
          >
            {s.colour ? <span aria-hidden className="size-2 rounded-full" style={{ background: s.colour }} /> : null}
            <Icon aria-hidden className="size-3" />
            {s.words}
          </li>
        );
      })}
    </ol>
  );
}

export type Entry = { key: string; kind: Kind; icon: LucideIcon; title: string; line?: string; when: string };

/** What happened, newest first: a kind tile, the words, and when. */
export function Timeline({ entries }: { entries: readonly Entry[] }) {
  return (
    <ol data-block="Timeline" className="m-0 grid list-none p-0">
      {entries.map((e) => (
        <li key={e.key} className="grid grid-cols-[auto_1fr_auto] items-start gap-2 border-b border-border py-2 text-label">
          <KindTile kind={e.kind} icon={e.icon} />
          <div className="min-w-0">
            <b>{e.title}</b>
            {e.line ? <p className="m-0 mt-0.5 text-muted-foreground">{e.line}</p> : null}
          </div>
          <span className="text-caption text-muted-foreground">{e.when}</span>
        </li>
      ))}
    </ol>
  );
}
