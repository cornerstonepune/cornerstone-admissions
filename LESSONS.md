# Lessons

_One line per failure, newest first. Written by the orchestrator whenever review fails, a ticket escalates, or Nimish corrects something. Reviewed monthly: a layer that keeps appearing is where to invest next._

| Date | What went wrong | Layer | Durable fix (file/rule/test added) |
|---|---|---|---|
| <date> | <one line> | spec · process · toolbox · proof | <what changed so it can't recur> |

- **2026-11-25 · tooling** — loop `init.sh` 0.8.4 exits halfway in a repo with no `*tokens*.css`: `grep -v` on empty input returns 1 under `set -euo pipefail`. Durable fix: `|| true` on the `OWN=$(…)` line in the plugin (nimishshah1989/loop). Worked around with a patched copy.
- **2026-11-25 · upstream test** — `GET /api/ai/usage > flags truncation once the row cap is exceeded` takes ~3s alone and ~6s on a busy machine, over Vitest's 5s default, so `npm test` can flake. If it fails in CI, raise that test's timeout in a plan PR. Don't retry blindly.
