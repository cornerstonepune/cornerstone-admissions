import {
  Bell,
  ChartColumn,
  House,
  Inbox,
  Kanban,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Settings,
  SlidersHorizontal,
  Sun,
  Workflow,
  X,
  Zap,
} from "lucide-react";

// Every icon admissions screens draw, behind this one lookup (DESIGN.md §4; ported from design/platform/lib/icons.tsx).
// Lucide only, drawn in currentColor, stroke 1.9, shown with its word, never alone. Screens name a concept
// (<Icon name="today">), never a Lucide icon, so an unknown concept is a type error. Later screens add their concepts here.
export const ICONS = {
  // the sidebar's doors (ADR 0014 §3)
  today: Sun,
  inbox: Inbox,
  pipeline: Kanban,
  parents: House,
  notifications: Bell,
  report: ChartColumn,
  dashboard: LayoutDashboard,
  "admissions-settings": SlidersHorizontal,
  flows: Workflow,
  automations: Zap,
  setup: Settings,
  // the bar and the sidebar's controls
  "sign-out": LogOut,
  menu: Menu,
  collapse: PanelLeftClose,
  expand: PanelLeftOpen,
  close: X,
  // S-admissions-settings: add a setting, and a change-log line
  add: Plus,
  edit: Pencil,
} satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof ICONS;

/** The sizes the design names: 16 in a table, 20 in a row or a button, 24 in a heading. */
export const ICON_SIZE = { table: 16, row: 20, heading: 24 } as const;

export function Icon({ name, size = ICON_SIZE.row, className }: { name: IconName; size?: number; className?: string }) {
  const Drawn = ICONS[name];
  return <Drawn size={size} strokeWidth={1.9} aria-hidden="true" data-icon={name} className={className} />;
}
