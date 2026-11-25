# 0001 — Fork wacrm into a private repo, upstream kept as a remote

**Date:** 2026-11-25 · **Status:** accepted

## Context
Brief decisions D1–D2: build on `ArnasDon/wacrm` (MIT), in a new private repo, able to pull upstream fixes. GitHub forks of public repos cannot be private.

## Decision
- Created `cornerstonepune/cornerstone-admissions` (private, approved by Nimish 25 Nov) and pushed upstream `main` at `6dbeb5b` as our `main`, full history kept.
- Remotes: `origin` = our repo; `upstream` = wacrm, fetch only (`git remote set-url --push upstream DISABLED`). `gh repo set-default` points at our repo so `gh pr` never targets upstream.
- Upstream's `AGENTS.md` (one Next.js note) is folded into CLAUDE.md "Project specifics" and deleted; CLAUDE.md is the loop template.
- Loop CI (`loop-tests`) runs `npm ci` before the `.loop.json` commands; Vitest also includes `tests/**/*.test.ts` so hidden holdout tests run.

## Consequences
Pulling upstream = `git fetch upstream && git merge upstream/main` on a `plan/` branch. Expect small conflicts on `CLAUDE.md`, `AGENTS.md`, `vitest.config.ts`. Upstream's `CODEOWNERS` (`@ArnasDon`), `dependabot.yml`, `ci.yml` and `migrations.yml` are kept unchanged.
