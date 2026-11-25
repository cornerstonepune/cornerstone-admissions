# 0006 — Membership is `profiles.account_id` + `account_role`; no `account_members` table; invite-only

**Date:** 2026-11-25 · **Status:** accepted (Plan, unattended; corrects the brief and CLAUDE.md)

## Context
The brief (§4 rule 5) and CLAUDE.md say access is decided by membership in `admissions.account_members`. That table does
not exist. In the code as it is (migrations 017–020, 047, 055), a member is a `profiles` row with `account_id` and
`account_role` (`owner` > `admin` > `agent` > `viewer`), and every RLS policy calls `is_account_member(account_id,
min_role)`, which reads `profiles`. Separately, upstream's `on_auth_user_created` trigger gives every new sign-up its own
new account, and the signup page is live: anyone who signs up gets a tenant.

## Decision
- Membership stays where upstream keeps it: `admissions.profiles` (account_id, account_role) and `is_account_member()`.
  We do not add an `account_members` table. The rule in the brief now reads "access only via a profile in the account".
- One account: Cornerstone admissions. The first owner is created by a local seed script, not by a trigger.
- No trigger on `auth.users` (brief §4 rule 4). A profile is created when an invited person first signs in, by the
  invitation-accept path. Self sign-up is off and the signup page is hidden.
- Roles map: Nimish = owner, Akanksha = admin, Lakshmi ma'am = agent with permission to edit templates and rules
  (exact rights fixed in the M0 spec), staff = agent limited to quick-add.

## Why
Adding a second membership table would fork every RLS policy away from upstream for no gain. The trigger must go because
at go-live `auth.users` is shared with the platform: a trigger there would create admissions accounts for platform users.

## Consequences
M0 tests: no trigger on `auth.users`; a signed-in user without a profile reads zero rows; an invited user gets exactly one
profile on first sign-in.
