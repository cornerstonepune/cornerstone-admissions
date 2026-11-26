"use client";

// Calendar (ADR 0040): every meeting with a family on one month: campus visits, video calls and phone calls, whether
// Cal.com booked them (the website, a staff link) or staff set them while logging a call. A month grid from tablet
// width, a day-by-day list on a phone. Choosing a meeting opens the lead panel, as on Today.
import { useCallback, useEffect, useMemo, useState } from "react";
import { addMonths, format, parseISO } from "date-fns";

import { Button } from "@/components/ui/button";
import { MEETING_KINDS, type MeetingKind } from "@/admissions/lib/meetings";
import { dayKey, familyOf, monthGrid, takeaway, timeOf, type Meeting } from "@/admissions/lib/calendar";
import { Icon } from "./icons";
import { LeadPanel } from "./lead-panel";
import { PageHead } from "./page-head";
import { StatusChip } from "./parts";

const CARD = "rounded-[var(--radius-card)] bg-[var(--panel)] shadow-[var(--shadow-card)]";
const KIND_LOOK: Record<MeetingKind, string> = {
  campus: "bg-[var(--kind-activity-bg)] text-[var(--kind-activity)]",
  virtual: "bg-[var(--kind-objective-bg)] text-[var(--kind-objective)]",
  phone: "bg-[var(--kind-note-bg)] text-[var(--kind-note)]",
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Mark({ m }: { m: Meeting }) {
  if (m.status === "visited") return <StatusChip tone="ok">Visited</StatusChip>;
  if (m.status === "no_show") return <StatusChip tone="late">No-show</StatusChip>;
  return null;
}

/** One meeting as a button: its kind's icon and colour, the time, the family. */
function Item({ m, onOpen, roomy }: { m: Meeting; onOpen: () => void; roomy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${familyOf(m)} · ${MEETING_KINDS[m.kind]}${m.campus ? ` · ${m.campus.label}` : ""}`}
      className={`flex w-full min-w-0 flex-wrap items-center gap-x-[var(--space-1)] rounded-[var(--radius-small)] px-[var(--space-1)] py-0.5 text-start text-caption ${KIND_LOOK[m.kind]} ${m.status !== "booked" ? "opacity-70" : ""}`}
    >
      <Icon name={m.kind} size={14} className="flex-none" />
      <span className="flex-none tabular-nums">{timeOf(m.starts_at)}</span>
      {/* in a narrow day cell the family wraps to its own line rather than vanish */}
      <span className={`min-w-0 truncate font-semibold ${roomy ? "" : "basis-full"}`}>{familyOf(m)}</span>
      {roomy ? (
        <span className="ms-auto flex flex-none items-center gap-[var(--space-1)]">
          <span>{MEETING_KINDS[m.kind]}</span>
          <Mark m={m} />
        </span>
      ) : null}
    </button>
  );
}

export function CalendarScreen() {
  const [month, setMonth] = useState(() => new Date());
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const grid = useMemo(() => monthGrid(month), [month]);

  const load = useCallback(async () => {
    setFailed(false);
    const res = await fetch(`/api/admissions/calendar?from=${grid.from}&to=${grid.to}`).catch(() => null);
    if (!res?.ok) return setFailed(true);
    setMeetings(((await res.json()) as { meetings: Meeting[] }).meetings);
  }, [grid.from, grid.to]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount and on each month change
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const m of meetings ?? []) map.set(dayKey(m.starts_at), [...(map.get(dayKey(m.starts_at)) ?? []), m]);
    return map;
  }, [meetings]);

  const monthKey = format(month, "yyyy-MM");
  const inMonth = (meetings ?? []).filter((m) => dayKey(m.starts_at).startsWith(monthKey));
  const today = dayKey(new Date().toISOString());
  const counts = (Object.keys(MEETING_KINDS) as MeetingKind[]).map((k) => [k, inMonth.filter((m) => m.kind === k).length] as const);

  return (
    <div className="grid content-start gap-[var(--space-4)] p-[var(--space-4)]">
      <PageHead
        eyebrow={`Meetings · ${format(month, "MMMM yyyy")}${meetings ? ` · ${inMonth.length} ${inMonth.length === 1 ? "meeting" : "meetings"}` : ""}`}
        title="Calendar"
        purpose="Every campus visit, video call and phone call with a family: from Cal.com and from calls staff log."
      />

      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Button variant="outline" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month">
          <Icon name="previous" />
        </Button>
        <Button variant="outline" onClick={() => setMonth(new Date())}>
          This month
        </Button>
        <Button variant="outline" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month">
          <Icon name="next" />
        </Button>
        <h2 className="text-title-section font-semibold">{format(month, "MMMM yyyy")}</h2>
        <ul className="m-0 ms-auto flex list-none flex-wrap gap-[var(--space-2)] p-0 text-caption">
          {counts.map(([k, n]) => (
            <li key={k} className={`flex items-center gap-[var(--space-1)] rounded-full px-[var(--space-2)] py-0.5 ${KIND_LOOK[k]}`}>
              <Icon name={k} size={14} />
              {MEETING_KINDS[k]}: <span className="font-semibold tabular-nums">{n}</span>
            </li>
          ))}
        </ul>
      </div>

      {failed ? (
        <div className={`${CARD} grid justify-items-start gap-[var(--space-2)] p-[var(--space-card)]`}>
          <StatusChip tone="late">Couldn&apos;t load the calendar</StatusChip>
          <p>Check the connection.</p>
          <Button variant="outline" onClick={load}>
            Try again
          </Button>
        </div>
      ) : !meetings ? (
        <div aria-busy className={`${CARD} h-[var(--space-4)]`} />
      ) : (
        <>
          <p className="text-lead">{takeaway(inMonth)}</p>

          {/* the month grid, from tablet width */}
          <div className={`${CARD} hidden overflow-hidden md:block`}>
            <div className="grid grid-cols-7 border-b border-[var(--line)]">
              {WEEKDAYS.map((d) => (
                <span key={d} className="px-[var(--space-2)] py-[var(--space-1)] text-eyebrow font-semibold uppercase text-[var(--ink-muted)]">
                  {d}
                </span>
              ))}
            </div>
            {grid.weeks.map((week) => (
              <div key={week[0]} className="grid grid-cols-7 border-b border-[var(--line)] last:border-b-0">
                {week.map((day) => {
                  const list = byDay.get(day) ?? [];
                  const other = !day.startsWith(monthKey);
                  return (
                    <div
                      key={day}
                      className={`grid min-h-24 min-w-0 content-start gap-[var(--space-1)] border-e border-[var(--line)] p-[var(--space-1)] last:border-e-0 ${other ? "bg-[var(--surface)]" : ""}`}
                    >
                      <span
                        className={`justify-self-start rounded-full px-[var(--space-1)] text-label tabular-nums ${day === today ? "bg-[var(--action)] font-semibold text-[var(--action-ink)]" : other ? "text-[var(--ink-muted)]" : ""}`}
                        aria-current={day === today ? "date" : undefined}
                      >
                        {parseISO(day).getDate()}
                      </span>
                      {list.map((m) => (
                        <Item key={m.id} m={m} onOpen={() => setOpen(m.lead_id)} />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* a day-by-day list on a phone */}
          <div className="grid gap-[var(--space-3)] md:hidden">
            {inMonth.length === 0 ? (
              <p className="text-[var(--ink-muted)]">No meetings this month.</p>
            ) : (
              [...new Set(inMonth.map((m) => dayKey(m.starts_at)))].map((day) => (
                <section key={day} className={`${CARD} grid gap-[var(--space-1)] p-[var(--space-card-tight)]`}>
                  <h3 className="text-label font-semibold">
                    {format(parseISO(day), "EEE d MMM")}
                    {day === today ? " · Today" : ""}
                  </h3>
                  {(byDay.get(day) ?? []).map((m) => (
                    <Item key={m.id} m={m} roomy onOpen={() => setOpen(m.lead_id)} />
                  ))}
                </section>
              ))
            )}
          </div>
        </>
      )}

      <LeadPanel leadId={open} onOpenChange={(o) => !o && setOpen(null)} onChanged={load} />
    </div>
  );
}
