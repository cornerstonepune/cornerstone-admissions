// Lead identity (migrations 109, 110): a lead's account and deal never change (ADR 0016 §3).
import { afterAll, describe, expect, it } from "vitest";
import { account, errorOf, lead, sql, tx, type Account, type Tx } from "./db";

afterAll(() => sql.end());

const MOVE = "A lead's account and deal never change";

/** A deal without a lead, for the given contact. */
async function plainDeal(t: Tx, a: Account, contactId: string): Promise<string> {
  const [d] = await t`
    insert into deals (user_id, account_id, pipeline_id, stage_id, contact_id, title)
    values (${a.ownerId}, ${a.accountId}, ${a.pipelineId}, ${a.stageIds[0]}, ${contactId}, 'Other deal') returning id`;
  return d.id as string;
}

describe("lead move guard", () => {
  it("refuses to move a new lead (stage history only) to another deal of the same contact", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId, contactId } = await lead(t, a);
      const other = await plainDeal(t, a, contactId);
      const err = await errorOf(t, (s) => s`update leads set deal_id = ${other} where id = ${leadId}`);
      expect(err?.code).toBe("23514");
      expect(err?.message).toBe(MOVE);
    }));

  it("refuses to move a lead to another account", () =>
    tx(async (t) => {
      const a = await account(t);
      const b = await account(t);
      const { leadId } = await lead(t, a);
      const err = await errorOf(t, (s) => s`update leads set account_id = ${b.accountId} where id = ${leadId}`);
      expect(err?.code).toBe("23514");
      expect(err?.message).toBe(MOVE);
    }));

  it("still lets a lead change its other fields", () =>
    tx(async (t) => {
      const a = await account(t);
      const { leadId } = await lead(t, a);
      expect(await errorOf(t, (s) => s`update leads set child_name = 'Asha' where id = ${leadId}`)).toBeNull();
    }));
});
