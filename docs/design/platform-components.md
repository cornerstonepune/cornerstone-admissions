# Platform UI components: inventory and porting plan

Source: `design/platform/` (copied once, ADR 0003; platform commit `dfedfe27c`). Judged from file names, import lines and
sizes against this repo's stack. **Stack fit:** platform = Next 16.4.5, React 19.2.8, Tailwind 4, shadcn `radix-nova`
(Radix), lucide 1.59, cva/clsx/tailwind-merge. Here = Next 16.3.8, React 19.2.4, Tailwind 4, shadcn `base-nova`
(Base UI), lucide ^1.70, the same cva/clsx/tailwind-merge. Same major versions everywhere, so the components port as
source. The two real gaps are Radix vs Base UI (only the two `ui/` files use Radix) and the platform modules some files import.

**What porting needs, every time:** move into `src/admissions/components/`; swap `@/lib/icons` for the ported icon map;
replace the 7–8 hard-coded breakpoints (`min-[700px]`, `[901px]`, …) with a breakpoint token (CI rejects `-[Npx]`);
drop school words. `blocks.css` holds the class rules most components use; its plain px sizes pass CI.

## Port (ticketed, all labelled `design-port` + `queued`)

| Platform file(s) | Lines | Fits? | What porting needs | Issue |
|---|---|---|---|---|
| `globals.css` (bridge + type utilities) | 626 | Yes | Map wacrm's shadcn variables onto tokens; drop wacrm's theme blocks and picker; fonts via next/font | #7 |
| `lib/icons.tsx`, `link.tsx`, `lib/ux-rules.ts` | 200+10+66 | Yes | Swap school concepts for admissions ones; check lucide names on 1.70 | #8 |
| `components/blocks.css` | 452 | Yes | Drop school-only rules; import after tokens | #9 (size:small) |
| `status-chip.tsx`, `outcome-states.ts`, `kind-tile.tsx` | 122+21+29 | Yes | Admissions states and kinds (DESIGN.md §3–4) | #10 |
| `cards.tsx`, `count.tsx`, `count-chip.tsx`, `key-value.tsx` | 88+10+35+11 | Yes | None beyond the common list | #11 |
| `parts.tsx`, `trail.tsx`, `crumbs.tsx` | 137+44+27 | Partly | `parts` imports the platform `Session` type; `trail` uses `frame/walk` and `crumbs` uses `lib/detail-trail` (not copied): rewrite those bits | #12 |
| `detail-panel.tsx`, `detail-panel-client.tsx` | 105+130 | Yes | Phone sheet on wacrm's `ui/sheet` | #13 |
| `data-table.tsx`, `filter-bar.tsx` | 165+188 | Yes | Render on wacrm's `ui/table`; takeaway line required | #14 |
| `stat-tile.tsx`, `empty-state.tsx`, `attention-strip.tsx` | 39+22+37 | Yes | Yardstick required on stat tiles | #15 |
| `timeline.tsx`, `details.tsx`, `stepper.tsx` | 23+15+18 | Yes | Six stages and two exits (D8) | #16 |
| `spark.tsx`, `trend.tsx`, `stack-bar.tsx` | 23+26+29 | Yes | Big charts stay on wacrm's recharts/tremor | #17 |
| `app-frame.tsx`, `frame/*` (6), `brand-mark.tsx`, logo SVGs | 331+~250+25 | Markup only | Imports platform auth, menu, access, acting-as, stock: business logic, not ported. Restyle wacrm's `layout/sidebar` + `header` instead | #18 |

Order: #7 → #8, #9 → #10 → #11 → #12–#17; #18 after #8 and #9. Seeds are cut when each one's first screen is approved.

## Port with the screen that needs it (no ticket yet)

| File | Lines | Why wait |
|---|---|---|
| `form.tsx` | 19 | The quick-add screen's ticket ports it; wacrm's `ui/input` + `ui/label` are the controls |
| `fold.tsx`, `open-section.tsx` | 18+20 | Tiny disclosure helpers; port when a screen uses one |
| `drop-zone.tsx` | 27 | Only if lead import gets a screen |

## Don't port

| File | Why |
|---|---|
| `ui/button.tsx`, `ui/tabs.tsx` | Radix-based; wacrm has Base UI versions in `src/components/ui/` that take the look through the theme bridge (#7) |
| `kanban-board.tsx` | Links-only board. wacrm's pipeline board already drags and drops (brief D1: don't rebuild); restyle it with StatusChip instead |
| `lib/utils.ts` | wacrm has the same `cn()` in `src/lib/utils.ts` |
| `lib/state-scale.ts`, `level-bars.tsx`, `heat-grid.tsx` | The school's rubric levels and class heat map; no admissions use |
| `capture-bar.tsx` | The school's capture-a-note bar |
| `PRINCIPLES.md` | The platform's older, superseded brand note (kept for history) |

## Not copied at all (domain components, names and imports only were read)

lessons (`lesson-panel`, `lesson-picker`, `period-row`, `fortnight-grid`, `timetable-rail`, `taught-notice`),
curriculum (`curriculum-*`, `curriculum/`), children (`child-*`, `class-grid`, `children/`, `peek-names`, `standing`),
questions (`question`, `questions`, `methods`, `pictures`, `page-image`, `page-part/`), activity (`activity-*`,
`activity/`, `item-picker`, `origin`), school admin (`money-tabs`, `stock-tabs`, `report-form`, `grid-refused`,
`not-for-you`, `not-yours`, `colour-key`, `subject-*`, `educator/`, `teaching/`).
