// @vitest-environment jsdom
// The admissions dashboard and S-report (ADR 0037, UI): each renders its takeaway, its numbers with yardsticks and its
// charts from what the database answers, opens the lead panel from Needs attention, and says so when it couldn't load.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawReport } from "@/admissions/lib/report";
import type { Today } from "@/admissions/lib/today";

vi.mock("./lead-panel", () => ({ LeadPanel: ({ leadId }: { leadId: string | null }) => <aside data-open-lead={leadId ?? ""} /> }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ accountId: "acc" }) }));
const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, rpc: null as unknown, error: null as unknown }));
vi.mock("@/lib/supabase/client", () => {
  // Every query method returns the same chain; awaiting it answers the table's rows.
  const chain = (data: unknown): unknown =>
    new Proxy(
      {},
      { get: (_, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data, error: db.error }) : () => chain(data)) },
    );
  return { createClient: () => ({ from: (t: string) => chain(db.tables[t] ?? []), rpc: () => chain(db.rpc) }) };
});
import { AdmissionsDashboard } from "./dashboard";
import { ReportScreen } from "./report";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const stage = (id: string, reached: number) => ({ id, name: id, reached, on_board: 1, median_days: 2, open_days: [] });
const REPORT: RawReport = {
  leads: 30, admitted: 3, lost: 2, dormant: 0, days_to_admit: 20,
  stages: [stage("Enquiry", 30), stage("Visit booked", 9), stage("Visited", 8), stage("Admitted", 3)],
  sources: [{ label: "Instagram", leads: 20, admitted: 1 }, { label: "Referral", leads: 10, admitted: 2 }],
  lost_reasons: [{ label: "Fees", n: 2 }],
};
const TODAY: Today = {
  untouchedHours: 24,
  calls: [{ leadId: "l1", key: "u-l1", why: "untouched", hours: 31, family: "Kavya (Nursery)", parent: "Priya", stage: "Enquiry", reason: "Parent wrote, no reply yet", lastContact: null }],
  counts: { untouched: 1, due: 0, fromRules: 0, visits: 0, stuck: 0 },
  visits: [],
  stuck: [],
  done: [],
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  db.error = null;
  db.rpc = REPORT;
  db.tables = {
    leads: [
      { created_at: ago(2), imported_at: null, admitted_at: null, exited_at: null, campus_id: "neev", grade: "Nursery" },
      { created_at: ago(4), imported_at: null, admitted_at: ago(1), exited_at: null, campus_id: "gurukul", grade: "Grade 2" },
    ],
    visits: [{ id: "v1", lead_id: "l9", starts_at: ago(-1), status: "booked", campus: { label: "Neev" }, lead: { child_name: "Ira", grade: "Grade 2" } }],
    lead_activity: [{ assigned_to: "u1", done_at: ago(1) }],
    lead_stage_history: [],
    profiles: [{ user_id: "u1", full_name: "Lakshmi" }],
    admissions_settings: [
      { id: "neev", kind: "campus", label: "Neev" },
      { id: "gurukul", kind: "campus", label: "Gurukul" },
    ],
  };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => TODAY })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("AdmissionsDashboard", () => {
  it("leads with what matters now, then numbers with yardsticks, the funnel, campuses and the team", async () => {
    await act(async () => root.render(<AdmissionsDashboard inbox={<p>INBOX-MOUNTED</p>} />));
    const text = container.textContent ?? "";
    expect(text).toContain("1 family is waiting on a call. Start with Kavya (Nursery).");
    expect(text).toContain("New enquiries, 7 days");
    expect(text).toContain("7 days before: 0");
    expect(text).toContain("Biggest drop: 70% lost");
    expect(text).toContain("Gurukul");
    expect(text).toContain("1 call · 0 moves");
    expect(text).not.toContain("INBOX-MOUNTED");
  });

  it("opens the lead panel from Needs attention, and the WhatsApp stats on demand", async () => {
    await act(async () => root.render(<AdmissionsDashboard inbox={<p>INBOX-MOUNTED</p>} />));
    const family = [...container.querySelectorAll("button")].find((b) => b.textContent === "Kavya (Nursery)")!;
    await act(async () => family.click());
    expect(container.querySelector("aside")?.getAttribute("data-open-lead")).toBe("l1");
    const inbox = [...container.querySelectorAll("button")].find((b) => b.textContent === "Show WhatsApp inbox stats")!;
    await act(async () => inbox.click());
    expect(container.textContent).toContain("INBOX-MOUNTED");
  });

  it("says it couldn't load, with a way to try again", async () => {
    db.error = { message: "boom" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => root.render(<AdmissionsDashboard inbox={null} />));
    expect(container.textContent).toContain("Couldn't load the dashboard");
    expect(container.textContent).toContain("Try again");
  });
});

describe("ReportScreen", () => {
  it("shows every section with its takeaway, the leads yardstick and the trend", async () => {
    await act(async () => root.render(<ReportScreen />));
    const text = container.textContent ?? "";
    expect(text).toContain("Visit booked is the leak: 70% of leads that reach Enquiry go no further.");
    expect(text).toContain("last period 30");
    for (const title of ["Funnel", "Trend", "By source", "By grade", "By campus", "Days per stage", "Why leads were lost"]) expect(text).toContain(title);
    expect(text).toContain("Referral converts 4.0× better than Instagram.");
    expect(text).toContain("Most leads: Grade 2 (1 of 2).");
  });
});

it("uses tokens only: no raw colour or arbitrary px value", () => {
  for (const f of ["dashboard", "report", "charts"]) {
    const src = readFileSync(`src/admissions/components/${f}.tsx`, "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|oklch\(/);
    expect(src).not.toMatch(/-\[[^\]]*\d+px[^\]]*\]/);
  }
});
