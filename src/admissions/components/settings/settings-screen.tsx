"use client";

// S-admissions-settings (#70): one page, eight tabs, and the change log of every settings change with who and when.
// Five tabs edit admissions_settings through /api/admissions/settings. Templates and People are upstream's own panels
// (ADR 0014 §6); stage names and the welcome flow's words live in Pipeline and Flows, linked from here (ADR 0025).
import { useCallback, useEffect, useState } from "react";
import { format, subDays } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MembersTab } from "@/components/settings/members-tab";
import { TemplateManager } from "@/components/settings/template-manager";
import { Icon } from "@/admissions/components/icons";
import Link from "@/admissions/components/link";
import { PageHead } from "@/admissions/components/page-head";
import { canEditSettings, type AccountRole } from "@/lib/auth/roles";
import { describeChange, KIND_TAB, STAGES, type Setting, type SettingKind, type SettingsChange } from "@/admissions/lib/settings";
import { AlertsTab, CampusesTab, NameList, RulesTab, Section, type Save } from "./kind-tabs";

interface Loaded {
  role: AccountRole;
  settings: Setting[];
  changes: SettingsChange[];
  names: Record<string, string>;
  templates: string[];
}

const TABS = {
  rules: "Follow-up rules",
  templates: "Templates",
  alerts: "Alerts",
  stages: "Stages",
  campuses: "Campuses",
  sources: "Sources",
  welcome: "Welcome flow",
  people: "People",
};
type Tab = keyof typeof TABS;

export function SettingsScreen() {
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("rules");

  const load = useCallback(async () => {
    setFailed(false);
    const res = await fetch("/api/admissions/settings").catch(() => null);
    if (!res?.ok) return setFailed(true);
    setData(await res.json());
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first fetch on mount; state is set after it resolves
    void load();
  }, [load]);

  const save: Save = async ({ id, ...body }) => {
    const res = await fetch(id ? `/api/admissions/settings/${id}` : "/api/admissions/settings", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { label: body.label, value: body.value, active: body.active } : body),
    }).catch(() => null);
    const json = await res?.json().catch(() => ({}));
    if (!res?.ok) return json?.error ?? "Couldn't save. Try again.";
    if (json.templateNotApproved) toast.warning("Template not approved yet: the rule stays off until Meta approves it.");
    else toast.success("Saved. Applies from the next run.");
    await load();
    return null;
  };

  const weekAgo = subDays(new Date(), 7).toISOString();
  const thisWeek = data?.changes.filter((c) => c.changed_at >= weekAgo).length ?? 0;

  return (
    <div className="grid gap-[var(--space-5)]">
      <p className="text-caption text-[var(--ink-muted)]">Admissions settings › {TABS[tab]}</p>
      <div className="flex flex-wrap items-start gap-[var(--space-3)]">
        <PageHead
          eyebrow={`Set up · ${thisWeek} ${thisWeek === 1 ? "change" : "changes"} this week`}
          title="Admissions settings"
          purpose="The rules behind every automatic message and call task. Changes apply from the next run, within a minute."
        />
        <span className="grow" />
        <Button variant="outline" render={<a href="#change-log" />}>
          Change log
        </Button>
      </div>
      {failed && (
        <p className="flex items-center gap-[var(--space-2)]">
          <span className="text-[var(--state-late)]">● Couldn&apos;t load settings</span>
          <Button variant="link" onClick={() => void load()}>
            Try again
          </Button>
        </p>
      )}
      {!data && !failed && <div aria-busy="true" className="h-[var(--space-7)] animate-pulse rounded-[var(--radius-card)] bg-[var(--panel)]" />}
      {data && <Loaded data={data} tab={tab} setTab={setTab} save={save} />}
    </div>
  );
}

function Loaded({ data, tab, setTab, save }: { data: Loaded; tab: Tab; setTab: (t: Tab) => void; save: Save }) {
  const canEdit = canEditSettings(data.role);
  const of = (kind: SettingKind) => data.settings.filter((s) => s.kind === kind);
  const props = (kind: SettingKind) => ({ rows: of(kind), canEdit, save });
  return (
    <>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList variant="line" className="flex-wrap">
          {Object.entries(TABS).map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="rules">
          <RulesTab {...props("follow_up_rule")} templates={data.templates} />
        </TabsContent>
        <TabsContent value="templates">
          <TemplateManager />
        </TabsContent>
        <TabsContent value="alerts">
          <AlertsTab {...props("alert")} />
        </TabsContent>
        <TabsContent value="stages" className="grid gap-[var(--space-5)]">
          <Section title="Stages" meta="names and order">
            <ol className="flex flex-wrap gap-[var(--space-2)]">
              {STAGES.map((s, i) => (
                <li key={s} className="rounded-[var(--radius-pill)] bg-[var(--panel)] px-[var(--space-3)] py-[var(--space-1)]">
                  {i + 1} · {s}
                </li>
              ))}
            </ol>
            <p className="text-caption text-[var(--ink-muted)]">
              The six stages and their order are fixed in v1 (rules and the report depend on them). Rename a stage in{" "}
              <Link href="/pipelines" className="text-[var(--link)] underline">
                Pipeline
              </Link>
              .
            </p>
          </Section>
          <NameList {...props("lost_reason")} kind="lost_reason" title="Lost reasons" meta="picked when a lead is lost" addLabel="Add a reason" />
        </TabsContent>
        <TabsContent value="campuses">
          <CampusesTab {...props("campus")} />
        </TabsContent>
        <TabsContent value="sources">
          <NameList
            {...props("source")}
            kind="source"
            title="Sources"
            meta="where an enquiry came from"
            addLabel="Add a source"
            caption="A source is switched off, not deleted, so leads keep where they came from."
          />
        </TabsContent>
        <TabsContent value="welcome">
          <Section title="Welcome flow" meta="first message a parent gets">
            <p className="text-body">
              The greeting, menu, questions, working hours and out-of-hours reply are edited in{" "}
              <Link href="/flows" className="text-[var(--link)] underline">
                Flows
              </Link>
              .
            </p>
          </Section>
        </TabsContent>
        <TabsContent value="people">
          <MembersTab />
        </TabsContent>
      </Tabs>
      <ChangeLog changes={data.changes} names={data.names} />
    </>
  );
}

function ChangeLog({ changes, names }: { changes: SettingsChange[]; names: Record<string, string> }) {
  return (
    <div id="change-log">
      <Section title="Change log" meta="newest first · all tabs">
        <ol className="grid divide-y divide-[var(--line)] rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)]">
          {changes.map((c) => (
            <li key={c.id} data-change={c.id} className="flex items-start gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)]">
              <Icon name={c.action === "insert" ? "add" : "edit"} size={16} className="mt-[var(--space-1)] text-[var(--ink-muted)]" />
              <div className="grow">
                <b>{KIND_TAB[c.kind]}</b> · {describeChange(c)}
                <p className="text-caption text-[var(--ink-muted)]">{(c.changed_by && names[c.changed_by]) || "System"}</p>
              </div>
              <time dateTime={c.changed_at} className="text-caption text-[var(--ink-muted)]">
                {format(new Date(c.changed_at), "d MMM, HH:mm")}
              </time>
            </li>
          ))}
          {changes.length === 0 && <li className="px-[var(--space-3)] py-[var(--space-2)] text-[var(--ink-muted)]">No changes yet.</li>}
        </ol>
      </Section>
    </div>
  );
}
