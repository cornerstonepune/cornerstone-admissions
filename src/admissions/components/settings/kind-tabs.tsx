"use client";

// The tabs of S-admissions-settings backed by admissions_settings rows: follow-up rules, alerts, lost reasons, campuses,
// sources. Each edit goes through `save` (the API); viewers and agents see the same tabs with no Add, Edit or switches.
import { useState, type ReactNode } from "react";
import qrcode from "qrcode-generator";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/admissions/components/icons";
import {
  checkLabel,
  checkValue,
  RULE_ACTIONS,
  stuckKey,
  UNTOUCHED_KEY,
  type RuleAction,
  type Setting,
  type SettingKind,
  type SettingValue,
  type Stage,
} from "@/admissions/lib/settings";

/** Saves one setting: PATCH when `id` is given, else POST. Resolves to an error message, or null when saved. */
export type Save = (body: { id?: string; kind: SettingKind; key?: string; label?: string; value?: SettingValue; active?: boolean }) => Promise<string | null>;
export interface TabProps {
  rows: Setting[];
  canEdit: boolean;
  save: Save;
  /** The account's stages in order, with today's names (rules and stuck alerts hold stage ids). */
  stages: Stage[];
}
type Draft = { id?: string; kind: SettingKind; key?: string; label: string; value: SettingValue; active: boolean };

export function Section({ title, meta, action, children }: { title: string; meta: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-[var(--space-3)]">
      <header className="flex flex-wrap items-baseline gap-[var(--space-3)]">
        <h2 className="font-[family-name:var(--font-title-section)] text-title-section text-[var(--ink)]">{title}</h2>
        <p className="text-caption text-[var(--ink-muted)]">{meta}</p>
        <span className="grow" />
        {action}
      </header>
      {children}
    </section>
  );
}

const Caption = ({ children }: { children: ReactNode }) => <p className="text-caption text-[var(--ink-muted)]">{children}</p>;

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="sm" onClick={onClick}>
      <Icon name="add" size={16} /> {label}
    </Button>
  );
}

function OnSwitch({ row, canEdit, save }: { row: Setting; canEdit: boolean; save: Save }) {
  if (!canEdit) return <span className="text-caption">{row.active ? "On" : "Off"}</span>;
  return (
    <Switch
      checked={row.active}
      aria-label={`${row.label} on`}
      onCheckedChange={(on) => void save({ id: row.id, kind: row.kind, active: on })}
    />
  );
}

const stageName = (stages: Stage[], id: unknown) => stages.find((s) => s.id === id)?.name ?? "Removed stage";
const ruleLabel = (stages: Stage[], v: SettingValue) =>
  `${stageName(stages, v.stage)}, day ${v.days}: ${RULE_ACTIONS[v.action as RuleAction] ?? ""}`;

export function RulesTab({ rows, canEdit, save, stages, templates }: TabProps & { templates: string[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const at = (s: Setting) => stages.findIndex((st) => st.id === s.value.stage);
  const rules = [...rows].sort((a, b) => at(a) - at(b) || Number(a.value.days) - Number(b.value.days));
  const off = rules.filter((r) => !r.active);
  return (
    <Section
      title="Follow-up rules"
      meta={`${rules.length} rules · ${rules.length - off.length} on · by stage, then day`}
      action={canEdit && <AddButton label="Add a rule" onClick={() => setDraft({ kind: "follow_up_rule", label: "", active: true, value: { stage: stages[0]?.id, days: 1, action: "call_task" } })} />}
    >
      {off.length > 0 && (
        <p className="text-body text-[var(--state-wait)]">
          {off.length === 1 ? "One rule is off" : `${off.length} rules are off`}: {off.map((r) => ruleLabel(stages, r.value)).join("; ")}. Leads in
          those stages get nothing from them until they are back on.
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stage</TableHead>
            <TableHead className="text-right">Day</TableHead>
            <TableHead>Do this</TableHead>
            <TableHead>Template</TableHead>
            <TableHead>On</TableHead>
            {canEdit && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((r) => (
            <TableRow key={r.id} className={r.active ? undefined : "bg-[var(--state-wait-bg)]"}>
              <TableCell>{stageName(stages, r.value.stage)}</TableCell>
              <TableCell className="text-right tabular-nums">{String(r.value.days)}</TableCell>
              <TableCell>{RULE_ACTIONS[r.value.action as RuleAction]}</TableCell>
              <TableCell>{(r.value.template as string) ?? "—"}</TableCell>
              <TableCell>
                <OnSwitch row={r} canEdit={canEdit} save={save} />
              </TableCell>
              {canEdit && (
                <TableCell>
                  <Button variant="link" size="sm" onClick={() => setDraft({ ...r })}>
                    Edit
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
          {rules.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>No rules yet. Leads get no automatic follow-ups.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <Caption>A rule that sends a template saves but stays off until Meta approves the template.</Caption>
      <SettingSheet draft={draft} onClose={() => setDraft(null)} save={save} templates={templates} stages={stages} />
    </Section>
  );
}

export function AlertsTab({ rows, canEdit, save, stages }: TabProps) {
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  // one stuck alert per stage a lead can sit in (not the last, Admitted), keyed by the stage's id
  const keys = [UNTOUCHED_KEY, ...stages.filter((s) => !s.last).map((s) => stuckKey(s.id))];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(keys.map((k) => [k, byKey[k] ? String(byKey[k].value.threshold) : ""])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const label = (key: string) =>
    key === UNTOUCHED_KEY ? "Untouched turns red after (hours)" : `Stuck in ${stages.find((s) => stuckKey(s.id) === key)?.name} after (days)`;

  async function saveAll() {
    const next: Record<string, string> = {};
    for (const key of keys) {
      if (values[key] === "" || String(byKey[key]?.value.threshold) === values[key]) continue;
      const value = { threshold: Number(values[key]) };
      const checked = checkValue("alert", key, value);
      const error = checked.ok ? await save({ id: byKey[key]?.id, kind: "alert", key, label: label(key), value }) : checked.error;
      if (error) next[key] = error;
    }
    setErrors(next);
  }

  return (
    <Section title="Alerts" meta="when a lead turns red or amber">
      <div className="grid max-w-prose gap-[var(--space-3)]">
        {keys.map((key) => (
          <div key={key} className="grid gap-[var(--space-1)]">
            <Label htmlFor={key}>{label(key)}</Label>
            <Input
              id={key}
              type="number"
              inputMode="numeric"
              readOnly={!canEdit}
              value={values[key]}
              aria-invalid={Boolean(errors[key])}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
            {errors[key] && <span className="text-caption text-[var(--state-late)]">● {errors[key]}</span>}
          </div>
        ))}
        {canEdit && (
          <Button className="justify-self-start" onClick={() => void saveAll()}>
            Save alerts
          </Button>
        )}
      </div>
    </Section>
  );
}

/** Sources and lost reasons: a name each, switched off rather than deleted. */
export function NameList({ rows, canEdit, save, kind, title, meta, addLabel, caption }: TabProps & { kind: "source" | "lost_reason"; title: string; meta: string; addLabel: string; caption?: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  return (
    <Section title={title} meta={meta} action={canEdit && <AddButton label={addLabel} onClick={() => setDraft({ kind, label: "", value: {}, active: true })} />}>
      <ul className="grid divide-y divide-[var(--line)] rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)]">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)]">
            <span className={r.active ? "" : "text-[var(--ink-muted)] line-through"}>{r.label}</span>
            {kind === "source" && <span className="text-caption text-[var(--ink-muted)]">tag {r.key}</span>}
            <span className="grow" />
            {kind === "source" && <SourceLinks tag={r.key} />}
            <OnSwitch row={r} canEdit={canEdit} save={save} />
            {canEdit && (
              <Button variant="link" size="sm" onClick={() => setDraft({ ...r })}>
                Edit
              </Button>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="px-[var(--space-3)] py-[var(--space-2)] text-[var(--ink-muted)]">None yet.</li>}
      </ul>
      {kind === "source" && (
        <Caption>
          Each source has its own link and QR code. They open our own address, which forwards to our WhatsApp, so printed
          codes keep working if the number changes. A parent who starts a chat from one is counted under that source; any
          other chat counts as WhatsApp.
        </Caption>
      )}
      {caption && <Caption>{caption}</Caption>}
      <SettingSheet draft={draft} onClose={() => setDraft(null)} save={save} templates={[]} />
    </Section>
  );
}

/** The account's WhatsApp number, from wacrm's health check (it asks Meta): undefined while asking, null when unknown. */
/** A source's permanent link (/q/<tag>, ADR 0041): Copy link, and QR downloads it as an SVG to print. */
function SourceLinks({ tag }: { tag: string }) {
  const [copied, setCopied] = useState(false);
  // the live address even when the settings screen is opened elsewhere; read on click, the browser's own otherwise
  const link = () => `${(process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).replace(/\/+$/, "")}/q/${tag}`;
  function downloadQr() {
    const qr = qrcode(0, "M");
    qr.addData(link());
    qr.make();
    const url = URL.createObjectURL(new Blob([qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true })], { type: "image/svg+xml" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `whatsapp-qr-${tag}.svg` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); // some browsers start the download after click() returns
  }
  return (
    <>
      <Button variant="link" size="sm" onClick={downloadQr}>
        QR
      </Button>
      <Button
        variant="link"
        size="sm"
        onClick={() => navigator.clipboard?.writeText(link()).then(() => setCopied(true), () => setCopied(false))}
      >
        {copied ? "Copied" : "Copy link"}
      </Button>
    </>
  );
}

const bornText = (v: SettingValue) =>
  [v.born_from && `from ${v.born_from}`, v.born_before && `before ${v.born_before}`].filter(Boolean).join(", ") || "—";

export function CampusesTab({ rows, canEdit, save }: TabProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  return (
    <Section
      title="Campuses and routing"
      meta="date of birth decides the campus"
      action={canEdit && <AddButton label="Add a campus" onClick={() => setDraft({ kind: "campus", label: "", value: {}, active: true })} />}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Campus</TableHead>
            <TableHead>Grades</TableHead>
            <TableHead>Born</TableHead>
            <TableHead>Visit link</TableHead>
            <TableHead>On</TableHead>
            {canEdit && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <span className="rounded-[var(--radius-pill)] bg-[var(--kind-period-bg)] px-[var(--space-2)] text-[var(--kind-period)]">{r.label}</span>
              </TableCell>
              <TableCell>{(r.value.grades as string) ?? "—"}</TableCell>
              <TableCell>{bornText(r.value)}</TableCell>
              <TableCell>
                {r.value.visit_link ? (
                  <Button variant="link" size="sm" onClick={() => void navigator.clipboard.writeText(String(r.value.visit_link))}>
                    Copy
                  </Button>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>
                <OnSwitch row={r} canEdit={canEdit} save={save} />
              </TableCell>
              {canEdit && (
                <TableCell>
                  <Button variant="link" size="sm" onClick={() => setDraft({ ...r })}>
                    Edit
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Caption>Reference date for age: 1 June of the admission year.</Caption>
      <SettingSheet draft={draft} onClose={() => setDraft(null)} save={save} templates={[]} />
    </Section>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-[var(--space-1)]">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Choice({ id, value, options, onChange }: { id: string; value: string; options: Record<string, string>; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger id={id}>
        <SelectValue>{options[value] ?? value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(options).map(([v, text]) => (
          <SelectItem key={v} value={v}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The editor that opens on the right: a rule, a campus, a source or a lost reason. */
function SettingSheet({ draft, onClose, save, templates, stages = [] }: { draft: Draft | null; onClose: () => void; save: Save; templates: string[]; stages?: Stage[] }) {
  const [form, setForm] = useState<Draft | null>(draft);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Draft | null>(draft);
  if (draft !== shown) {
    // a new draft opened: start the form from it (React's "reset state on prop change" pattern)
    setShown(draft);
    setForm(draft);
    setError(null);
  }
  if (!form) return null;
  const v = form.value;
  const set = (patch: SettingValue) => setForm({ ...form, value: { ...v, ...patch } });
  const isRule = form.kind === "follow_up_rule";

  async function submit() {
    if (!form) return;
    const label = isRule ? ruleLabel(stages, form.value) : form.label;
    const checked = checkLabel(label);
    const value = checkValue(form.kind, form.key ?? "", form.value);
    if (!checked.ok || !value.ok) return setError(!checked.ok ? checked.error : (value as { error: string }).error);
    const failed = await save({ id: form.id, kind: form.kind, key: form.id ? undefined : form.key, label, value: value.value, active: form.active });
    if (failed) setError(failed);
    else onClose();
  }

  return (
    <Sheet open={Boolean(draft)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{form.id ? "Edit" : "Add"}</SheetTitle>
        </SheetHeader>
        <div className="grid gap-[var(--space-3)] px-[var(--space-4)]">
          {isRule ? (
            <>
              <Field id="rule-stage" label="Stage">
                <Choice id="rule-stage" value={String(v.stage)} options={Object.fromEntries(stages.filter((s) => !s.last).map((s) => [s.id, s.name]))} onChange={(stage) => set({ stage })} />
              </Field>
              <Field id="rule-days" label="Days after entering the stage">
                <Input id="rule-days" type="number" inputMode="numeric" value={String(v.days ?? "")} onChange={(e) => set({ days: e.target.value === "" ? "" : Number(e.target.value) })} />
              </Field>
              <Field id="rule-action" label="Do this">
                <Choice id="rule-action" value={String(v.action)} options={RULE_ACTIONS} onChange={(action) => set({ action })} />
              </Field>
              {v.action === "send_template" && (
                <Field id="rule-template" label="Template (Meta-approved only)">
                  <Choice id="rule-template" value={String(v.template ?? "")} options={Object.fromEntries(templates.map((t) => [t, t]))} onChange={(template) => set({ template })} />
                </Field>
              )}
            </>
          ) : (
            <Field id="setting-name" label="Name">
              <Input id="setting-name" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </Field>
          )}
          {form.kind === "source" && !form.id && (
            <Field id="source-tag" label="Tag (letters, numbers, _)">
              <Input id="source-tag" value={form.key ?? ""} onChange={(e) => setForm({ ...form, key: e.target.value })} />
            </Field>
          )}
          {form.kind === "campus" && (
            <>
              <Field id="campus-grades" label="Grades">
                <Input id="campus-grades" value={String(v.grades ?? "")} onChange={(e) => set({ grades: e.target.value })} />
              </Field>
              <Field id="campus-from" label="Born on or after">
                <Input id="campus-from" type="date" value={String(v.born_from ?? "")} onChange={(e) => set({ born_from: e.target.value })} />
              </Field>
              <Field id="campus-before" label="Born before">
                <Input id="campus-before" type="date" value={String(v.born_before ?? "")} onChange={(e) => set({ born_before: e.target.value })} />
              </Field>
              <Field id="campus-link" label="Visit link">
                <Input id="campus-link" type="url" value={String(v.visit_link ?? "")} onChange={(e) => set({ visit_link: e.target.value })} />
              </Field>
            </>
          )}
          <label className="flex items-center gap-[var(--space-2)]">
            <Switch checked={form.active} onCheckedChange={(active) => setForm({ ...form, active })} /> On
          </label>
          {error && <span className="text-caption text-[var(--state-late)]">● {error}</span>}
        </div>
        <SheetFooter>
          <Button onClick={() => void submit()}>Save</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
