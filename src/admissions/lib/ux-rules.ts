// The rules every admissions page is held to (DESIGN.md §5; ported from design/platform/lib/ux-rules.ts). One place for the
// numbers, so the blocks and the tests read the same ones.

/** No long tables: a table shows at most this many rows; more are grouped or paged. */
export const TABLE_ROW_LIMIT = 10;
/** The line under a page's title says what the page is for, in one breath. */
export const PURPOSE_MAX = 140;
/** At this width or less the sidebar is a drawer (DESIGN.md §2); the `max-wide:` variant (ADR 0019). */
export const PHONE_MAX_PX = 700;
/** A table of more rows than this has a filter row above it. */
export const FILTER_FROM_ROWS = 6;

/** A cell that says nothing: nothing, false, a dash, or a zero. A column made only of these is not shown. */
export function isEmptyCell(_v: unknown): boolean {
  throw new Error("not implemented");
}

export type Column<T> = {
  key: string;
  label: string;
  /** What the cell holds, as a value: emptiness is read from this, not from what is drawn. */
  value: (row: T) => string | number | null | undefined;
  /** How it is drawn, when more than the value (a link, a chip). */
  cell?: (row: T) => React.ReactNode;
  /** A number: right-aligned, heading and cells. */
  num?: boolean;
  /** A state (a StatusChip): centred, heading and cells. Everything else is text, on the left. */
  status?: boolean;
  /** A fixed width, in a CSS length ("9rem"). */
  width?: string;
  /** A heading that sorts the table. */
  sortable?: boolean;
  /** Shown even when every row is empty: a column the office acts in. */
  keep?: boolean;
};

/** The columns worth showing: a column is dropped when every row's value is empty, unless it is `keep` or there are no rows. */
export function visibleColumns<T>(_columns: readonly Column<T>[], _rows: readonly T[]): Column<T>[] {
  throw new Error("not implemented");
}

/** The rows of page `page` (from 1) of `limit`, the page actually shown (clamped to 1…pages), and how many pages there are. */
export function pageOf<T>(_rows: readonly T[], _page: number, _limit = TABLE_ROW_LIMIT): { rows: T[]; page: number; pages: number } {
  throw new Error("not implemented");
}

/** Rows in the order given, kept in groups in order of first appearance. */
export function groupRows<T>(_rows: readonly T[], _group: (r: T) => string): { name: string; rows: T[] }[] {
  throw new Error("not implemented");
}

/** The alignment of a column: text left, numbers right, a state centred. */
export function alignOf(_c: Pick<Column<unknown>, "num" | "status">): "left" | "right" | "center" {
  throw new Error("not implemented");
}
