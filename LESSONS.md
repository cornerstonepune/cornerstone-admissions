# Lessons

_One line per failure, newest first. Written by the orchestrator whenever review fails, a ticket escalates, or Nimish corrects something. Reviewed monthly: a layer that keeps appearing is where to invest next._

| Date | What went wrong | Layer | Durable fix (file/rule/test added) |
|---|---|---|---|
| <date> | <one line> | spec · process · toolbox · proof | <what changed so it can't recur> |

- **2026-11-25 · spec** — #22's spec checked only each row's own `account_id`; reviewer of PR #29 found FKs bypass RLS (cross-account links + id probing), agents could forge stage history and free the one-send slot. Durable fix: ADR 0013, #24/#25 extended, #30 added, `tests/db/rls-refusals.test.ts`. Rule: an RLS spec lists every FK column of the table and says how its target's account is checked.
- **2026-11-25 · spec** — M0 seed drafts asked for RLS policies only, but this Supabase grants `authenticated` nothing on new tables/views, so #22's tests could never pass ("permission denied") and #27's RLS test needs #22. Caught by running the seeds red→green with a reference migration before pushing. Durable fix: ADR 0012 (explicit grants in every migration), stubs and issues #22/#27 updated, #27 blocked by #22. Rule: always prove a seed green with a throwaway reference before pushing.
- **2026-11-25 · tooling** — loop `init.sh` 0.8.4 exits halfway in a repo with no `*tokens*.css`: `grep -v` on empty input returns 1 under `set -euo pipefail`. Durable fix: `|| true` on the `OWN=$(…)` line in the plugin (nimishshah1989/loop). Worked around with a patched copy.
- **2026-11-25 · upstream test** — `GET /api/ai/usage > flags truncation once the row cap is exceeded` takes ~3s alone and ~6s on a busy machine, over Vitest's 5s default, so `npm test` can flake. If it fails in CI, raise that test's timeout in a plan PR. Don't retry blindly.
