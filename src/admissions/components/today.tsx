"use client";

// S-today (#69): Lakshmi ma'am's day on one screen — who to call (untouched first, then calls due, worst first), who is
// visiting, who is stuck, and the calls logged today. Choosing a family opens the lead panel (S-lead). Ports the
// platform's AttentionStrip and EmptyState only as far as this screen uses them.
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LeadPanel } from "./lead-panel";
import { PageHead } from "./page-head";
import { StatusChip, Timeline, type Tone } from "./parts";
import type { CallRow, Today } from "@/admissions/lib/today";

const time = (iso: string) => format(new Date(iso), "HH:mm");
const when = (iso: string | null) => (iso ? format(new Date(iso), "d MMM, HH:mm") : "—");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const CARD = "rounded-[var(--radius-card)] bg-[var(--panel)] shadow-[var(--shadow-card)]";

function why(c: CallRow): { tone: Tone; words: string } {
  if (c.why === "untouched") return { tone: "late", words: `Untouched ${c.hours} h` };
  if (c.why === "overdue") return { tone: "late", words: `Overdue since ${when(c.dueAt!)}` };
  return { tone: "wait", words: `Due ${time(c.dueAt!)}` };
}

/** AttentionStrip: one card per count, its tone, and the yardstick it is measured against. */
function Strip({ cards }: { cards: { n: number; tone: Tone; words: string; caption: string }[] }) {
  return (
    <div data-block="AttentionStrip" className="grid grid-cols-2 gap-[var(--space-3)] md:grid-cols-4">
      {cards.map((c) => (
        <div key={c.words} className={`${CARD} grid gap-[var(--space-1)] p-[var(--space-card)]`}>
          <span className="text-title-page font-semibold tabular-nums">{c.n}</span>
          <StatusChip tone={c.n ? c.tone : "quiet"}>{c.words}</StatusChip>
          <span className="text-caption text-[var(--ink-muted)]">{c.caption}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="grid min-w-0 content-start gap-[var(--space-2)]">
      <header className="flex flex-wrap items-baseline gap-[var(--space-2)]">
        <h2 className="text-title-section font-semibold">{title}</h2>
        <p className="text-label text-[var(--ink-muted)]">{note}</p>
      </header>
      {children}
    </section>
  );
}

function Family({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="text-start font-semibold text-[var(--link)] underline-offset-2 hover:underline">
      {name}
    </button>
  );
}

const TH = "px-[var(--space-2)] py-[var(--space-1)] text-start font-semibold text-[var(--ink-muted)] whitespace-nowrap";
const TD = "px-[var(--space-2)] py-[var(--space-2)] align-middle";

function takeaway(t: Today): string {
  const first = t.calls[0];
  if (!first) return "No calls left today.";
  if (t.counts.untouched) {
    return `${plural(t.counts.untouched, "family has", "families have")} waited over ${t.untouchedHours} h with no action. Start with ${first.family}: ${first.reason.toLowerCase()}.`;
  }
  return `Start with ${first.family}: ${first.reason}.`;
}

export function TodayScreen() {
  const [data, setData] = useState<Today | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const res = await fetch("/api/admissions/today").catch(() => null);
    if (!res?.ok) return setFailed(true);
    setData(await res.json());
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first fetch on mount; state is set after it resolves
    void load();
  }, [load]);

  const c = data?.counts;
  return (
    <div className="grid content-start gap-[var(--space-4)] p-[var(--space-4)]">
      <PageHead
        eyebrow={`Calls · ${format(new Date(), "EEE d MMM")}${c ? ` · ${plural(c.untouched + c.due, "call")} · ${plural(c.visits, "visit")}` : ""}`}
        title="Today"
        purpose="Call the red ones first, then today's calls. Visits and stuck leads are below."
      />

      {failed ? (
        <div className={`${CARD} grid justify-items-start gap-[var(--space-2)] p-[var(--space-card)]`}>
          <StatusChip tone="late">Couldn&apos;t load today&apos;s list</StatusChip>
          <p>Check the connection.</p>
          <Button variant="outline" onClick={load}>
            Try again
          </Button>
        </div>
      ) : !data || !c ? (
        <div aria-busy className="grid gap-[var(--space-2)]">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="block h-[var(--space-4)] rounded-[var(--radius-small)] bg-[var(--surface)]" />
          ))}
        </div>
      ) : (
        <>
          <Strip
            cards={[
              {
                n: c.untouched,
                tone: "late",
                words: "Untouched",
                caption: data.untouchedHours ? `no action in ${data.untouchedHours} h (Settings › Alerts)` : "no untouched alert set",
              },
              { n: c.due, tone: "wait", words: "Calls due today", caption: `${c.fromRules} from rules · ${c.due - c.fromRules} by hand` },
              { n: c.visits, tone: "ok", words: "Visiting today", caption: "booked for today" },
              { n: c.stuck, tone: "wait", words: "Stuck", caption: "longer in stage than the limit" },
            ]}
          />

          <Section title="Call now" note={`${plural(data.calls.length, "call")} · worst first`}>
            <p className="rounded-[var(--radius-control)] bg-[var(--highlight)] px-[var(--space-2)] py-[var(--space-1)] text-label">
              {takeaway(data)}
            </p>
            {data.calls.length ? (
              <div className={`${CARD} overflow-x-auto`}>
                <table className="w-full border-collapse text-label">
                  <thead>
                    <tr className="border-b border-[var(--line)]">
                      <th className={TH}>Why it&apos;s here</th>
                      <th className={TH}>Family</th>
                      <th className={TH}>Stage</th>
                      <th className={TH}>Reason</th>
                      <th className={`${TH} text-end`}>Last contact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.calls.map((row) => {
                      const w = why(row);
                      return (
                        <tr key={row.key} data-state={w.tone} className={`border-b border-[var(--line)] ${open === row.leadId ? "bg-[var(--action-soft)]" : ""}`}>
                          <td className={TD}>
                            <StatusChip tone={w.tone}>{w.words}</StatusChip>
                          </td>
                          <td className={TD}>
                            <Family name={row.family} onOpen={() => setOpen(row.leadId)} />
                            <br />
                            <span className="text-caption text-[var(--ink-muted)]">{row.parent}</span>
                          </td>
                          <td className={TD}>{row.stage}</td>
                          <td className={TD}>{row.reason}</td>
                          <td className={`${TD} text-end tabular-nums`}>{when(row.lastContact)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div data-block="EmptyState" className={`${CARD} p-[var(--space-card)] text-[var(--ink-muted)]`}>
                No calls left today.
              </div>
            )}
          </Section>

          <div className="grid items-start gap-[var(--space-4)] md:grid-cols-2">
            <Section title="Visiting today" note={`${plural(data.visits.length, "visit")} · by time`}>
              {data.visits.length ? (
                <ul className={`${CARD} m-0 grid list-none p-0`}>
                  {data.visits.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-[var(--space-2)] border-b border-[var(--line)] p-[var(--space-2)] text-label">
                      <span className="font-semibold tabular-nums">{time(v.starts_at)}</span>
                      {v.campus ? (
                        <span className="rounded-full bg-[var(--kind-period-bg)] px-[var(--space-2)] font-semibold text-[var(--kind-period)]">
                          {v.campus.label}
                        </span>
                      ) : null}
                      <Family name={`${v.lead?.child_name || "Child"}${v.lead?.grade ? ` (${v.lead.grade})` : ""}`} onOpen={() => setOpen(v.lead_id)} />
                      <StatusChip tone={v.status === "no_show" ? "late" : "ok"}>
                        {v.status === "visited" ? "Visited" : v.status === "no_show" ? "No-show" : "Booked"}
                      </StatusChip>
                    </li>
                  ))}
                </ul>
              ) : (
                <div data-block="EmptyState" className={`${CARD} p-[var(--space-card)] text-[var(--ink-muted)]`}>
                  No visits today.
                </div>
              )}
              <p className="text-caption text-[var(--ink-muted)]">After a visit: open the lead and mark it Visited, or No-show.</p>
            </Section>

            <Section title="Stuck" note={`${plural(data.stuck.length, "lead")} · longest over limit first`}>
              {data.stuck.length ? (
                <div className={`${CARD} overflow-x-auto`}>
                  <table className="w-full border-collapse text-label">
                    <thead>
                      <tr className="border-b border-[var(--line)]">
                        <th className={TH}>Family</th>
                        <th className={TH}>Stage</th>
                        <th className={`${TH} text-end`}>Days in stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.stuck.map((s) => (
                        <tr key={s.leadId} className="border-b border-[var(--line)]">
                          <td className={TD}>
                            <Family name={s.family} onOpen={() => setOpen(s.leadId)} />
                          </td>
                          <td className={TD}>{s.stage}</td>
                          <td className={`${TD} text-end tabular-nums`}>
                            {s.days} d <span className="text-caption text-[var(--ink-muted)]">limit {s.limit}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div data-block="EmptyState" className={`${CARD} p-[var(--space-card)] text-[var(--ink-muted)]`}>
                  Nobody is stuck.
                </div>
              )}
            </Section>
          </div>

          <Section title="Done today" note={plural(data.done.length, "call") + " logged"}>
            {data.done.length ? (
              <div className={`${CARD} px-[var(--space-card)]`}>
                <Timeline
                  entries={data.done.map((d) => ({
                    key: d.id,
                    kind: "note",
                    icon: Phone,
                    title: `${d.family} · ${d.outcome ?? "Called"}`,
                    line: d.notes ?? undefined,
                    when: time(d.doneAt),
                  }))}
                />
              </div>
            ) : (
              <p className="text-label text-[var(--ink-muted)]">No calls logged yet today.</p>
            )}
          </Section>
        </>
      )}

      <LeadPanel leadId={open} onOpenChange={(o) => !o && setOpen(null)} onChanged={load} />
    </div>
  );
}
