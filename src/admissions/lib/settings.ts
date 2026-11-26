// Admissions settings: the five kinds, their value shapes (ADR 0025) and the change-log sentence. Pure, no I/O, shared by
// the API (the trust boundary) and the screen (inline errors). The database checks the rule and alert shapes again.

export const KINDS = ["campus", "source", "lost_reason", "follow_up_rule", "alert"] as const;
export type SettingKind = (typeof KINDS)[number];
export type SettingValue = Record<string, unknown>;

export interface Setting {
  id: string;
  kind: SettingKind;
  key: string;
  label: string;
  value: SettingValue;
  active: boolean;
  sort_order: number;
}

export interface SettingsChange {
  id: string;
  kind: SettingKind;
  key: string;
  action: "insert" | "update" | "delete";
  old_value: Partial<Setting> | null;
  new_value: Partial<Setting> | null;
  changed_by: string | null;
  changed_at: string;
}

/** The tab each kind lives on, as the change log names it. */
export const KIND_TAB: Record<SettingKind, string> = {
  follow_up_rule: "Follow-up rules",
  alert: "Alerts",
  lost_reason: "Lost reasons",
  campus: "Campuses",
  source: "Sources",
};

export const RULE_ACTIONS = { send_template: "Send a template", call_task: "Create a call task", dormant: "Move to Dormant" };
export type RuleAction = keyof typeof RULE_ACTIONS;

/** A pipeline stage as Settings offers it. Rules and stuck alerts hold its id, so renaming a stage breaks nothing. */
export interface Stage {
  id: string;
  name: string;
  last: boolean; // the pipeline's last stage (Admitted): no follow-ups, never stuck
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Alert keys: `untouched` (hours a lead may go untouched) and `stuck_<stage id>` (days a lead may sit in that stage).
 * A stuck row's value is {stage: <stage id>, threshold}, which M3's board reads (ADR 0025 §2, amending ADR 0024 §4). */
export const UNTOUCHED_KEY = "untouched";
export const stuckKey = (stageId: string) => `stuck_${stageId.replace(/-/g, "_")}`;
const stageOfStuckKey = (key: string) => (key.startsWith("stuck_") ? key.slice(6).replace(/_/g, "-") : "");

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

export function isKind(kind: unknown): kind is SettingKind {
  return typeof kind === "string" && (KINDS as readonly string[]).includes(kind);
}

export function checkLabel(label: unknown): Result<string> {
  if (typeof label !== "string" || !label.trim()) return fail("Enter a name.");
  if (label.trim().length > 80) return fail("Keep the name to 80 characters.");
  return { ok: true, value: label.trim() };
}

const isWholeIn = (n: unknown, min: number, max: number): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

/** A real calendar date as YYYY-MM-DD: 2020-02-30 is refused, not rolled over into March. */
export function isDate(d: unknown): d is string {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}
const optionalText = (v: unknown) => v === undefined || v === "" || (typeof v === "string" && v.length <= 120);

/** The stage id a rule or stuck alert names, for the API to check it is a stage of the caller's account. */
export function stageIdOf(kind: SettingKind, key: string, value: SettingValue): string | null {
  if (kind === "follow_up_rule") return typeof value.stage === "string" ? value.stage : null;
  if (kind === "alert" && key !== UNTOUCHED_KEY) return stageOfStuckKey(key);
  return null;
}

/** Checks a setting's value for its kind (and, for alerts, its key) and returns it with only the known fields. */
export function checkValue(kind: SettingKind, key: string, raw: unknown): Result<SettingValue> {
  const v = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  switch (kind) {
    case "follow_up_rule": {
      if (typeof v.stage !== "string" || !UUID.test(v.stage)) return fail("Pick a stage.");
      if (!isWholeIn(v.days, 0, 365)) return fail("Enter 0 to 365 days.");
      if (!(typeof v.action === "string" && v.action in RULE_ACTIONS)) return fail("Pick what the rule does.");
      if (v.action !== "send_template") return { ok: true, value: { stage: v.stage, days: v.days, action: v.action } };
      if (typeof v.template !== "string" || !v.template.trim()) return fail("Pick a template.");
      return { ok: true, value: { stage: v.stage, days: v.days, action: v.action, template: v.template.trim() } };
    }
    case "alert": {
      if (key === UNTOUCHED_KEY) {
        return isWholeIn(v.threshold, 1, 168) ? { ok: true, value: { threshold: v.threshold } } : fail("Enter 1 to 168 hours.");
      }
      // the stage comes from the key, never from the caller, so the two can't disagree
      const stage = stageOfStuckKey(key);
      if (!UUID.test(stage)) return fail("Unknown alert.");
      return isWholeIn(v.threshold, 1, 365) ? { ok: true, value: { stage, threshold: v.threshold } } : fail("Enter 1 to 365 days.");
    }
    case "campus": {
      if (!optionalText(v.grades)) return fail("Keep the grades to 120 characters.");
      for (const f of ["born_from", "born_before"] as const) {
        if (v[f] !== undefined && v[f] !== "" && !isDate(v[f])) return fail("Enter a real date as YYYY-MM-DD.");
      }
      if (isDate(v.born_from) && isDate(v.born_before) && v.born_from >= v.born_before) {
        return fail("“Born on or after” must be earlier than “Born before”.");
      }
      if (v.visit_link !== undefined && v.visit_link !== "" && !/^https:\/\/\S+$/.test(String(v.visit_link))) {
        return fail("The visit link must start with https://.");
      }
      const value: SettingValue = {};
      for (const f of ["grades", "born_from", "born_before", "visit_link"]) if (v[f]) value[f] = v[f];
      return { ok: true, value };
    }
    default:
      return { ok: true, value: {} }; // sources and lost reasons carry only a name (ADR 0025)
  }
}

/** A rule's key is every field that defines it (stage, day, action, template): two rules that do the same thing clash
 * (409), and an edited rule's key follows its new value. */
export function ruleKey(v: SettingValue): string {
  const template = v.template ? `_${String(v.template).toLowerCase().replace(/[^a-z0-9]+/g, "_")}` : "";
  return `rule_${String(v.stage).replace(/-/g, "_")}_d${v.days}_${v.action}${template}`;
}

/** The key a new setting gets: alerts name theirs; a rule's comes from what it does; the rest from the tag or name,
 * or a generated one when the name has no Latin letters (a Marathi name slugs to nothing). */
export function keyFor(kind: SettingKind, label: string, value: SettingValue, given?: unknown): string {
  if (kind === "alert") return typeof given === "string" ? given : "";
  if (kind === "follow_up_rule") return ruleKey(value);
  return slug(typeof given === "string" && given ? given : label) || `${kind}_${crypto.randomUUID().slice(0, 8)}`;
}

const show = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));

/** One line for the change log, e.g. "Applied, day 3: Create a call task switched off" or "threshold 14 → 21".
 * `stageNames` turns the stage ids rules and alerts hold back into today's stage names. */
export function describeChange(
  c: Pick<SettingsChange, "action" | "old_value" | "new_value">,
  stageNames: Record<string, string> = {},
): string {
  const before = c.old_value ?? {};
  const after = c.new_value ?? {};
  const name = after.label ?? before.label ?? "";
  if (c.action === "insert") return `added ${name}`;
  if (c.action === "delete") return `removed ${name}`;
  const parts: string[] = [];
  if (before.active !== after.active) parts.push(after.active ? "switched on" : "switched off");
  if (before.label !== after.label) parts.push(`renamed from ${before.label}`);
  const fields = new Set([...Object.keys(before.value ?? {}), ...Object.keys(after.value ?? {})]);
  const shown = (f: string, v: unknown) => show(f === "stage" && typeof v === "string" ? (stageNames[v] ?? v) : v);
  for (const f of fields) {
    const [a, b] = [before.value?.[f], after.value?.[f]];
    if (JSON.stringify(a) !== JSON.stringify(b)) parts.push(`${f.replace(/_/g, " ")} ${shown(f, a)} → ${shown(f, b)}`);
  }
  if (before.sort_order !== after.sort_order) parts.push("moved");
  return `${name} ${parts.join(", ") || "saved"}`;
}
