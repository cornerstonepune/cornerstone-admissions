"use client";

import { isStuck, type LeadSummary } from "@/admissions/lib/pipeline";
import { StatusChip } from "./parts";

/** S-lead's lead card on the Admissions board: child · grade, parent · campus, the state chip and days in stage. */
export function LeadCard({
  lead,
  parent,
  stuckAfter,
  onOpen,
  isOverlay,
}: {
  lead: LeadSummary;
  parent: string | null;
  stuckAfter?: number;
  onOpen: () => void;
  isOverlay?: boolean;
}) {
  const days = lead.days_in_stage;
  const stuck = !lead.exit && !lead.admitted_at && isStuck(days, stuckAfter);
  const title = lead.child_name ? [lead.child_name, lead.grade].filter(Boolean).join(" · ") : "Child not given yet";
  const line = [parent, lead.campus?.label ?? lead.source?.label].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      data-block="LeadCard"
      data-press
      data-closed={lead.exit ? "" : undefined}
      onClick={(e) => {
        if (isOverlay) return;
        e.stopPropagation();
        onOpen();
      }}
      className={`grid w-full gap-2 rounded-[var(--radius-card)] border border-border bg-card p-3 text-left text-label transition-shadow hover:border-input hover:shadow-[var(--shadow-lift)] focus-visible:outline-2 focus-visible:outline-ring ${
        lead.exit ? "opacity-70" : ""
      } ${isOverlay ? "shadow-[var(--shadow-lift)]" : ""}`}
    >
      <b className="break-words text-body">{title}</b>
      {line ? <span className="text-caption text-muted-foreground">{line}</span> : null}
      <span className="flex flex-wrap items-center gap-2">
        {lead.exit === "lost" ? <StatusChip tone="quiet">Lost</StatusChip> : null}
        {lead.exit === "dormant" ? <StatusChip tone="quiet">Dormant</StatusChip> : null}
        {lead.admitted_at ? <StatusChip tone="ok">Admitted</StatusChip> : null}
        {stuck ? (
          <StatusChip tone="wait">Stuck {days} d</StatusChip>
        ) : !lead.exit && !lead.admitted_at && days != null ? (
          <span className="text-caption text-muted-foreground">{days} d</span>
        ) : null}
      </span>
    </button>
  );
}
