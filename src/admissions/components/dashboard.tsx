"use client";

// The admissions dashboard (ADR 0037): what matters this week, in one line, then the numbers with their yardsticks, who
// needs attention (opens the lead panel), the coming visits, the funnel, the campus split, the enquiry trend and what each
// counsellor logged. Reads with the caller's own client, so RLS scopes every row; the WhatsApp overview sits below, closed.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import Link from "./link";
import { LeadPanel } from "./lead-panel";
import { PageHead } from "./page-head";
import { StatusChip } from "./parts";
import { Bars, CARD, Columns, Funnel, Section, Skeleton, Tiles } from "./charts";
import { buildDashboard, dashboardWindow, type Dashboard, type DashInput } from "@/admissions/lib/dashboard";
import { familyOf } from "@/admissions/lib/today";

const SHOWN = 8;
const GRID = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,calc(var(--space-7)*4)),1fr))] items-start gap-[var(--space-4)]";

export function AdmissionsDashboard({ inbox }: { inbox: ReactNode }) {
  const { accountId } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [showInbox, setShowInbox] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setFailed(false);
    const supabase = createClient();
    const now = new Date();
    const w = dashboardWindow(now);
    const iso = (d: Date) => d.toISOString();
    // shortcut: one request per list, so PostgREST's row cap (1000 by default) bounds each; page them past that.
    const [today, leads, visits, calls, moves, members, campuses, funnel] = await Promise.all([
      fetch("/api/admissions/today")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      supabase
        .from("leads")
        .select("created_at, imported_at, admitted_at, exited_at, campus_id")
        .eq("account_id", accountId)
        .or(`created_at.gte.${iso(w.trendFrom)},admitted_at.gte.${iso(w.lastMonth)},exited_at.gte.${iso(w.weekAgo)},and(exit.is.null,admitted_at.is.null)`),
      supabase
        .from("visits")
        .select("id, lead_id, starts_at, status, campus:admissions_settings(label), lead:leads(child_name, grade)")
        .eq("account_id", accountId)
        .gte("starts_at", iso(w.weekAgo))
        .lt("starts_at", iso(w.nextWeek)),
      supabase.from("lead_activity").select("assigned_to, done_at").eq("account_id", accountId).eq("kind", "call_task").gte("done_at", iso(w.twoWeeksAgo)),
      supabase.from("lead_stage_history").select("moved_by, entered_at").eq("account_id", accountId).not("moved_by", "is", null).gte("entered_at", iso(w.weekAgo)),
      supabase.from("profiles").select("user_id, full_name").eq("account_id", accountId),
      supabase.from("admissions_settings").select("id, label").eq("account_id", accountId).eq("kind", "campus"),
      supabase.rpc("admissions_report", { p_account_id: accountId, p_from: iso(w.funnelFrom), p_to: iso(now), p_campus_id: null }),
    ]);
    const queries = [leads, visits, calls, moves, members, campuses, funnel];
    if (!today || queries.some((q) => q.error)) {
      console.error("[dashboard] load failed:", queries.find((q) => q.error)?.error ?? "today list");
      return setFailed(true);
    }
    setData(
      buildDashboard(
        {
          today,
          leads: leads.data,
          visits: visits.data,
          calls: calls.data,
          moves: moves.data,
          members: members.data,
          campuses: campuses.data,
          funnel: funnel.data,
        } as unknown as DashInput,
        now,
      ),
    );
  }, [accountId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first fetch on mount; state is set after it resolves
    void load();
  }, [load]);

  return (
    <div className="grid min-w-0 gap-[var(--space-4)]">
      <PageHead
        eyebrow={`Admissions · ${format(new Date(), "EEE d MMM")}`}
        title="Dashboard"
        purpose={data?.takeaway ?? "This week in admissions: who needs a call, who is visiting, and how the funnel is moving."}
      />
      {failed ? (
        <div className={`${CARD} grid justify-items-start gap-[var(--space-2)] p-[var(--space-2)]`}>
          <StatusChip tone="late">Couldn&apos;t load the dashboard</StatusChip>
          <p>Check the connection.</p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : !data ? (
        <Skeleton />
      ) : (
        <Loaded d={data} onOpen={setOpen} />
      )}

      <section className="grid gap-[var(--space-2)]">
        <div>
          <Button variant="outline" aria-expanded={showInbox} onClick={() => setShowInbox((v) => !v)}>
            {showInbox ? "Hide WhatsApp inbox stats" : "Show WhatsApp inbox stats"}
          </Button>
        </div>
        {showInbox && inbox}
      </section>
      <LeadPanel leadId={open} onOpenChange={(o) => !o && setOpen(null)} onChanged={load} />
    </div>
  );
}

function Family({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="min-h-[var(--tap)] text-start font-semibold text-[var(--link)] underline-offset-2 hover:underline">
      {name}
    </button>
  );
}

function Loaded({ d, onOpen }: { d: Dashboard; onOpen: (leadId: string) => void }) {
  const more = d.attention.length - SHOWN;
  return (
    <>
      <Tiles stats={d.stats} />

      <div className={GRID}>
        <Section
          title="Needs attention"
          meta={`${d.attention.length} · waiting on a call first`}
          take={d.attention.length ? `${d.attention.length} to act on. The red ones are families waiting on us.` : "Nothing needs attention: no family waiting, nothing stuck."}
        >
          {d.attention.length > 0 && (
            <ul className={`${CARD} m-0 grid list-none gap-[var(--space-0)] p-[var(--space-2)]`}>
              {d.attention.slice(0, SHOWN).map((a) => (
                <li key={a.key} className="grid gap-[var(--space-0)] border-b border-[var(--line)] pb-[var(--space-1)] last:border-b-0">
                  <Family name={a.family} onOpen={() => onOpen(a.leadId)} />
                  <span>
                    <StatusChip tone={a.tone}>{a.words}</StatusChip>
                  </span>
                </li>
              ))}
              {more > 0 && (
                <li className="pt-[var(--space-1)] text-label">
                  <Link href="/today" className="text-[var(--link)]">
                    {more} more on Today
                  </Link>
                </li>
              )}
            </ul>
          )}
        </Section>

        <Section
          title="Visits, next 7 days"
          meta="booked, soonest first"
          take={d.upcoming.length ? `${d.upcoming.length} booked; the next is ${familyOf(d.upcoming[0].lead)}, ${format(new Date(d.upcoming[0].starts_at), "EEE d MMM, HH:mm")}.` : "No visit booked in the next 7 days."}
        >
          {d.upcoming.length > 0 && (
            <ul className={`${CARD} m-0 grid list-none gap-[var(--space-0)] p-[var(--space-2)]`}>
              {d.upcoming.slice(0, SHOWN).map((v) => (
                <li key={v.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-[var(--space-2)] border-b border-[var(--line)] pb-[var(--space-1)] last:border-b-0">
                  <span className="text-label tabular-nums text-[var(--ink-muted)]">{format(new Date(v.starts_at), "EEE d MMM, HH:mm")}</span>
                  <span className="min-w-0">
                    <Family name={familyOf(v.lead)} onOpen={() => onOpen(v.lead_id)} />
                    {v.campus && <span className="text-caption text-[var(--ink-muted)]"> · {v.campus.label}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Funnel" meta="leads of the last 90 days · bar = share of all leads" take={d.funnel.funnelTake}>
        <Funnel stages={d.funnel.funnel} worst={d.funnel.worst} leads={d.funnel.leads} rates={d.funnel.rates} />
        <Link href="/report" className="text-label text-[var(--link)]">
          Full report by period, source, grade and campus
        </Link>
      </Section>

      <div className={GRID}>
        <Section title="Enquiries per week" meta="last 12 weeks · new enquiries, not imported" take={d.trendTake}>
          <Columns
            label="New enquiries per week"
            peak={d.peak}
            cols={d.weeks.map((w) => ({ key: w.start.toISOString(), label: format(w.start, "d/M"), a: w.n }))}
            legend="Each column is a week, labelled by the day it starts; the busiest week is in teal, the last one is this week."
          />
        </Section>

        <Section title="Campus split" meta="this week · open now · this month" take={d.campusTake}>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,calc(var(--space-7)*2)),1fr))] gap-[var(--space-2)] p-0">
            {d.campuses.map((c) => (
              <li key={c.label} className={`${CARD} grid gap-[var(--space-1)] p-[var(--space-2)]`}>
                <h3 className="text-label font-semibold">{c.label}</h3>
                <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-[var(--space-2)] gap-y-[var(--space-0)] text-label">
                  <dt className="text-[var(--ink-muted)]">New, 7 days</dt>
                  <dd className="m-0 text-end tabular-nums">
                    {c.fresh} <span className="text-caption text-[var(--ink-muted)]">(was {c.before})</span>
                  </dd>
                  <dt className="text-[var(--ink-muted)]">Open leads</dt>
                  <dd className="m-0 text-end tabular-nums">{c.open}</dd>
                  <dt className="text-[var(--ink-muted)]">Visits, next 7 days</dt>
                  <dd className="m-0 text-end tabular-nums">{c.visits}</dd>
                  <dt className="text-[var(--ink-muted)]">Admitted this month</dt>
                  <dd className="m-0 text-end tabular-nums">{c.admitted}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Counsellors, last 7 days" meta="calls logged and stage moves · least first" take={d.teamTake}>
        <Bars
          empty="No members yet."
          rows={d.team.map((m) => ({
            key: m.id,
            label: m.name,
            n: m.calls + m.moves,
            value: `${m.calls} ${m.calls === 1 ? "call" : "calls"} · ${m.moves} ${m.moves === 1 ? "move" : "moves"}`,
            mark: m.calls + m.moves ? undefined : { tone: "quiet" as const, words: "Nothing logged" },
          }))}
        />
      </Section>
    </>
  );
}
