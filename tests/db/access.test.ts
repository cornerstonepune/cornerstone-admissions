// G0.2, invariant 1: self sign-up is off; an invitation is the only way in (migration 102, ADR 0006).
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { type Tx, account, actAs, actAsSuperuser, signUp, sql, tx } from "./db";

afterAll(() => sql.end());

/** An open invitation to `accountId` at `role`; returns the token hash the RPC takes. */
async function invite(t: Tx, accountId: string, role: "admin" | "agent" | "viewer"): Promise<string> {
  const hash = createHash("sha256").update(`invite-${accountId}-${Math.random()}`).digest("hex");
  await t`
    insert into account_invitations (account_id, token_hash, role, expires_at)
    values (${accountId}, ${hash}, ${role}, now() + interval '7 days')`;
  return hash;
}

/** A sign-up with no profile and no account, which is what a sign-up leaves once 102 is in. */
async function bareUser(t: Tx): Promise<string> {
  const userId = await signUp(t);
  await t`delete from profiles where user_id = ${userId}`;
  await t`delete from accounts where owner_user_id = ${userId}`;
  return userId;
}

describe("invite-only access (G0.2)", () => {
  it("gives a sign-up without an invitation no account and no profile", () =>
    tx(async (t) => {
      const userId = await signUp(t);
      expect(await t`select 1 from profiles where user_id = ${userId}`).toHaveLength(0);
      expect(await t`select 1 from accounts where owner_user_id = ${userId}`).toHaveLength(0);
    }));

  it("gives an invited user one profile in the invitation's account with its role", () =>
    tx(async (t) => {
      const a = await account(t);
      const hash = await invite(t, a.accountId, "agent");
      const userId = await bareUser(t);
      await actAs(t, userId);
      await t`select public.redeem_invitation(${hash})`;
      await actAsSuperuser(t);
      const rows = await t`select account_id, account_role from profiles where user_id = ${userId}`;
      expect(rows).toEqual([{ account_id: a.accountId, account_role: "agent" }]);
    }));
});
