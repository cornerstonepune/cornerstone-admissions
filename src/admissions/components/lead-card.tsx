"use client";

import { isStuck, type LeadSummary } from "@/admissions/lib/pipeline";
import { campusTone, StatusChip, Tag } from "./parts";

/** S-lead's lead card on the Admissions board: child and grade, parent, campus, the state chip and days in stage, on an
 * edge in its stage's colour. A stuck lead is tinted amber. */
export function LeadCard({
  lead,
  parent,
  stuckAfter,
  stageColour,
  onOpen,
  isOverlay,
}: {
  lead: LeadSummary;
  parent: string | null;
  stuckAfter?: number;
  stageColour?: string;
  onOpen: () => void;
  isOverlay?: boolean;
}) {
  const days = lead.days_in_stage;
  const open = !lead.exit && !lead.admitted_at;
  const stuck = open && isStuck(days, stuckAfter);

  return (
    <button
      type="button"
      data-block="LeadCard"
      data-press
      data-closed={lead.exit ? "" : undefined}
      data-stuck={stuck ? "" : undefined}
      style={stageColour ? { borderLeftColor: stageColour } : undefined}
      onClick={(e) => {
        if (isOverlay) return;
        e.stopPropagation();
        onOpen();
      }}
      className={`grid w-full min-w-0 gap-1.5 rounded-[var(--radius-card)] border border-l-4 border-border p-3 text-left text-label transition-shadow hover:shadow-[var(--shadow-lift)] focus-visible:outline-2 focus-visible:outline-ring ${
        stuck ? "bg-[var(--state-wait-bg)]" : "bg-card"
      } ${lead.exit ? "opacity-70" : ""} ${isOverlay ? "shadow-[var(--shadow-lift)]" : ""}`}
    >
      <b className="break-words text-body">{lead.child_name ?? "Child not given yet"}</b>
      {parent ? <span className="break-words text-caption text-muted-foreground">{parent}</span> : null}
      <span className="flex flex-wrap items-center gap-1.5">
        {lead.grade ? <Tag>{lead.grade}</Tag> : null}
        {lead.campus ? <Tag tone={campusTone(lead.campus.sort_order)}>{lead.campus.label}</Tag> : null}
        {lead.exit === "lost" ? <StatusChip tone="quiet">Lost</StatusChip> : null}
        {lead.exit === "dormant" ? <StatusChip tone="quiet">Dormant</StatusChip> : null}
        {lead.admitted_at ? <StatusChip tone="ok">Admitted</StatusChip> : null}
        {stuck ? (
          <StatusChip tone="wait">Stuck {days} d</StatusChip>
        ) : open && days != null ? (
          <span className="text-caption text-muted-foreground">{days} d in stage</span>
        ) : null}
      </span>
    </button>
  );
}
