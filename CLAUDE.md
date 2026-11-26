# CLAUDE.md — this repo runs the loop

Personal rules (honesty, Karpathy, reuse, tokens) live in `~/.claude/CLAUDE.md`. This file is only how work happens here.

## 0. Start of every session
The SessionStart hook has already given you your role, HANDOFF.md, PROJECT.md §1–4, the current milestone and the wireframe approvals. Don't re-read them. State in 2 lines: the goal, and your first step. For code context, `graphify query "<question>"` before opening files.

## 1. Files (the whole memory system)
- `PROJECT.md` — locked blueprint: product, architecture, data model, screens, milestones with yes/no goals.
- `db/schema.sql` (or ORM schema) — the data model as runnable code. `GLOSSARY.md` — domain terms; use them exactly.
- `docs/adr/` — one file per decision and why. GitHub Issues — tickets from `to-tickets`.
- `design/` — `tokens.css` (Cornerstone tokens, ADR 0003; change only with an ADR), `brand.css` (this project's ~20%), `platform/` (frozen reference snapshot, never edited or imported), `wireframes/`, `approved.json` (Nimish's approvals).
- `HANDOFF.md` — where the last session stopped. Overwritten and committed every session.
- `LESSONS.md` — every failure, the layer it came from, and the durable fix. Corrections live in files, never only in chat.

## 2. How work runs (ADR 0023: the loop process is retired)
Nimish, 2026-11-26: build directly and fast; this is a simple admissions system on top of wacrm. No seeds, hidden tests, budgets, planner sessions per ticket, or loop-guard.
- One branch per slice → code + tests in the same branch → PR → CI green (lint, typecheck, test, build, database tests, migrations) → merge. Never commit to main.
- Reuse wacrm first (route, lib, component); port from `design/platform/` only what a screen needs. Least code that works; codebase stays clean.
- Independent review (fresh subagent) only for security-critical changes: RLS, auth, webhooks, migrations.
- Red CI: read the failing lines at once and fix. A runner/infra flake gets one rerun. Never merge red on data, tenancy/RLS, auth, money or migrations.
- Tell Nimish in chat at every merge and the moment anything is stuck. Never stall on process.

## 3. Order
Milestones in PROJECT.md §5. Wireframes are approved (all 16); editing one voids its approval. After a milestone, Nimish clicks through; production release waits for his go.

## 4. Building rules
- UI uses design tokens only (`var(--…)` / the Tailwind preset). No raw hex, rgb, or arbitrary `[..px]` values.
- Never edit or delete a test just to make it pass.
- Spec looks wrong → say so to Nimish in one line, with a recommendation, then continue.

## 5. Nothing important lives only in chat
- A decision made in conversation becomes an ADR in the same session. A new term goes in GLOSSARY.md. Progress goes in HANDOFF.md. If it isn't in a file, assume the next session won't know it.
- One task per session. At the context budget (default 150k) the hook stops you: write the handoff and end; the next session continues from it.

## 6. Proof, not opinion
Done means outside evidence: tests, CI, a working URL, a traced number. A model reviewing its own work is not a check. Anything you couldn't verify, list it as unverified.

## 7. End of every session
Overwrite HANDOFF.md from its template and commit it. New decisions → ADR. Update issue status. (Hooks won't let you stop with a stale handoff after committing; CI fails a PR without one.)

## Enforcement you can't switch off
Hooks + CI `loop-guard`: no commits to main, no `--no-verify`; protected files and existing tests are plan-only; approvals are Nimish-only; frontend needs approved wireframes; raw styles rejected; PROJECT.md/schema changes need an ADR; every PR leaves a handoff (HANDOFF.md, or `docs/loop/handoff/<N>.md` for ticket PRs). Blocked? Don't look for a way around it — write it down and stop.

## Project specifics
- Fork of `ArnasDon/wacrm` (MIT). `origin` = `cornerstonepune/cornerstone-admissions` (private); `upstream` = wacrm (fetch only, push disabled). Our code lives in `src/admissions/`, our migrations are numbered from 100; touch upstream files as little as possible.
- Product spec: `PROJECT.md` (folded from `ADMISSIONS_PROJECT.md` v2.1, now history; ADR 0004). Design authority: root `DESIGN.md` (the Cornerstone platform's design language, copied once) — see ADR 0003, which supersedes ADR 0002. Components to port: `docs/design/platform-components.md`.
- Stack: Next.js 16 (App Router) + React 19, Supabase (Postgres + RLS), Meta WhatsApp Cloud API, next-intl (`messages/`), Vitest. This Next.js has breaking changes vs. training data: read `node_modules/next/dist/docs/` before writing Next code.
- Commands: `npm ci` · `npm run dev` · `npm test` · `npm run typecheck` · `npm run lint` · `npm run build`. Database: `npm run db:reset` (local Supabase Postgres, Docker) · `npm run test:db` · `npm run db:schema` after any migration (ADR 0011).
- Folders: `src/app` routes · `src/components` UI · `src/lib` domain logic (whatsapp, automations, flows, pipelines, supabase clients) · `supabase/migrations` schema · `mcp-server/` separate package.
- Data rules (hard): admissions has its own Supabase project (ADR 0009): local Supabase only until M7, then a new hosted project Nimish creates; never use the shared project `ruznbyngtfjsaymuylhm` (no MCP, no keys), at any milestone; no live keys in env files before M7; never `supabase db push`. Upstream tables stay in `public` untouched; ours (6 tables, ADR 0010) sit beside them. Access only via a profile in the account (`profiles.account_id` + `account_role`, `is_account_member()`; ADR 0006); self sign-up off (invite only).
- Isolation (hard): never open, clone or reference any other Cornerstone repo (platform, website, brain). The one exception, a read-only copy of the platform's design files on 2026-11-25 (ADR 0003), is finished: port from `design/platform/`, never from the platform repo.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
