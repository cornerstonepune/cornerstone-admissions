// M7 (#71, migration 116): the funnel report from stage history, scoped to the caller, and the sheet import's dedupe.
// Every test builds its own accounts inside tx(), which rolls back; nothing counts rows outside them.
import { afterAll, describe, expect, it } from "vitest";
import { account, actAs, actAsSuperuser, contact, lead, member, setting, sql, tx, type Account, type Tx } from "./db";

afterAll(() => sql.end());

/** Rewrites a lead's stage history to `path` ([stage index, days ago], oldest first) and puts its deal on the last. */
async function walk(t: Tx, a: Account, l: { leadId: string; dealId: string }, path: [number, number][]) {
  await t`set local session_replication_role = replica`; // no history triggers while we write history by hand
  await t`delete from lead_stage_history where lead_id = ${l.leadId}`;
  for (const [stage, ago] of path)
    await t`insert into lead_stage_history (account_id, lead_id, stage_id, entered_at)
            values (${a.accountId}, ${l.leadId}, ${a.stageIds[stage]}, now() - make_interval(days => ${ago}))`;
  await t`update deals set stage_id = ${a.stageIds[path.at(-1)![0]]} where id = ${l.dealId}`;
  await t`update leads set created_at = now() - make_interval(days => ${path[0][1]}) where id = ${l.leadId}`;
  await t`set local session_replication_role = origin`;
}

const report = async (t: Tx, accountId: string) => {
  const [r] = await t`select public.admissions_report(${accountId}, now() - interval '90 days', now() + interval '1 minute') as r`;
  return r.r as {
    leads: number; admitted: number; lost: number; dormant: number; days_to_admit: number | null;
    stages: { id: string; name: string; reached: number; on_board: number; median_days: number | null; open_days: number[] }[];
    sources: { label: string | null; leads: number; admitted: number }[];
    lost_reasons: { label: string; n: number }[];
  };
};

/** Four leads in the period with known paths, one open lead from last year, one lead in another account. */
async function known(t: Tx) {
  const a = await account(t);
  const web = await setting(t, a, "source", "website");
  const walkin = await setting(t, a, "source", "walkin");
  const distance = await setting(t, a, "lost_reason", "distance");
  const l1 = await lead(t, a);
  await walk(t, a, l1, [[0, 5]]); // still in Enquiry
  const l2 = await lead(t, a);
  await walk(t, a, l2, [[0, 10], [1, 7], [2, 3]]); // then Lost a day ago
  await t`update leads set exit = 'lost', exited_at = now() - interval '1 day', lost_reason_id = ${distance} where id = ${l2.leadId}`;
  const l3 = await lead(t, a);
  await walk(t, a, l3, [[0, 6], [2, 2]]); // skipped Visit booked, still in Visited
  const l4 = await lead(t, a);
  await walk(t, a, l4, [[0, 20], [1, 18], [2, 15], [3, 10], [4, 4], [5, 1]]);
  await t`update leads set admitted_at = now() - interval '1 day' where id = ${l4.leadId}`;
  await t`update leads set source_id = ${web} where id in (${l1.leadId}, ${l2.leadId})`;
  await t`update leads set source_id = ${walkin} where id in (${l3.leadId}, ${l4.leadId})`;
  const l5 = await lead(t, a); // created last year, still open in Enquiry: on the board, not in the period
  await t`update leads set created_at = now() - interval '400 days' where id = ${l5.leadId}`;
  const b = await account(t);
  await lead(t, b, { stageId: b.stageIds[0] });
  return { a, b };
}

describe("G7.2 the funnel comes from stage history and matches the board", () => {
  it("counts reached, days per stage, sources and lost reasons on known data", () =>
    tx(async (t) => {
      const { a } = await known(t);
      await actAs(t, await member(t, a.accountId, "viewer"));
      const r = await report(t, a.accountId);
      expect({ leads: r.leads, admitted: r.admitted, lost: r.lost, dormant: r.dormant }).toEqual({ leads: 4, admitted: 1, lost: 1, dormant: 0 });
      expect(r.days_to_admit).toBe(19);
      expect(r.stages.map((s) => s.name)).toEqual(["Enquiry", "Visit booked", "Visited", "Deciding", "Applied", "Admitted"]);
      expect(r.stages.map((s) => s.reached)).toEqual([4, 3, 3, 1, 1, 1]); // a skipped stage counts as passed
      // stays: Enquiry 5 (still there), 3, 4, 2 · Visit booked 4, 3 · Visited 2, 2 (still there), 5 · Deciding 6 · Applied 3
      expect(r.stages.map((s) => s.median_days)).toEqual([3.5, 3.5, 2, 6, 3, null]);
      expect(r.stages[0].open_days).toEqual([5]);
      expect(r.stages[2].open_days).toEqual([2]);
      expect(r.sources.sort((x, y) => String(x.label).localeCompare(String(y.label)))).toEqual([
        { label: "walkin", leads: 2, admitted: 1 },
        { label: "website", leads: 2, admitted: 0 },
      ]);
      expect(r.lost_reasons).toEqual([{ label: "distance", n: 1 }]);
    }));

  it("gives each stage the board's lane count: open leads whose deal is in it", () =>
    tx(async (t) => {
      const { a } = await known(t);
      // The board (pipelines/page.tsx) lists the pipeline's deals and hides those whose lead has an exit.
      const lanes = await t`
        select d.stage_id, count(*)::int as n from deals d join leads l on l.deal_id = d.id
        where d.pipeline_id = ${a.pipelineId} and l.exit is null group by d.stage_id`;
      const board = Object.fromEntries(lanes.map((x) => [x.stage_id, x.n]));
      await actAs(t, await member(t, a.accountId, "viewer"));
      const r = await report(t, a.accountId);
      expect(Object.fromEntries(r.stages.map((s) => [s.id, s.on_board]).filter(([, n]) => n))).toEqual(board);
      expect(r.stages.map((s) => s.on_board)).toEqual([2, 0, 1, 0, 0, 1]);
    }));
});

describe("a report is scoped to the caller's account", () => {
  it("reads nothing of another account, even when asked for it by id", () =>
    tx(async (t) => {
      const { a, b } = await known(t);
      await actAs(t, await member(t, b.accountId, "admin"));
      const r = await report(t, a.accountId);
      expect({ leads: r.leads, stages: r.stages, sources: r.sources }).toEqual({ leads: 0, stages: [], sources: [] });
      expect((await report(t, b.accountId)).leads).toBe(1);
    }));

  it("refuses a signed-out caller", () =>
    tx(async (t) => {
      const { a } = await known(t);
      await actAs(t, null);
      await expect(report(t, a.accountId)).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("G7.1 the sheet import dedupes by phone", () => {
  it("imports good rows, reuses contacts, skips duplicates and leaves nothing of a bad row", () =>
    tx(async (t) => {
      const a = await account(t);
      const other = await account(t);
      const known = await contact(t, a, "+919800000001"); // a parent with no lead yet
      await lead(t, a, { contactId: await contact(t, a, "+91 98000 00002") }); // a parent with an open lead
      const campus = await setting(t, a, "campus", "neev");
      const foreign = await setting(t, other, "campus", "neev");
      const row = (phone: string, extra: Record<string, unknown> = {}) => ({
        phone, parent: "Parent", child: "Child", grade: "Nursery", area: "Baner",
        campus_id: campus, source_id: null, stage_id: a.stageIds[0], ...extra,
      });
      const rows = [
        row("919800000003", { stage_id: a.stageIds[2] }),
        row("919800000001"),
        row("919800000002"),
        row("919800000003"), // same number again in the same file
        row("919800000004", { stage_id: other.stageIds[0] }),
        row("919800000005", { campus_id: foreign }),
      ];
      await actAs(t, await member(t, a.accountId, "admin"));
      const [{ out }] = await t`select public.import_leads(${a.accountId}, ${t.json(rows)}) as out`;
      expect(out.map((o: { status: string }) => o.status)).toEqual(["imported", "imported", "duplicate", "duplicate", "failed", "failed"]);

      const count = (phone: string) =>
        t`select count(distinct c.id)::int as contacts, count(l.id)::int as leads
          from contacts c left join leads l on l.contact_id = c.id
          where c.account_id = ${a.accountId} and c.phone_normalized = ${phone}`.then((x) => x[0]);
      expect(await count("919800000003")).toEqual({ contacts: 1, leads: 1 });
      expect(await count("919800000001")).toEqual({ contacts: 1, leads: 1 });
      expect((await t`select id from contacts where id = ${known}`).length).toBe(1);
      expect(await count("919800000002")).toEqual({ contacts: 1, leads: 1 });
      expect(await count("919800000004")).toEqual({ contacts: 0, leads: 0 });
      expect(await count("919800000005")).toEqual({ contacts: 0, leads: 0 });
      const [imported] = await t`
        select l.child_name, l.grade, l.area, l.campus_id, d.stage_id, h.stage_id as first_stage
        from leads l join deals d on d.id = l.deal_id join lead_stage_history h on h.lead_id = l.id
        join contacts c on c.id = l.contact_id where c.account_id = ${a.accountId} and c.phone_normalized = '919800000003'`;
      expect(imported).toEqual({
        child_name: "Child", grade: "Nursery", area: "Baner", campus_id: campus,
        stage_id: a.stageIds[2], first_stage: a.stageIds[2],
      });
    }));

  it("refuses a viewer row by row and writes nothing", () =>
    tx(async (t) => {
      const a = await account(t);
      await actAs(t, await member(t, a.accountId, "viewer"));
      const rows = [{ phone: "919800000009", parent: "P", child: "C", stage_id: a.stageIds[0] }];
      const [{ out }] = await t`select public.import_leads(${a.accountId}, ${t.json(rows)}) as out`;
      expect(out).toEqual([{ status: "failed", error: expect.any(String) }]);
      await actAsSuperuser(t);
      expect(await t`select 1 from contacts where account_id = ${a.accountId}`).toHaveLength(0);
    }));
});
