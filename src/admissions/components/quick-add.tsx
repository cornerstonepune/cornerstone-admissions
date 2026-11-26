"use client";

// S-quick-add (M4, #67): staff log a walk-in or a phone call on a phone in 30 seconds. How they reached us, the parent's
// phone and name, the child's name if given. Saving goes through /api/admissions/intake: one lead per phone, so a known
// number gets a note on its open lead instead of a second lead.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHead } from "@/admissions/components/page-head";
import { StatusChip } from "@/admissions/components/parts";
import { phoneDigits } from "@/admissions/lib/intake";

export interface AddedToday {
  id: string;
  time: string;
  child: string | null;
  parent: string | null;
  source: string | null;
}

type Status = { tone: "ok" | "late"; text: string } | null;

export function QuickAdd({ sources, added }: { sources: { key: string; label: string }[]; added: AddedToday[] }) {
  const router = useRouter();
  const [source, setSource] = useState(sources[0]?.key ?? "");
  const [phone, setPhone] = useState("");
  const [parent, setParent] = useState("");
  const [child, setChild] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (!phoneDigits(phone)) return setPhoneError("Enter a 10-digit mobile number.");
    setPhoneError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admissions/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, parent, child, source }),
      });
      const body = (await res.json().catch(() => ({}))) as { created?: boolean; error?: string };
      if (!res.ok) return setStatus({ tone: "late", text: body.error ?? "Couldn't save. Nothing was lost." });
      const who = [child.trim(), parent.trim()].filter(Boolean).join(" · ");
      setStatus({ tone: "ok", text: body.created ? `Added ${who}` : "This family is already with us" });
      setPhone("");
      setParent("");
      setChild("");
      router.refresh();
    } catch {
      setStatus({ tone: "late", text: "Couldn't save. Nothing was lost." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-block="QuickAdd" className="mx-auto grid w-full max-w-[calc(var(--space-7)*4.25)] gap-[var(--space-3)]">
      <PageHead
        eyebrow={`New lead · You added ${added.length} today`}
        title="Add a family"
        purpose="Someone walked in or phoned? Note them here. The admissions office calls them back."
      />
      <form
        onSubmit={submit}
        noValidate
        className="grid gap-[var(--space-3)] rounded-[var(--radius-card)] bg-[var(--panel)] p-[var(--space-card)] shadow-[var(--shadow-card)]"
      >
        {sources.length > 0 && (
          <div className="grid gap-[var(--space-1)]">
            <span className="text-label font-semibold">How did they reach us?</span>
            <div role="group" aria-label="Source" className="inline-flex w-fit overflow-hidden rounded-[var(--radius-control)] border border-[var(--line-control)]">
              {sources.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={s.key === source}
                  onClick={() => setSource(s.key)}
                  className="min-h-[var(--tap)] px-[var(--space-3)] text-label text-[var(--ink-muted)] aria-pressed:bg-[var(--action-soft)] aria-pressed:font-semibold aria-pressed:text-[var(--action-soft-ink)]"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-[var(--space-1)]">
          <Label htmlFor="qa-phone">Parent&apos;s phone</Label>
          <Input
            id="qa-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={phoneError ? true : undefined}
            aria-describedby="qa-phone-help"
            className="min-h-[var(--tap)]"
          />
          {phoneError ? (
            <span id="qa-phone-help" role="alert" className="text-caption text-[var(--state-late)]">
              {phoneError}
            </span>
          ) : (
            <span id="qa-phone-help" className="text-caption text-[var(--ink-muted)]">
              10 digits. This is how we find them again.
            </span>
          )}
        </div>
        <div className="grid gap-[var(--space-1)]">
          <Label htmlFor="qa-parent">Parent&apos;s name</Label>
          <Input id="qa-parent" autoComplete="name" value={parent} onChange={(e) => setParent(e.target.value)} className="min-h-[var(--tap)]" />
        </div>
        <div className="grid gap-[var(--space-1)]">
          <Label htmlFor="qa-child">
            Child&apos;s name <span className="text-caption text-[var(--ink-muted)]">(optional)</span>
          </Label>
          <Input id="qa-child" value={child} onChange={(e) => setChild(e.target.value)} className="min-h-[var(--tap)]" />
        </div>
        <Button type="submit" disabled={saving} className="min-h-[var(--tap)]">
          {saving ? "Saving…" : "Save"}
        </Button>
        {status && (
          <p role="status">
            <StatusChip tone={status.tone}>{status.text}</StatusChip>
          </p>
        )}
      </form>
      <section className="grid gap-[var(--space-2)]">
        <header className="flex items-baseline gap-[var(--space-2)]">
          <h2 className="font-[family-name:var(--font-title-section)] text-title-section text-[var(--ink)]">Added today</h2>
          <p className="text-label text-[var(--ink-muted)]">by you</p>
        </header>
        <ul className="grid divide-y divide-[var(--line)] rounded-[var(--radius-card)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
          {added.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-label">
              <span className="tabular-nums text-[var(--ink-muted)]">{a.time}</span>
              <span className="grow">
                {a.child ?? "Child not given"} · {a.parent ?? "Parent not given"}
              </span>
              {a.source && <StatusChip tone="quiet">{a.source}</StatusChip>}
            </li>
          ))}
          {added.length === 0 && <li className="px-[var(--space-3)] py-[var(--space-2)] text-label text-[var(--ink-muted)]">No one yet today.</li>}
        </ul>
      </section>
    </div>
  );
}
