// Shared helpers for database tests (ADR 0011). Every test runs inside `tx()`, which always rolls back.
import postgres from "postgres";

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export const sql = postgres(DATABASE_URL, { onnotice: () => {}, max: 1 });

export type Tx = postgres.TransactionSql;
type Role = "owner" | "admin" | "agent" | "viewer";

const ROLLBACK = Symbol("rollback");

/** Runs fn in a transaction as the superuser and rolls it back, whatever happens. */
export async function tx(fn: (t: Tx) => Promise<void>): Promise<void> {
  try {
    await sql.begin(async (t) => {
      await fn(t);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

/** From here on in this transaction, act as a signed-in user (RLS applies), or as anon when userId is null. */
export async function actAs(t: Tx, userId: string | null): Promise<void> {
  const claims = userId ? { sub: userId, role: "authenticated" } : { role: "anon" };
  await t`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
  await t.unsafe(`set local role ${userId ? "authenticated" : "anon"}`);
}

/** Back to the superuser (RLS bypassed) for setup and checks. */
export async function actAsSuperuser(t: Tx): Promise<void> {
  await t.unsafe("reset role");
  await t`select set_config('request.jwt.claims', '', true)`;
}

/** Runs one statement in a savepoint and returns the Postgres error it raised (or null). */
export async function errorOf(t: Tx, fn: (s: Tx) => Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try {
    await t.savepoint(async (s) => {
      await fn(s as unknown as Tx);
    });
    return null;
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { code: err.code ?? "", message: err.message };
  }
}

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Inserts an auth.users row, as a sign-up does. Returns its id. */
export async function signUp(t: Tx, email = `u${uniq()}@test.local`): Promise<string> {
  const [u] = await t`
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            ${email}, ${t.json({ full_name: "Test " + email })}, now(), now())
    returning id`;
  return u.id as string;
}

/** A user with a profile in `accountId` at `role`. Clears whatever a sign-up trigger may have created. */
export async function member(t: Tx, accountId: string, role: Role): Promise<string> {
  const userId = await signUp(t);
  await t`delete from profiles where user_id = ${userId}`;
  await t`delete from accounts where owner_user_id = ${userId}`;
  await t`
    insert into profiles (user_id, full_name, email, account_id, account_role)
    select id, 'Test', email, ${accountId}, ${role} from auth.users where id = ${userId}`;
  return userId;
}

export interface Account {
  accountId: string;
  ownerId: string;
  pipelineId: string;
  stageIds: string[]; // Enquiry, Visit booked, Visited, Deciding, Applied, Admitted
}

/** An account with its owner and an Admissions pipeline of six stages. */
export async function account(t: Tx): Promise<Account> {
  const ownerId = await signUp(t);
  await t`delete from profiles where user_id = ${ownerId}`;
  await t`delete from accounts where owner_user_id = ${ownerId}`;
  const [a] = await t`insert into accounts (name, owner_user_id) values ('Cornerstone admissions', ${ownerId}) returning id`;
  await t`
    insert into profiles (user_id, full_name, email, account_id, account_role)
    select id, 'Owner', email, ${a.id}, 'owner' from auth.users where id = ${ownerId}`;
  const [p] = await t`insert into pipelines (user_id, account_id, name) values (${ownerId}, ${a.id}, 'Admissions') returning id`;
  const names = ["Enquiry", "Visit booked", "Visited", "Deciding", "Applied", "Admitted"];
  const stageIds: string[] = [];
  for (const [i, name] of names.entries()) {
    const [s] = await t`insert into pipeline_stages (pipeline_id, name, position) values (${p.id}, ${name}, ${i}) returning id`;
    stageIds.push(s.id as string);
  }
  return { accountId: a.id as string, ownerId, pipelineId: p.id as string, stageIds };
}

/** One admissions_settings row; returns its id. */
export async function setting(
  t: Tx,
  a: Account,
  kind: "campus" | "source" | "lost_reason" | "follow_up_rule" | "alert",
  key: string,
  value: Record<string, unknown> = {},
): Promise<string> {
  const [s] = await t`
    insert into admissions_settings (account_id, kind, key, label, value)
    values (${a.accountId}, ${kind}, ${key}, ${key}, ${t.json(value as postgres.JSONValue)}) returning id`;
  return s.id as string;
}

export async function contact(t: Tx, a: Account, phone = `+9198${Math.floor(Math.random() * 1e8)}`): Promise<string> {
  const [c] = await t`
    insert into contacts (user_id, account_id, phone, name) values (${a.ownerId}, ${a.accountId}, ${phone}, 'Parent')
    returning id`;
  return c.id as string;
}

/** A deal in the Admissions pipeline (first stage unless given) plus its leads row. */
export async function lead(
  t: Tx,
  a: Account,
  opts: { contactId?: string; stageId?: string } = {},
): Promise<{ leadId: string; dealId: string; contactId: string }> {
  const contactId = opts.contactId ?? (await contact(t, a));
  const [d] = await t`
    insert into deals (user_id, account_id, pipeline_id, stage_id, contact_id, title)
    values (${a.ownerId}, ${a.accountId}, ${a.pipelineId}, ${opts.stageId ?? a.stageIds[0]}, ${contactId}, 'Lead')
    returning id`;
  const [l] = await t`
    insert into leads (account_id, deal_id, contact_id, child_name) values (${a.accountId}, ${d.id}, ${contactId}, 'Child')
    returning id`;
  return { leadId: l.id as string, dealId: d.id as string, contactId };
}

/** The six tables M0 adds (ADR 0010). */
export const ADMISSIONS_TABLES = [
  "admissions_settings",
  "leads",
  "visits",
  "lead_stage_history",
  "lead_activity",
  "settings_changes",
] as const;
