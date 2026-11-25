// Hidden: invite-only edge cases (ticket 102).
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { type Tx, account, actAs, actAsSuperuser, contact, errorOf, signUp, sql, tx } from "../../db/db";

afterAll(() => sql.end());

async function invite(
  t: Tx,
  accountId: string,
  role: "admin" | "agent" | "viewer",
  opts: { expired?: boolean; accepted?: boolean } = {},
): Promise<string> {
  const hash = createHash("sha256").update(`hidden-${accountId}-${Math.random()}`).digest("hex");
  await t`
    insert into account_invitations (account_id, token_hash, role, expires_at, accepted_at)
    values (${accountId}, ${hash}, ${role},
            ${opts.expired ? sql`now() - interval '1 day'` : sql`now() + interval '7 days'`},
            ${opts.accepted ? sql`now()` : null})`;
  return hash;
}

async function bareUser(t: Tx, email?: string): Promise<string> {
  const userId = await signUp(t, email);
  await t`delete from profiles where user_id = ${userId}`;
  await t`delete from accounts where owner_user_id = ${userId}`;
  return userId;
}

/** Calls redeem_invitation as `userId` (or anon when null); returns [result, error]. */
async function redeem(t: Tx, userId: string | null, hash: string) {
  await actAs(t, userId);
  let result: string | null = null;
  const err = await errorOf(t, async (s) => {
    const [r] = await s`select public.redeem_invitation(${hash}) as id`;
    result = r.id as string;
  });
  await actAsSuperuser(t);
  return [result, err] as const;
}

describe("invite-only edge cases (hidden)", () => {
  it("returns the invitation's account and marks the invitation accepted by the user", () =>
    tx(async (t) => {
      const a = await account(t);
      const hash = await invite(t, a.accountId, "viewer");
      const userId = await bareUser(t);
      const [id, err] = await redeem(t, userId, hash);
      expect(err).toBeNull();
      expect(id).toBe(a.accountId);
      const [inv] = await t`select accepted_at, accepted_by_user_id from account_invitations where token_hash = ${hash}`;
      expect(inv.accepted_at).not.toBeNull();
      expect(inv.accepted_by_user_id).toBe(userId);
    }));

  it("takes the profile's name from sign-up metadata and email from the auth user", () =>
    tx(async (t) => {
      const a = await account(t);
      const hash = await invite(t, a.accountId, "admin");
      const email = `akanksha${Date.now()}@test.local`;
      const userId = await bareUser(t, email);
      await redeem(t, userId, hash);
      const [p] = await t`select full_name, email, account_role from profiles where user_id = ${userId}`;
      expect(p).toEqual({ full_name: `Test ${email}`, email, account_role: "admin" });
    }));

  it("creates no second account for the invited user", () =>
    tx(async (t) => {
      const a = await account(t);
      const hash = await invite(t, a.accountId, "agent");
      const userId = await bareUser(t);
      await redeem(t, userId, hash);
      expect(await t`select 1 from accounts where owner_user_id = ${userId}`).toHaveLength(0);
      expect(await t`select 1 from profiles where user_id = ${userId}`).toHaveLength(1);
    }));

  it("refuses an expired invitation and creates no profile", () =>
    tx(async (t) => {
      const a = await account(t);
      const hash = await invite(t, a.accountId, "agent", { expired: true });
      const userId = await bareUser(t);
      const [, err] = await redeem(t, userId, hash);
      expect(err?.code).toBe("22023");
      expect(await t`select 1 from profiles where user_id = ${userId}`).toHaveLength(0);
    }));

  it("refuses an invitation that was already redeemed", () =>
    tx(async (t) => {
      const a = await account(t);
      const hash = await invite(t, a.accountId, "agent", { accepted: true });
      const userId = await bareUser(t);
      const [, err] = await redeem(t, userId, hash);
      expect(err?.code).toBe("22023");
      expect(await t`select 1 from profiles where user_id = ${userId}`).toHaveLength(0);
    }));

  it("lets one invitation be used once only", () =>
    tx(async (t) => {
      const a = await account(t);
      const hash = await invite(t, a.accountId, "agent");
      const first = await bareUser(t);
      const second = await bareUser(t);
      expect((await redeem(t, first, hash))[1]).toBeNull();
      expect((await redeem(t, second, hash))[1]?.code).toBe("22023");
      expect(await t`select 1 from profiles where user_id = ${second}`).toHaveLength(0);
    }));

  it("refuses an unknown token", () =>
    tx(async (t) => {
      const userId = await bareUser(t);
      const [, err] = await redeem(t, userId, "0".repeat(64));
      expect(err?.code).toBe("22023");
    }));

  it("refuses an anonymous caller", () =>
    tx(async (t) => {
      const a = await account(t);
      const hash = await invite(t, a.accountId, "agent");
      const [, err] = await redeem(t, null, hash);
      expect(err?.code).toBe("42501");
    }));

  it("still moves a user who owns an empty account, and deletes that account", () =>
    tx(async (t) => {
      const a = await account(t);
      const hash = await invite(t, a.accountId, "agent");
      const userId = await bareUser(t);
      const [old] = await t`insert into accounts (name, owner_user_id) values ('Own', ${userId}) returning id`;
      await t`
        insert into profiles (user_id, full_name, email, account_id, account_role)
        select id, 'Own', email, ${old.id}, 'owner' from auth.users where id = ${userId}`;
      const [id, err] = await redeem(t, userId, hash);
      expect(err).toBeNull();
      expect(id).toBe(a.accountId);
      expect(await t`select 1 from accounts where id = ${old.id}`).toHaveLength(0);
      const [p] = await t`select account_id, account_role from profiles where user_id = ${userId}`;
      expect(p).toEqual({ account_id: a.accountId, account_role: "agent" });
    }));

  it("still refuses a user whose own account holds data", () =>
    tx(async (t) => {
      const a = await account(t);
      const own = await account(t);
      await contact(t, own);
      const hash = await invite(t, a.accountId, "agent");
      const [, err] = await redeem(t, own.ownerId, hash);
      expect(err?.code).toBe("23505");
      const [p] = await t`select account_id from profiles where user_id = ${own.ownerId}`;
      expect(p.account_id).toBe(own.accountId);
    }));

  it("refuses an existing member of the same account", () =>
    tx(async (t) => {
      const a = await account(t);
      const hash = await invite(t, a.accountId, "agent");
      const [, err] = await redeem(t, a.ownerId, hash);
      expect(err?.code).toBe("23505");
    }));
});
