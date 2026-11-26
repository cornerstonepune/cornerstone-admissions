// The old enquiry sheet → leads (M7, #71, ADR 0027). wacrm's contact import (Parents › Import) hands a sheet with a
// child column to /api/admissions/import, which validates every row here, at the boundary, then opens the good rows
// with import_leads (migration 116). A bad row is reported with its line and reason and never reaches the database.
import { parseCsvLine } from "@/lib/contacts/parse-contact-csv";
import { normalizePhone, parseInternationalPhone } from "@/lib/whatsapp/phone-utils";

/** Header names the sheet may use for each field, any case. Only phone is required. */
const COLUMNS = {
  phone: ["phone", "mobile", "phone number", "whatsapp"],
  parent: ["parent", "parent name", "name"],
  child: ["child", "child name"],
  grade: ["grade", "class"],
  campus: ["campus"],
  area: ["area"],
  source: ["source"],
  stage: ["stage"],
} as const;
type Field = keyof typeof COLUMNS;

export const MAX_ROWS = 2000;

const headerOf = (text: string) => parseCsvLine(text.trim().split(/\r?\n/)[0] ?? "").map((h) => h.replace(/["']/g, "").trim().toLowerCase());

/** A lead sheet, not a plain contact list: it has a child column. */
export const isLeadSheet = (text: string) => headerOf(text).some((h) => (COLUMNS.child as readonly string[]).includes(h));

/**
 * A phone as the sheet holds it → digits with the country code, or null. A number without `+` is Indian:
 * 98765 43210 and 098765 43210 become 919876543210, the form WhatsApp contacts already have, so they dedupe.
 */
export function sheetPhone(raw: string): string | null {
  if (raw.trim().startsWith("+")) return parseInternationalPhone(raw);
  const d = normalizePhone(raw).replace(/^0/, "");
  const full = d.length === 10 ? `91${d}` : d;
  return /^91[6-9]\d{9}$/.test(full) ? full : null; // without +, only an Indian mobile is accepted
}

export interface Choice {
  id: string;
  label: string;
}
export interface Lookups {
  campuses: Choice[];
  sources: Choice[];
  stages: Choice[]; // in order; the last is Admitted
}
export interface SheetRow {
  phone: string;
  parent: string;
  child: string;
  grade: string;
  area: string;
  campus_id: string | null;
  source_id: string | null;
  stage_id: string;
}
export interface RowError {
  line: number;
  phone: string;
  name?: string;
  reason: string;
}

/** Parses and validates the sheet. `lines[i]` is the file line of `rows[i]` (the header is line 1). */
export function parseLeadSheet(text: string, look: Lookups): { rows: SheetRow[]; lines: number[]; errors: RowError[] } {
  const header = headerOf(text);
  const col = Object.fromEntries(
    (Object.keys(COLUMNS) as Field[]).map((f) => [f, header.findIndex((h) => (COLUMNS[f] as readonly string[]).includes(h))]),
  ) as Record<Field, number>;
  const out = { rows: [] as SheetRow[], lines: [] as number[], errors: [] as RowError[] };
  if (col.phone < 0) return { ...out, errors: [{ line: 1, phone: "", reason: "The sheet needs a phone column." }] };

  const find = (list: Choice[], v: string) => list.find((c) => c.label.trim().toLowerCase() === v.toLowerCase());
  // shortcut: one row per line, as wacrm's parser; a line break inside a quoted cell splits the row.
  const lines = text.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = parseCsvLine(lines[i]);
    const get = (f: Field) => (col[f] < 0 ? "" : (cells[col[f]] ?? "").replace(/["']/g, "").trim());
    const line = i + 1;
    const fail = (reason: string) => out.errors.push({ line, phone: get("phone"), name: get("child") || get("parent") || undefined, reason });
    if (out.rows.length + out.errors.length >= MAX_ROWS) {
      fail(`Only the first ${MAX_ROWS} rows are imported at once.`);
      break;
    }
    const phone = sheetPhone(get("phone"));
    if (!phone) {
      fail("No valid phone number (10 digits, or +country code).");
      continue;
    }
    const campus = get("campus") ? find(look.campuses, get("campus")) : null;
    const source = get("source") ? find(look.sources, get("source")) : null;
    const stage = get("stage") ? find(look.stages, get("stage")) : look.stages[0];
    if (campus === undefined) fail(`Unknown campus "${get("campus")}". Add it in Admissions settings first.`);
    else if (source === undefined) fail(`Unknown source "${get("source")}". Add it in Admissions settings first.`);
    else if (!stage) fail(get("stage") ? `Unknown stage "${get("stage")}".` : "The Admissions pipeline has no stages.");
    else if (stage === look.stages.at(-1)) fail("Admitted families are not imported: only live enquiries.");
    else {
      out.rows.push({
        phone,
        parent: get("parent"),
        child: get("child"),
        grade: get("grade"),
        area: get("area"),
        campus_id: campus?.id ?? null,
        source_id: source?.id ?? null,
        stage_id: stage.id,
      });
      out.lines.push(line);
    }
  }
  return out;
}
