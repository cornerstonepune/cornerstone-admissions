"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Baby, ChevronDown, Phone } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CALL_OUTCOMES } from "@/admissions/lib/pipeline";
import { KeyValue, KindTile, StatusChip, Stepper, Timeline, type Tone } from "./parts";

type Label = { label: string } | null;
interface LeadDetail {
  lead: {
    id: string;
    child_name: string | null;
    child_dob: string | null;
    grade: string | null;
    area: string | null;
    exit: "lost" | "dormant" | null;
    admitted_at: string | null;
    created_at: string;
    days_in_stage: number | null;
    campus: Label;
    source: Label;
    lost_reason: Label;
    deal: {
      stage_id: string;
      notes: string | null;
      conversation_id: string | null;
      contact: { name: string | null; phone: string } | null;
    };
  };
  stages: { id: string; name: string; position: number }[];
  history: { id: string; stage_id: string; entered_at: string; moved_by_name: string | null }[];
  activity: {
    id: string;
    kind: "follow_up_send" | "call_task";
    due_at: string;
    done_at: string | null;
    outcome: string | null;
    notes: string | null;
    by_name: string | null;
  }[];
  visit: { starts_at: string; status: string } | null;
  lostReasons: { id: string; label: string }[];
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const fullDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000));

function age(dob: string): string {
  const b = new Date(dob);
  const now = new Date();
  let months = (now.getFullYear() - b.getFullYear()) * 12 + now.getMonth() - b.getMonth();
  if (now.getDate() < b.getDate()) months -= 1;
  return `${Math.floor(months / 12)} y ${months % 12} m`;
}

const field =
  "min-h-11 w-full rounded-[var(--radius-control)] border border-input bg-background px-2 text-label text-foreground";

/** "Move to Lost": a lost reason is required; without one the form shows why and sends nothing (G3.3). */
export function LostForm({
  reasons,
  busy,
  onSubmit,
  onCancel,
}: {
  reasons: readonly { id: string; label: string }[];
  busy?: boolean;
  onSubmit: (reasonId: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  return (
    <form
      data-block="LostForm"
      noValidate
      className="grid gap-2 rounded-[var(--radius-card)] border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason) return setMissing(true);
        onSubmit(reason);
      }}
    >
      <label htmlFor="lost-reason" className="text-label font-semibold">
        Why was this lead lost? (required)
      </label>
      <select
        id="lost-reason"
        name="lost_reason_id"
        required
        aria-invalid={missing || undefined}
        aria-describedby={missing ? "lost-reason-error" : undefined}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setMissing(false);
        }}
        className={field}
      >
        <option value="">Choose a reason</option>
        {reasons.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      {missing ? (
        <p id="lost-reason-error" role="alert" className="m-0 text-label text-destructive">
          Pick a reason to close this lead as Lost.
        </p>
      ) : null}
      {reasons.length === 0 ? (
        <p className="m-0 text-caption text-muted-foreground">No lost reasons yet: an admin adds them in Settings.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Close as Lost
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CallForm({ onSaved, leadId }: { leadId: string; onSaved: () => void }) {
  const [outcome, setOutcome] = useState<string>(CALL_OUTCOMES[0]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const res = await fetch(`/api/admissions/leads/${leadId}/calls`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome, notes }),
        });
        setBusy(false);
        if (!res.ok) return toast.error((await res.json().catch(() => null))?.error ?? "Couldn't save the call");
        setNotes("");
        onSaved();
      }}
    >
      <label htmlFor="call-outcome" className="text-label font-semibold">
        Outcome
      </label>
      <select id="call-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={field}>
        {CALL_OUTCOMES.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <label htmlFor="call-notes" className="text-label font-semibold">
        Notes
      </label>
      <textarea id="call-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={`${field} py-2`} />
      <Button type="submit" disabled={busy} className="justify-self-start">
        Save call
      </Button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="m-0 text-title-small font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** S-lead: the lead's right-side panel (a full-height sheet on a phone). */
export function LeadPanel({
  leadId,
  onOpenChange,
  onChanged,
}: {
  leadId: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<LeadDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [askLost, setAskLost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("card");

  const load = useCallback(async () => {
    if (!leadId) return;
    setFailed(false);
    const res = await fetch(`/api/admissions/leads/${leadId}`);
    if (!res.ok) return setFailed(true);
    setData(await res.json());
  }, [leadId]);

  useEffect(() => {
    // A new lead starts on its Card tab, with no stale data or open Lost form.
    /* eslint-disable react-hooks/set-state-in-effect */
    setData(null);
    setAskLost(false);
    setTab("card");
    /* eslint-enable react-hooks/set-state-in-effect */
    load();
  }, [load]);

  async function patch(body: Record<string, string>) {
    setBusy(true);
    const res = await fetch(`/api/admissions/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error((await res.json().catch(() => null))?.error ?? "Couldn't save");
      return;
    }
    setAskLost(false);
    onChanged();
    load();
  }

  const lead = data?.lead;
  const stageIndex = data ? data.stages.findIndex((s) => s.id === lead?.deal.stage_id) : -1;
  const stage = data?.stages[stageIndex];
  const open = lead && !lead.exit && !lead.admitted_at;
  const state = lead?.exit === "lost" ? "Lost" : lead?.exit === "dormant" ? "Dormant" : stage?.name;
  const calls = data?.activity.filter((a) => a.kind === "call_task") ?? [];
  const sends = data?.activity.filter((a) => a.kind === "follow_up_send") ?? [];

  return (
    <Sheet open={!!leadId} onOpenChange={onOpenChange}>
      <SheetContent side="right" data-block="DetailPanel" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {!data ? (
          <div className="grid gap-3 p-4">
            <SheetTitle className="sr-only">Lead</SheetTitle>
            {failed ? (
              <p className="flex flex-wrap items-center gap-2">
                <StatusChip tone="late">Couldn&apos;t load this lead</StatusChip>
                <Button variant="link" onClick={load}>
                  Try again
                </Button>
              </p>
            ) : (
              <>
                <span className="block h-4 animate-pulse rounded-[var(--radius-small)] bg-muted" />
                <span className="block h-4 animate-pulse rounded-[var(--radius-small)] bg-muted" />
              </>
            )}
          </div>
        ) : (
          <div className="grid content-start gap-4 p-4">
            <header className="flex items-start gap-2 pr-8">
              <KindTile kind="child" icon={Baby} />
              <div className="grid min-w-0 gap-0.5">
                <span className="text-eyebrow font-semibold uppercase text-muted-foreground">
                  Lead · {state}
                  {open && lead.days_in_stage != null ? ` · ${lead.days_in_stage} days` : ""}
                </span>
                <SheetTitle className="text-title-section">{lead!.child_name ?? "Child not given yet"}</SheetTitle>
                <SheetDescription className="text-caption">
                  {[lead!.grade, lead!.campus?.label, lead!.source?.label].filter(Boolean).join(" · ") || "—"}
                </SheetDescription>
              </div>
            </header>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setTab("calls")}>
                <Phone className="mr-1 size-4" aria-hidden />
                Log a call
              </Button>
              {open ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={busy}
                    className="inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-control)] border border-input bg-background px-3 text-label font-semibold hover:bg-muted"
                  >
                    Move to… <ChevronDown className="size-4" aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {data.stages
                      .filter((s) => s.id !== stage?.id)
                      .map((s) => (
                        <DropdownMenuItem key={s.id} onClick={() => patch({ stage_id: s.id })}>
                          {s.name}
                        </DropdownMenuItem>
                      ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setAskLost(true)}>Lost…</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => patch({ exit: "dormant" })}>Dormant</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>

            {askLost ? (
              <LostForm
                reasons={data.lostReasons}
                busy={busy}
                onSubmit={(id) => patch({ exit: "lost", lost_reason_id: id })}
                onCancel={() => setAskLost(false)}
              />
            ) : null}

            <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
              <TabsList variant="line" className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="card">Card</TabsTrigger>
                <TabsTrigger value="calls">Calls ({calls.length})</TabsTrigger>
                <TabsTrigger value="chat">Chat</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>

              <TabsContent value="card" className="grid gap-4 pt-2">
                <Stepper
                  label="Stages"
                  steps={data.stages.map((s, i) => ({
                    words: s.name,
                    tone: (lead!.exit
                      ? "quiet"
                      : i < stageIndex || (i === stageIndex && lead!.admitted_at)
                        ? "ok"
                        : i === stageIndex
                          ? "wait"
                          : "quiet") as Tone,
                  }))}
                />
                {lead!.exit === "lost" ? (
                  <p className="m-0 text-label">
                    <StatusChip tone="quiet">Lost</StatusChip> {lead!.lost_reason?.label}
                  </p>
                ) : null}
                <Section title="Child">
                  <KeyValue
                    rows={[
                      { label: "Name", value: lead!.child_name },
                      {
                        label: "Date of birth",
                        value: lead!.child_dob ? `${fullDay(lead!.child_dob)} · ${age(lead!.child_dob)}` : null,
                      },
                      { label: "Grade", value: lead!.grade },
                      { label: "Campus", value: lead!.campus?.label },
                    ]}
                  />
                </Section>
                <Section title="Parent">
                  <KeyValue
                    rows={[
                      { label: "Name", value: lead!.deal.contact?.name },
                      {
                        label: "Phone",
                        value: lead!.deal.contact ? (
                          <a href={`tel:${lead!.deal.contact.phone}`} className="text-[var(--link)]">
                            {lead!.deal.contact.phone}
                          </a>
                        ) : null,
                      },
                      { label: "Area", value: lead!.area },
                      { label: "Source", value: lead!.source?.label },
                      { label: "First contact", value: fullDay(lead!.created_at) },
                    ]}
                  />
                </Section>
                <Section title="Visit">
                  {data.visit ? (
                    <p className="m-0 flex flex-wrap items-center gap-2 text-label">
                      <StatusChip tone={data.visit.status === "visited" ? "ok" : data.visit.status === "no_show" ? "late" : "wait"}>
                        {data.visit.status.replace("_", "-").replace(/^./, (c) => c.toUpperCase())}
                      </StatusChip>
                      {new Date(data.visit.starts_at).toLocaleString("en-IN", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  ) : (
                    <p className="m-0 text-caption text-muted-foreground">No visit booked.</p>
                  )}
                </Section>
                <Section title="Follow-ups">
                  {sends.length ? (
                    <ul className="m-0 grid list-none gap-1 p-0 text-label">
                      {sends.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center gap-2">
                          {a.done_at ? <StatusChip tone="ok">Sent</StatusChip> : <StatusChip tone="wait">Due</StatusChip>}
                          {day(a.done_at ?? a.due_at)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="m-0 text-caption text-muted-foreground">No follow-ups yet.</p>
                  )}
                </Section>
                {lead!.deal.notes ? (
                  <Section title="Notes">
                    <p className="m-0 whitespace-pre-wrap text-label">{lead!.deal.notes}</p>
                  </Section>
                ) : null}
              </TabsContent>

              <TabsContent value="calls" className="grid gap-4 pt-2">
                <CallForm leadId={lead!.id} onSaved={load} />
                {calls.length ? (
                  <Timeline
                    entries={calls.map((c) => ({
                      key: c.id,
                      kind: "note",
                      icon: Phone,
                      title: c.done_at ? (c.outcome ?? "Called") : "Call to make",
                      line: [c.by_name, c.notes].filter(Boolean).join(" · ") || undefined,
                      when: day(c.done_at ?? c.due_at),
                    }))}
                  />
                ) : (
                  <p className="m-0 text-caption text-muted-foreground">No calls yet.</p>
                )}
              </TabsContent>

              <TabsContent value="chat" className="grid gap-2 pt-2 text-label">
                <p className="m-0">The WhatsApp thread with this parent is in Inbox.</p>
                <Link
                  href={lead!.deal.conversation_id ? `/inbox?c=${lead!.deal.conversation_id}` : "/inbox"}
                  className="text-[var(--link)]"
                >
                  Open in Inbox
                </Link>
              </TabsContent>

              <TabsContent value="history" className="pt-2">
                <Timeline
                  entries={data.history.map((h, i) => ({
                    key: h.id,
                    kind: "child",
                    icon: ArrowRight,
                    title: data.stages.find((s) => s.id === h.stage_id)?.name ?? "Stage",
                    line: h.moved_by_name ? `by ${h.moved_by_name}` : undefined,
                    // newest first: the current stage's days come from the database; a past stage lasted until the next began
                    when: `${day(h.entered_at)} · ${i === 0 ? (lead!.days_in_stage ?? 0) : daysBetween(h.entered_at, data.history[i - 1].entered_at)} d`,
                  }))}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
