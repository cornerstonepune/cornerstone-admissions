"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Deal, PipelineStage } from "@/types";
import { DealCard } from "./deal-card";
import { useTranslations } from "next-intl";
import { stageColour } from "@/admissions/components/parts";

// Admissions (ADR 0038): no money on the board, no per-column "add" (a new lead comes in through Add lead, in
// Enquiry), each stage in its own colour by position, and the board fills the page height so its sideways
// scrollbar is always in view while each column scrolls on its own.
interface PipelineBoardProps {
  stages: PipelineStage[];
  deals: Deal[];
  onDealMoved: (dealId: string, newStageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  /** Admissions pipeline: days after which a lead is stuck, by stage id. */
  stuckAfter?: Record<string, number>;
}

export function PipelineBoard({
  stages,
  deals,
  onDealMoved,
  onEditDeal,
  stuckAfter,
}: PipelineBoardProps) {
  const [activeDealId, setActiveDealId] = useState<string | null>(null);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) bucket.push(deal);
    }
    return map;
  }, [sortedStages, deals]);

  const sensors = useSensors(
    // 5px activation distance avoids clicks being interpreted as drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag support: focus a card, Space to pick up, arrows to move,
    // Space to drop, Escape to cancel.
    useSensor(KeyboardSensor),
  );

  const activeDeal = activeDealId
    ? deals.find((d) => d.id === activeDealId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const targetStageId = String(over.id);

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    onDealMoved(dealId, targetStageId);
  }

  function handleDragCancel() {
    setActiveDealId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* snap-x + snap-mandatory on mobile so swipes land the next
          stage cleanly at the viewport edge instead of mid-column.
          Disabled on lg+, where the columns shrink to share the row
          (six fit on a 1440px laptop) and overflow only past that, and
          the board takes the rest of the page's height and never grows
          past it, so the sideways scrollbar sits in view. */}
      <div className="pipeline-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 lg:min-h-64 lg:flex-1 lg:snap-none lg:overflow-y-hidden">
        {sortedStages.map((stage, i) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            colour={stageColour(i)}
            deals={dealsByStage.get(stage.id) ?? []}
            onEditDeal={onEditDeal}
            stuckAfter={stuckAfter?.[stage.id]}
          />
        ))}
      </div>

      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        {activeDeal ? (
          <div className="opacity-90">
            <DealCard
              deal={activeDeal}
              stage={
                sortedStages.find((s) => s.id === activeDeal.stage_id) ?? null
              }
              onEdit={() => {}}
              isOverlay
              stuckAfter={stuckAfter?.[activeDeal.stage_id]}
              stageColour={stageColour(sortedStages.findIndex((s) => s.id === activeDeal.stage_id))}
            />
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .pipeline-scroll {
          scroll-behavior: smooth;
        }
        /* On touch devices the peek/snap layout already signals there's
           more to swipe, so the scrollbar is hidden for a clean look.
           On desktop (mouse) the board can overflow with many stages
           and there is no peek hint, so keep a thin, themed scrollbar
           visible to make the overflow discoverable and usable. */
        @media (hover: none), (pointer: coarse) {
          .pipeline-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .pipeline-scroll {
            scrollbar-width: none;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .pipeline-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
          .pipeline-scroll::-webkit-scrollbar {
            height: 8px;
          }
          .pipeline-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb {
            background-color: var(--border);
            border-radius: 9999px;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--muted-foreground);
          }
        }
      `}</style>
    </DndContext>
  );
}

function StageColumn({
  stage,
  colour,
  deals,
  onEditDeal,
  stuckAfter,
}: {
  stage: PipelineStage;
  colour: string;
  deals: Deal[];
  onEditDeal: (deal: Deal) => void;
  stuckAfter?: number;
}) {
  const t = useTranslations("Pipelines.board");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    // On a phone each column is most of the width so the next one's edge
    // peeks in, and snap-start lands each cleanly when swiping. On lg+
    // the columns share the row (at least 10rem each) and each list
    // scrolls inside its column. The droppable ref is on the list below,
    // so a drag over the header doesn't highlight the whole column.
    <div className="flex w-5/6 max-w-xs shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-border bg-card/60 lg:w-auto lg:min-w-40 lg:max-w-none lg:flex-1 lg:basis-0 lg:snap-none">
      <div className="h-1 flex-none" style={{ background: colour }} />
      <div className="flex flex-none items-center justify-between gap-2 px-3 pt-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-label font-semibold text-foreground">
          <span aria-hidden className="size-2 flex-none rounded-full" style={{ background: colour }} />
          <span className="truncate">{stage.name}</span>
        </h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption font-semibold text-muted-foreground">
          {deals.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`m-3 flex flex-1 flex-col gap-2 rounded-lg transition-all lg:min-h-0 lg:overflow-x-hidden lg:overflow-y-auto ${
          isOver
            ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2"
            : ""
        }`}
      >
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {t("dropDealHere")}
          </div>
        ) : (
          deals.map((deal) => (
            <DraggableDealCard
              key={deal.id}
              deal={deal}
              stage={stage}
              colour={colour}
              onEdit={onEditDeal}
              stuckAfter={stuckAfter}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableDealCard({
  deal,
  stage,
  colour,
  onEdit,
  stuckAfter,
}: {
  deal: Deal;
  stage: PipelineStage;
  colour: string;
  onEdit: (deal: Deal) => void;
  stuckAfter?: number;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    // a closed lead (Lost, Dormant) is shown, not moved
    disabled: !!deal.lead?.exit,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
    >
      <DealCard deal={deal} stage={stage} onEdit={onEdit} stuckAfter={stuckAfter} stageColour={colour} />
    </div>
  );
}
