import type { LucideIcon } from "lucide-react";

// Every icon admissions screens draw, behind this one lookup (DESIGN.md §4; ported from design/platform/lib/icons.tsx).
// Lucide only, drawn in currentColor, stroke 1.9, always shown with its colour and one word, never alone.
// Screens name a concept (<Icon name="lead">), never a Lucide icon. Swapping the set is this file.
export const ICON_NAMES = [
  // the frame: sidebar sections (ADR 0014 §3), the bar, folding the sidebar
  "today", "inbox", "pipeline", "parents", "notifications", "report", "dashboard",
  "admissions-settings", "flows", "automations", "setup", "help", "sign-out", "menu", "collapse", "expand", "search", "person",
  // the shape of each state (StatusChip, DESIGN.md §3)
  "done", "to-confirm", "fix-this", "to-do", "late", "not-seen",
  // admissions things (GLOSSARY.md)
  "lead", "parent", "visit", "campus", "call", "note", "message", "follow-up", "template", "source", "lost",
  // actions and controls
  "send", "confirm", "correct", "filter", "next", "clear", "close", "add", "quick-add",
  "previous", "following", "chevron-down", "details", "upload", "table", "board", "history",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/** Each concept's Lucide icon: the table in issue #8 says which. */
export const ICONS = {} as Record<IconName, LucideIcon>;

/** The sizes the design names: 16 in a table, 20 in a row or a button, 24 in a heading. */
export const ICON_SIZE = { table: 16, row: 20, heading: 24 } as const;

export function Icon(_props: { name: IconName; size?: number; className?: string }): React.ReactElement {
  throw new Error("not implemented");
}
